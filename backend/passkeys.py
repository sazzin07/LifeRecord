"""Passkeys and security keys (WebAuthn) as a second step at sign-in.

The browser asks the authenticator (a phone, a laptop's fingerprint reader, a USB key) to create, then later to prove it holds, a
key pair that belongs to THIS site. The server keeps only the public half, so nothing in the database can sign anyone in.

- A ceremony begins with a random challenge kept in `webauthn_challenges`: bound to one user and one purpose (register, login,
  proof), valid 5 minutes, and CLAIMED by deleting it, so it works once (a captured answer cannot be replayed).
- The "relying party" is the site's host name. The browser enforces it: a passkey made for one host is useless on another. It is
  taken from the page's own Origin header when that origin is one the server already trusts (CORS_ORIGINS and FRONTEND_URL),
  or pinned with WEBAUTHN_RP_ID / WEBAUTHN_ORIGINS. Changing the host name later orphans the passkeys: decide before using it.
- Attestation is not requested (a stranger's authenticator model is none of our business); what is checked is the signature, the
  origin, the host, the challenge and the counter. Synced passkeys always report a counter of 0, which is allowed; a counter
  that does not go forward on an authenticator that uses one means a clone and is refused.
"""
import hashlib
import os
import time
import uuid
from typing import List, Optional, Tuple
from urllib.parse import urlparse

from fastapi import HTTPException, Request
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from webauthn import (base64url_to_bytes, generate_authentication_options, generate_registration_options, verify_authentication_response,
                      verify_registration_response)
from webauthn.helpers import bytes_to_base64url, options_to_json_dict
from webauthn.helpers.structs import (AuthenticatorSelectionCriteria, PublicKeyCredentialDescriptor, ResidentKeyRequirement,
                                      UserVerificationRequirement)

from models import User, WebauthnChallenge, WebauthnCredential

CHALLENGE_SECONDS = 300
MAX_PER_USER = 10
RP_NAME = "Life Record"
UNUSABLE_HERE = "Passkeys cannot be used from this address. Open the app at its usual address, or use another way to sign in."


def _origin_of(url: str) -> Optional[str]:
    parts = urlparse((url or "").strip())
    return f"{parts.scheme}://{parts.netloc}" if parts.scheme in ("http", "https") and parts.netloc else None


def trusted_origins() -> List[str]:
    pinned = [o.strip() for o in os.environ.get("WEBAUTHN_ORIGINS", "").split(",") if o.strip()]
    if pinned:
        return [o for o in (_origin_of(p) for p in pinned) if o]
    listed = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip() and o.strip() != "*"]
    found = [o for o in (_origin_of(p) for p in listed + [os.environ.get("FRONTEND_URL", "")]) if o]
    return list(dict.fromkeys(found))


def rp_for(request: Request) -> Tuple[str, str]:
    """(rp_id, origin) for this request: the page's own origin if it is trusted, else the first trusted one."""
    trusted = trusted_origins()
    asked = _origin_of(request.headers.get("Origin", ""))
    if asked is not None and asked not in trusted:
        raise HTTPException(400, UNUSABLE_HERE)
    origin = asked or (trusted[0] if trusted else None)
    if origin is None:
        raise HTTPException(400, UNUSABLE_HERE)
    rp_id = os.environ.get("WEBAUTHN_RP_ID", "").strip() or (urlparse(origin).hostname or "")
    host = urlparse(origin).hostname or ""
    if not rp_id or not (host == rp_id or host.endswith("." + rp_id)):
        raise HTTPException(400, UNUSABLE_HERE)
    return rp_id, origin


def _user_handle(user_id: str) -> bytes:
    """An opaque, stable handle for the authenticator to store: not the id, not the email."""
    return hashlib.sha256(f"liferecord-user:{user_id}".encode()).digest()


async def _begin(db: AsyncSession, user_id: str, purpose: str, challenge: bytes, rp_id: str, origin: str) -> str:
    now = int(time.time() * 1000)
    await db.execute(delete(WebauthnChallenge).where((WebauthnChallenge.expires_ms < now) | (
        (WebauthnChallenge.user_id == user_id) & (WebauthnChallenge.purpose == purpose))))
    challenge_id = str(uuid.uuid4())
    db.add(WebauthnChallenge(id=challenge_id, user_id=user_id, purpose=purpose, challenge=bytes_to_base64url(challenge),
                             rp_id=rp_id, origin=origin, expires_ms=now + CHALLENGE_SECONDS * 1000))
    await db.commit()
    return challenge_id


async def _claim(db: AsyncSession, challenge_id: str, user_id: str, purpose: str) -> Optional[WebauthnChallenge]:
    """The pending ceremony, removed so it cannot be used again; None if unknown, someone else's, wrong purpose, or expired."""
    row = (await db.execute(select(WebauthnChallenge).where(
        WebauthnChallenge.id == (challenge_id or ""), WebauthnChallenge.user_id == user_id, WebauthnChallenge.purpose == purpose))).scalar_one_or_none()
    if row is None:
        return None
    won = await db.execute(delete(WebauthnChallenge).where(WebauthnChallenge.id == row.id))
    await db.commit()
    if won.rowcount != 1 or row.expires_ms < int(time.time() * 1000):
        return None
    return row


async def credentials_of(db: AsyncSession, user_id: str) -> List[WebauthnCredential]:
    return list((await db.execute(select(WebauthnCredential).where(WebauthnCredential.user_id == user_id)
                                  .order_by(WebauthnCredential.created_ms))).scalars())


def _descriptors(rows: List[WebauthnCredential]) -> List[PublicKeyCredentialDescriptor]:
    return [PublicKeyCredentialDescriptor(id=base64url_to_bytes(r.credential_id)) for r in rows]


async def begin_registration(db: AsyncSession, user: User, rp_id: str, origin: str) -> Tuple[str, dict]:
    existing = await credentials_of(db, user.id)
    if len(existing) >= MAX_PER_USER:
        raise HTTPException(400, f"You can register up to {MAX_PER_USER} passkeys. Remove one first.")
    options = generate_registration_options(
        rp_id=rp_id, rp_name=RP_NAME, user_id=_user_handle(user.id), user_name=user.email, user_display_name=user.name or user.email,
        exclude_credentials=_descriptors(existing),
        authenticator_selection=AuthenticatorSelectionCriteria(resident_key=ResidentKeyRequirement.PREFERRED,
                                                               user_verification=UserVerificationRequirement.PREFERRED))
    return await _begin(db, user.id, "register", options.challenge, rp_id, origin), options_to_json_dict(options)


async def finish_registration(db: AsyncSession, user: User, challenge_id: str, credential: dict, name: str) -> Optional[WebauthnCredential]:
    """Verify the browser's answer and keep the new public key. None when the answer is not good."""
    pending = await _claim(db, challenge_id, user.id, "register")
    if pending is None:
        return None
    try:
        verified = verify_registration_response(credential=credential, expected_challenge=base64url_to_bytes(pending.challenge),
                                                expected_rp_id=pending.rp_id, expected_origin=pending.origin)
    except Exception:
        return None
    taken = (await db.execute(select(WebauthnCredential.id).where(
        WebauthnCredential.credential_id == bytes_to_base64url(verified.credential_id)))).first()
    if taken is not None:
        return None
    existing = await credentials_of(db, user.id)
    transports = []
    try:
        transports = [t for t in (credential.get("response") or {}).get("transports") or [] if isinstance(t, str) and t.isalpha()][:6]
    except AttributeError:
        pass
    row = WebauthnCredential(
        id=str(uuid.uuid4()), user_id=user.id, credential_id=bytes_to_base64url(verified.credential_id),
        public_key=bytes_to_base64url(verified.credential_public_key), sign_count=int(verified.sign_count or 0),
        name=(name or "").strip()[:60] or f"Passkey {len(existing) + 1}", transports=",".join(transports) or None,
        created_ms=int(time.time() * 1000))
    db.add(row)
    await db.commit()
    return row


async def begin_assertion(db: AsyncSession, user: User, purpose: str, rp_id: str, origin: str) -> Tuple[str, dict]:
    """Options for signing in with, or proving possession of, one of the user's passkeys. purpose: login | proof."""
    rows = await credentials_of(db, user.id)
    if not rows:
        raise HTTPException(400, "No passkey is registered for this account.")
    options = generate_authentication_options(rp_id=rp_id, allow_credentials=_descriptors(rows),
                                              user_verification=UserVerificationRequirement.PREFERRED)
    return await _begin(db, user.id, purpose, options.challenge, rp_id, origin), options_to_json_dict(options)


async def verify_assertion(db: AsyncSession, user_id: str, purpose: str, challenge_id: str, credential: dict) -> bool:
    """True when `credential` is a fresh signature, over this user's pending challenge, by one of this user's passkeys."""
    pending = await _claim(db, challenge_id, user_id, purpose)
    if pending is None or not isinstance(credential, dict):
        return False
    raw_id = credential.get("id") if isinstance(credential.get("id"), str) else None
    row = (await db.execute(select(WebauthnCredential).where(
        WebauthnCredential.user_id == user_id, WebauthnCredential.credential_id == (raw_id or "")))).scalar_one_or_none()
    if row is None:
        return False
    try:
        verified = verify_authentication_response(
            credential=credential, expected_challenge=base64url_to_bytes(pending.challenge), expected_rp_id=pending.rp_id,
            expected_origin=pending.origin, credential_public_key=base64url_to_bytes(row.public_key),
            credential_current_sign_count=int(row.sign_count or 0))
    except Exception:
        return False
    await db.execute(update(WebauthnCredential).where(WebauthnCredential.id == row.id)
                     .values(sign_count=int(verified.new_sign_count or 0), last_used_ms=int(time.time() * 1000)))
    await db.commit()
    return True


def public(row: WebauthnCredential) -> dict:
    return {"id": row.id, "name": row.name, "created_ms": row.created_ms, "last_used_ms": row.last_used_ms,
            "transports": (row.transports or "").split(",") if row.transports else []}

