"""The optional second step at sign-in: set it up, sign in with it, change it, recover from a lost phone, turn it off.

Three methods, any combination: an authenticator app (totp.py), passkeys / security keys (passkeys.py) and text-message codes
(sms_service.py, sms_codes.py). Two-step sign-in is ON while at least one is confirmed. Eight one-time recovery codes belong to the
account as a whole and are made when the FIRST method is confirmed.

Once it is on, a correct password only earns a short-lived CHALLENGE (security_utils.create_totp_challenge_token); the session starts
when the challenge is finished with any one method (or a recovery code). A password reset does not skip it either: the emailed link
proves the mailbox, not the phone.

Every change to a person's sign-in protection needs the password AND, when two-step is already on, one PROOF: a code (authenticator,
text message or recovery) or a passkey. A stolen session alone can neither weaken nor take over the second step.

Registered like the other domain modules (`register(api_router, server_module)`); `enabled` is also used by server.py.
"""
import re
import time
import urllib.parse
import uuid
from typing import List, Optional

import jwt
import os
from fastapi import BackgroundTasks, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

import email_service
import passkeys
import sms_codes
import sms_service
import totp
from models import SmsCode, SmsFactor, TotpCredential, TotpRecoveryCode, User, WebauthnCredential
from security_utils import create_totp_challenge_token, decode_token

BAD_CODE = "That code is not right. Check it and try again."
NEED_PROOF = "Confirm it is you first: enter a code from one of your sign-in methods, or use a passkey."
BAD_PASSKEY = "That passkey could not be used. Try again, or use another way."
SMS_OFF = "Text messages are not set up on this server."
TOTP_ATTEMPTS = 10          # code guesses per account in the window, whoever makes them
TOTP_WINDOW_SECONDS = 900
SMS_PER_USER_PER_HOUR = 5
METHOD_ORDER = ("passkey", "totp", "sms")   # the order the sign-in screen offers them in


class PasskeyProof(BaseModel):
    challenge_id: str = Field(..., min_length=1, max_length=64)
    credential: dict


class ProofBody(BaseModel):
    code: Optional[str] = Field(None, max_length=40)
    passkey: Optional[PasskeyProof] = None


class PasswordBody(ProofBody):
    password: str = Field(..., min_length=1, max_length=255)


class CodeBody(BaseModel):
    code: str = Field(..., min_length=1, max_length=40)


class ChallengeBody(BaseModel):
    challenge: str = Field(..., min_length=1, max_length=2048)


class TotpLoginBody(ChallengeBody):
    code: str = Field(..., min_length=1, max_length=40)


class PasskeyLoginBody(ChallengeBody):
    challenge_id: str = Field(..., min_length=1, max_length=64)
    credential: dict


class PasskeyFinishBody(BaseModel):
    challenge_id: str = Field(..., min_length=1, max_length=64)
    credential: dict
    name: str = Field("", max_length=60)


class PasskeyNameBody(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)


class SmsStartBody(PasswordBody):
    phone: str = Field(..., min_length=1, max_length=40)


# -- what is on ------------------------------------------------------------------------------------------------------------

async def credential(db: AsyncSession, user_id: str) -> Optional[TotpCredential]:
    return (await db.execute(select(TotpCredential).where(TotpCredential.user_id == user_id))).scalar_one_or_none()


async def sms_factor(db: AsyncSession, user_id: str) -> Optional[SmsFactor]:
    return (await db.execute(select(SmsFactor).where(SmsFactor.user_id == user_id))).scalar_one_or_none()


async def confirmed_methods(db: AsyncSession, user_id: str) -> List[str]:
    """The methods the person has finished setting up (typed a first code in, or registered a passkey), in sign-in order."""
    have = set()
    totp_row = await credential(db, user_id)
    if totp_row is not None and totp_row.confirmed_ms is not None:
        have.add("totp")
    sms_row = await sms_factor(db, user_id)
    if sms_row is not None and sms_row.confirmed_ms is not None:
        have.add("sms")
    if (await db.execute(select(func.count()).select_from(WebauthnCredential).where(WebauthnCredential.user_id == user_id))).scalar_one():
        have.add("passkey")
    return [m for m in METHOD_ORDER if m in have]


async def enabled(db: AsyncSession, user_id: str) -> bool:
    """True only while at least one method is set up."""
    return bool(await confirmed_methods(db, user_id))


async def recovery_codes_left(db: AsyncSession, user_id: str) -> int:
    return (await db.execute(select(func.count()).select_from(TotpRecoveryCode)
                             .where(TotpRecoveryCode.user_id == user_id, TotpRecoveryCode.used_ms.is_(None)))).scalar_one()


async def status(db: AsyncSession, user_id: str) -> dict:
    methods = await confirmed_methods(db, user_id)
    sms_row = await sms_factor(db, user_id)
    rows = await passkeys.credentials_of(db, user_id)
    return {
        "enabled": bool(methods), "recovery_codes_left": await recovery_codes_left(db, user_id) if methods else 0,
        "methods": methods,
        "passkeys": [passkeys.public(r) for r in rows],
        "sms": {"enabled": "sms" in methods, "hint": sms_row.phone_hint if sms_row is not None and sms_row.confirmed_ms else None,
                "available": sms_service.available()},
    }


async def challenge_for(db: AsyncSession, user: User, message: Optional[str] = None) -> dict:
    """What /auth/login (and a completed reset) answers when the password was right but a second step is still owed. Nothing is
    signed in: only a challenge, and the ways it can be finished."""
    methods = await confirmed_methods(db, user.id)
    out = {"requires_totp": True, "challenge": create_totp_challenge_token(user.id), "methods": methods}
    if "sms" in methods:
        out["sms_hint"] = (await sms_factor(db, user.id)).phone_hint
    if message:
        out["message"] = message
    return out


# -- spending codes --------------------------------------------------------------------------------------------------------

async def _spend_totp(db: AsyncSession, user_id: str, code: str) -> bool:
    """A current authenticator code, once per 30-second step: one conditional UPDATE, so two requests with the same code cannot both win."""
    row = await credential(db, user_id)
    if row is None or row.confirmed_ms is None or not re.fullmatch(r"\d{6}", code):
        return False
    step = totp.verify(totp.decrypt_secret(row.secret_enc), code, last_step=int(row.last_step or 0))
    if step is None:
        return False
    won = await db.execute(update(TotpCredential).where(TotpCredential.user_id == user_id, TotpCredential.last_step < step).values(last_step=step))
    await db.commit()
    return won.rowcount == 1


async def _spend_recovery(db: AsyncSession, user_id: str, code: str) -> bool:
    spent = await db.execute(update(TotpRecoveryCode).where(
        TotpRecoveryCode.user_id == user_id, TotpRecoveryCode.code_hash == totp.recovery_hash(user_id, code), TotpRecoveryCode.used_ms.is_(None)
    ).values(used_ms=int(time.time() * 1000)))
    await db.commit()
    return spent.rowcount == 1


async def _spend_sms(db: AsyncSession, user_id: str, code: str) -> bool:
    row = await sms_factor(db, user_id)
    return row is not None and row.confirmed_ms is not None and await sms_codes.verify(db, user_id, code)


async def spend_code(db: AsyncSession, user_id: str, code: str, *, sms: bool = True) -> bool:
    """Spend a code: six digits are an authenticator code (or a text-message code when `sms`), anything else a recovery code."""
    code = (code or "").strip()
    if re.fullmatch(r"\d{6}", code):
        return await _spend_totp(db, user_id, code) or (sms and await _spend_sms(db, user_id, code))
    return await _spend_recovery(db, user_id, code)


async def _new_recovery_codes(db: AsyncSession, user_id: str) -> list:
    codes = totp.new_recovery_codes()
    await db.execute(delete(TotpRecoveryCode).where(TotpRecoveryCode.user_id == user_id))
    for code in codes:
        db.add(TotpRecoveryCode(id=str(uuid.uuid4()), user_id=user_id, code_hash=totp.recovery_hash(user_id, code)))
    return codes


async def _async(fn, *args):
    """Lets the synchronous encryption helpers go through the same 503 handling as the awaited ones."""
    return fn(*args)


def register(api_router, srv):
    async def _user(db, user):
        row = (await db.execute(select(User).where(User.id == user["_id"]))).scalar_one_or_none()
        if row is None:
            raise HTTPException(401, "User not found")
        return row

    def _check_password(db_user: User, password: str) -> None:
        # 400, not 401: the session is valid, and a 401 would sign the person out over a typo.
        if not srv.verify_password(password, db_user.password_hash):
            raise HTTPException(400, "Password is incorrect")

    async def _unavailable(call):
        try:
            return await call
        except totp.TotpUnavailable as exc:
            raise HTTPException(503, str(exc))

    async def _require_proof(db, db_user: User, body: ProofBody) -> None:
        """When two-step is on, one proof of the second step: a code from any method, or a passkey. Guesses are counted per account,
        whoever makes them (six digits are not many)."""
        if not await enabled(db, db_user.id):
            return
        if body.passkey is None and not (body.code or "").strip():
            raise HTTPException(400, NEED_PROOF)
        await srv.throttle_account("totp", db_user.email, TOTP_ATTEMPTS, TOTP_WINDOW_SECONDS, "code attempts")
        if body.passkey is not None:
            good = await passkeys.verify_assertion(db, db_user.id, "proof", body.passkey.challenge_id, body.passkey.credential)
        else:
            good = await _unavailable(spend_code(db, db_user.id, body.code))
        if not good:
            raise HTTPException(400, BAD_PASSKEY if body.passkey is not None else BAD_CODE)
        await srv.forgive_account("totp", db_user.email)

    srv.require_second_step = _require_proof   # also asked for by changing the password and the sign-in address

    async def _gate(request, user, db, body: PasswordBody, what: str) -> User:
        """Password, then (when two-step is on) one proof. Returns the user."""
        await srv.check_rate_limit(request, f"{user['_id']}:2fa-{what}")
        db_user = await _user(db, user)
        _check_password(db_user, body.password)
        await _require_proof(db, db_user, body)
        return db_user

    async def _remove(db, user_id: str, method: str, background: BackgroundTasks, db_user: User, passkey_id: Optional[str] = None) -> None:
        """Take one method away. When it was the last, two-step is off: the recovery codes go too."""
        if method == "totp":
            await db.execute(delete(TotpCredential).where(TotpCredential.user_id == user_id))
        elif method == "sms":
            await db.execute(delete(SmsCode).where(SmsCode.user_id == user_id))
            await db.execute(delete(SmsFactor).where(SmsFactor.user_id == user_id))
        else:
            await db.execute(delete(WebauthnCredential).where(WebauthnCredential.user_id == user_id, WebauthnCredential.id == passkey_id))
        await db.commit()
        if not await enabled(db, user_id):
            await db.execute(delete(TotpRecoveryCode).where(TotpRecoveryCode.user_id == user_id))
            await db.commit()
            background.add_task(email_service.send_security_notice, db_user.email, db_user.name, "two_factor_off")
        else:
            background.add_task(email_service.send_security_notice, db_user.email, db_user.name, f"method_removed_{method}")

    async def _confirmed(db, db_user: User, method: str, was_on: bool, background: BackgroundTasks) -> list:
        """A method has just been confirmed: the first one also hands over the recovery codes (shown once)."""
        codes = [] if was_on else await _new_recovery_codes(db, db_user.id)
        await db.commit()
        background.add_task(email_service.send_security_notice, db_user.email, db_user.name, f"method_added_{method}" if was_on else "two_factor_on")
        return codes

    # -- status -----------------------------------------------------------------------------------------------------------

    @api_router.get("/auth/2fa")
    async def two_factor_status(user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        return await status(db, user["_id"])

    # -- authenticator app ------------------------------------------------------------------------------------------------

    @api_router.post("/auth/2fa/setup")
    async def two_factor_setup(body: PasswordBody, request: Request, user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        """Start setting up the authenticator app: a fresh secret. Nothing is switched on until a code from the app is typed in."""
        db_user = await _gate(request, user, db, body, "setup")
        existing = await credential(db, db_user.id)
        if existing is not None and existing.confirmed_ms is not None:
            raise HTTPException(400, "The authenticator app is already set up. Remove it first to set it up again.")
        secret = totp.new_secret()
        encrypted = await _unavailable(_async(totp.encrypt_secret, secret))
        await db.execute(delete(TotpCredential).where(TotpCredential.user_id == db_user.id))
        db.add(TotpCredential(user_id=db_user.id, secret_enc=encrypted, confirmed_ms=None, last_step=0, created_ms=int(time.time() * 1000)))
        await db.commit()
        return {"secret": " ".join(secret[i:i + 4] for i in range(0, len(secret), 4)), "uri": totp.otpauth_uri(secret, db_user.email)}

    @api_router.post("/auth/2fa/enable")
    async def two_factor_enable(body: CodeBody, request: Request, background: BackgroundTasks,
                                user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        """Finish the authenticator setup with a first code from the app. The first method also returns the recovery codes."""
        await srv.check_rate_limit(request, f"{user['_id']}:2fa-enable")
        db_user = await _user(db, user)
        row = await credential(db, db_user.id)
        if row is None or row.confirmed_ms is not None:
            raise HTTPException(400, "Start the setup first." if row is None else "The authenticator app is already set up.")
        step = totp.verify(await _unavailable(_async(totp.decrypt_secret, row.secret_enc)), body.code.strip(), last_step=0)
        if step is None:
            raise HTTPException(400, BAD_CODE)
        was_on = await enabled(db, db_user.id)
        row.confirmed_ms, row.last_step = int(time.time() * 1000), step
        return {"recovery_codes": await _confirmed(db, db_user, "totp", was_on, background)}

    @api_router.post("/auth/2fa/totp/remove")
    async def totp_remove(body: PasswordBody, request: Request, background: BackgroundTasks,
                          user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        db_user = await _gate(request, user, db, body, "remove")
        row = await credential(db, db_user.id)
        if row is None:
            raise HTTPException(400, "The authenticator app is not set up.")
        await _remove(db, db_user.id, "totp", background, db_user)
        return {"ok": True}

    # -- passkeys ---------------------------------------------------------------------------------------------------------

    @api_router.post("/auth/2fa/passkeys/options")
    async def passkey_register_options(body: PasswordBody, request: Request, user: dict = Depends(srv.get_current_user),
                                       db: AsyncSession = Depends(srv.get_db)):
        """Begin registering a passkey: the password (and a proof, when two-step is on) first, then the browser's prompt."""
        db_user = await _gate(request, user, db, body, "passkey")
        rp_id, origin = passkeys.rp_for(request)
        challenge_id, options = await passkeys.begin_registration(db, db_user, rp_id, origin)
        return {"challenge_id": challenge_id, "options": options}

    @api_router.post("/auth/2fa/passkeys")
    async def passkey_register(body: PasskeyFinishBody, request: Request, background: BackgroundTasks,
                               user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        await srv.check_rate_limit(request, f"{user['_id']}:2fa-passkey-finish")
        db_user = await _user(db, user)
        was_on = await enabled(db, db_user.id)
        row = await passkeys.finish_registration(db, db_user, body.challenge_id, body.credential, body.name)
        if row is None:
            raise HTTPException(400, "That passkey could not be added. Try again.")
        codes = await _confirmed(db, db_user, "passkey", was_on, background)
        return {"recovery_codes": codes, "passkey": passkeys.public(row)}

    @api_router.post("/auth/2fa/passkeys/{passkey_id}/rename")
    async def passkey_rename(passkey_id: str, body: PasskeyNameBody, user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        done = await db.execute(update(WebauthnCredential).where(WebauthnCredential.id == passkey_id, WebauthnCredential.user_id == user["_id"])
                                .values(name=body.name.strip()[:60] or "Passkey"))
        await db.commit()
        if done.rowcount != 1:
            raise HTTPException(404, "Passkey not found")
        return {"ok": True}

    @api_router.post("/auth/2fa/passkeys/{passkey_id}/remove")
    async def passkey_remove(passkey_id: str, body: PasswordBody, request: Request, background: BackgroundTasks,
                             user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        db_user = await _gate(request, user, db, body, "remove")
        owned = (await db.execute(select(WebauthnCredential.id).where(WebauthnCredential.id == passkey_id, WebauthnCredential.user_id == db_user.id))).first()
        if owned is None:
            raise HTTPException(404, "Passkey not found")
        await _remove(db, db_user.id, "passkey", background, db_user, passkey_id)
        return {"ok": True}

    @api_router.post("/auth/2fa/proof/passkey-options")
    async def proof_passkey_options(request: Request, user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        """The browser's prompt for proving it is you with a passkey before a change (the answer goes with the change itself)."""
        await srv.check_rate_limit(request, f"{user['_id']}:2fa-proof-options")
        db_user = await _user(db, user)
        rp_id, origin = passkeys.rp_for(request)
        challenge_id, options = await passkeys.begin_assertion(db, db_user, "proof", rp_id, origin)
        return {"challenge_id": challenge_id, "options": options}

    # -- text messages ----------------------------------------------------------------------------------------------------

    def _text_body(code: str) -> str:
        text = f"{code} is your Life Record code. It expires in 5 minutes. Never share it."
        front = urllib.parse.urlparse(os.environ.get("FRONTEND_URL", ""))
        if front.scheme == "https" and front.hostname:  # lets Android Chrome offer the code on the page (WebOTP)
            text += f"\n\n@{front.hostname} #{code}"
        return text

    async def _send_code(db, db_user: User, phone_enc: str) -> dict:
        """Make a fresh code and text it. Spaced (60 s), capped per account and for the whole server, and a code that could not be sent is not kept."""
        if not sms_service.available():
            raise HTTPException(503, SMS_OFF)
        wait = await sms_codes.seconds_until_resend(db, db_user.id)
        if wait:
            raise HTTPException(429, f"A code was just sent. You can ask for another in {wait} seconds.", headers={"Retry-After": str(wait)})
        await srv.throttle_account("sms-send", db_user.email, SMS_PER_USER_PER_HOUR, 3600, "text messages")
        if await srv.claim_global_slot("sms-send", 3600, int(os.environ.get("SMS_MAX_PER_HOUR", "60"))) is not None:
            raise HTTPException(503, "Too many text messages have been sent in the last hour. Try again later, or use another way.")
        phone = await _unavailable(_async(totp.decrypt_secret, phone_enc))
        code = sms_codes.new_code()
        sent_ms = await sms_codes.store(db, db_user.id, code)
        try:
            await sms_service.send(phone, _text_body(code))
        except sms_service.SmsError as exc:
            await sms_codes.discard(db, db_user.id, sent_ms)
            raise HTTPException(400 if str(exc) == sms_service.BAD_NUMBER else 503, str(exc))
        return {"sent": True, "resend_in": sms_codes.RESEND_GAP_SECONDS}

    @api_router.post("/auth/2fa/sms/start")
    async def sms_start(body: SmsStartBody, request: Request, user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        """Begin setting up text messages: the password (and a proof), the number, and a code sent to it."""
        if not sms_service.available():
            raise HTTPException(503, SMS_OFF)
        db_user = await _gate(request, user, db, body, "sms")
        phone = sms_service.normalise_phone(body.phone)
        if phone is None:
            raise HTTPException(400, sms_service.BAD_NUMBER)
        existing = await sms_factor(db, db_user.id)
        if existing is not None and existing.confirmed_ms is not None:
            raise HTTPException(400, "Text messages are already on. Remove them first to use another number.")
        encrypted = await _unavailable(_async(totp.encrypt_secret, phone))
        await db.execute(delete(SmsFactor).where(SmsFactor.user_id == db_user.id))
        db.add(SmsFactor(user_id=db_user.id, phone_enc=encrypted, phone_hint=sms_service.hint_for(phone), confirmed_ms=None,
                         created_ms=int(time.time() * 1000)))
        await db.commit()
        try:
            sent = await _send_code(db, db_user, encrypted)
        except HTTPException as exc:
            if exc.status_code != 429:  # a code is already on its way: keep the number, the person can wait and resend
                await db.execute(delete(SmsFactor).where(SmsFactor.user_id == db_user.id, SmsFactor.confirmed_ms.is_(None)))
                await db.commit()
            raise
        return {**sent, "hint": sms_service.hint_for(phone)}

    @api_router.post("/auth/2fa/sms/resend")
    async def sms_resend(request: Request, user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        await srv.check_rate_limit(request, f"{user['_id']}:2fa-sms-resend")
        db_user = await _user(db, user)
        row = await sms_factor(db, db_user.id)
        if row is None or row.confirmed_ms is not None:
            raise HTTPException(400, "Start the text-message setup first.")
        return await _send_code(db, db_user, row.phone_enc)

    @api_router.post("/auth/2fa/sms/confirm")
    async def sms_confirm(body: CodeBody, request: Request, background: BackgroundTasks,
                          user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        await srv.check_rate_limit(request, f"{user['_id']}:2fa-sms-confirm")
        db_user = await _user(db, user)
        row = await sms_factor(db, db_user.id)
        if row is None or row.confirmed_ms is not None:
            raise HTTPException(400, "Start the text-message setup first." if row is None else "Text messages are already on.")
        if not await sms_codes.verify(db, db_user.id, body.code):
            raise HTTPException(400, BAD_CODE)
        was_on = await enabled(db, db_user.id)
        row.confirmed_ms = int(time.time() * 1000)
        return {"recovery_codes": await _confirmed(db, db_user, "sms", was_on, background), "hint": row.phone_hint}

    @api_router.post("/auth/2fa/sms/remove")
    async def sms_remove(body: PasswordBody, request: Request, background: BackgroundTasks,
                         user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        db_user = await _gate(request, user, db, body, "remove")
        if await sms_factor(db, db_user.id) is None:
            raise HTTPException(400, "Text messages are not set up.")
        await _remove(db, db_user.id, "sms", background, db_user)
        return {"ok": True}

    @api_router.post("/auth/2fa/proof/sms-send")
    async def proof_sms_send(request: Request, user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        """Text a code to the confirmed number, to prove it is you before a change (the code goes with the change itself)."""
        await srv.check_rate_limit(request, f"{user['_id']}:2fa-proof-sms")
        db_user = await _user(db, user)
        row = await sms_factor(db, db_user.id)
        if row is None or row.confirmed_ms is None:
            raise HTTPException(400, "Text messages are not set up.")
        return {**await _send_code(db, db_user, row.phone_enc), "hint": row.phone_hint}

    # -- turning it off, new recovery codes -------------------------------------------------------------------------------

    @api_router.post("/auth/2fa/disable")
    async def two_factor_disable(body: PasswordBody, request: Request, background: BackgroundTasks,
                                 user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        """Turn the whole second step off: every method and every recovery code. Needs the password AND a proof, so a stolen session cannot do it alone."""
        db_user = await _gate(request, user, db, body, "disable")
        if not await enabled(db, db_user.id):
            raise HTTPException(400, "Two-step sign-in is not on.")
        await _remove_all(db, db_user.id)
        await db.commit()
        background.add_task(email_service.send_security_notice, db_user.email, db_user.name, "two_factor_off")
        return {"ok": True}

    @api_router.post("/auth/2fa/recovery-codes")
    async def two_factor_new_recovery_codes(body: PasswordBody, request: Request,
                                            user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        """A fresh set of recovery codes; the old ones stop working."""
        db_user = await _gate(request, user, db, body, "recovery")
        if not await enabled(db, db_user.id):
            raise HTTPException(400, "Two-step sign-in is not on.")
        codes = await _new_recovery_codes(db, db_user.id)
        await db.commit()
        return {"recovery_codes": codes}

    # -- signing in -------------------------------------------------------------------------------------------------------

    async def _challenged_user(db, token: str) -> User:
        try:
            payload = decode_token(token, token_type="totp_challenge")
        except jwt.InvalidTokenError:
            raise HTTPException(401, BAD_CODE)
        user_id = payload.get("sub")
        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none() if user_id else None
        if user is None or not user.email_verified or not await enabled(db, user.id):  # it may have been turned off since the challenge
            raise HTTPException(401, BAD_CODE)
        return user

    async def _count_attempt(request, user: User) -> None:
        await srv.check_rate_limit(request, f"{user.id}:totp")
        # Whoever makes them, from wherever: ten tries per account per window (six digits are not many).
        await srv.throttle_account("totp", user.email, TOTP_ATTEMPTS, TOTP_WINDOW_SECONDS, "code attempts")

    async def _finish_login(request, response, background, db, user: User) -> dict:
        await srv.forgive_logins(user.email)
        await srv.forgive_account("totp", user.email)
        if srv._wants_cookie(request) and srv._known_device_user(request) != user.id:
            background.add_task(email_service.send_security_notice, user.email, user.name, "new_sign_in",
                                srv.device_label(request.headers.get("User-Agent", "")))
        return await srv._issue_session(request, response, db, user,
                                        {"user": {"id": user.id, "email": user.email, "name": user.name, "email_verified": True}})

    @api_router.post("/auth/login/totp")
    async def login_with_code(body: TotpLoginBody, request: Request, response: Response, background: BackgroundTasks, db: AsyncSession = Depends(srv.get_db)):
        """The second half of signing in: the challenge from /auth/login plus a current authenticator code or a recovery code."""
        user = await _challenged_user(db, body.challenge)
        await _count_attempt(request, user)
        if not await _unavailable(spend_code(db, user.id, body.code, sms=False)):
            raise HTTPException(401, BAD_CODE)
        return await _finish_login(request, response, background, db, user)

    @api_router.post("/auth/login/passkey/options")
    async def login_passkey_options(body: ChallengeBody, request: Request, db: AsyncSession = Depends(srv.get_db)):
        user = await _challenged_user(db, body.challenge)
        await srv.check_rate_limit(request, f"{user.id}:2fa-login-options")
        rp_id, origin = passkeys.rp_for(request)
        challenge_id, options = await passkeys.begin_assertion(db, user, "login", rp_id, origin)
        return {"challenge_id": challenge_id, "options": options}

    @api_router.post("/auth/login/passkey")
    async def login_with_passkey(body: PasskeyLoginBody, request: Request, response: Response, background: BackgroundTasks,
                                 db: AsyncSession = Depends(srv.get_db)):
        user = await _challenged_user(db, body.challenge)
        await _count_attempt(request, user)
        if not await passkeys.verify_assertion(db, user.id, "login", body.challenge_id, body.credential):
            raise HTTPException(401, BAD_PASSKEY)
        return await _finish_login(request, response, background, db, user)

    @api_router.post("/auth/login/sms/send")
    async def login_sms_send(body: ChallengeBody, request: Request, db: AsyncSession = Depends(srv.get_db)):
        user = await _challenged_user(db, body.challenge)
        await srv.check_rate_limit(request, f"{user.id}:2fa-login-sms")
        row = await sms_factor(db, user.id)
        if row is None or row.confirmed_ms is None:
            raise HTTPException(400, "Text messages are not set up for this account.")
        return {**await _send_code(db, user, row.phone_enc), "hint": row.phone_hint}

    @api_router.post("/auth/login/sms")
    async def login_with_sms(body: TotpLoginBody, request: Request, response: Response, background: BackgroundTasks,
                             db: AsyncSession = Depends(srv.get_db)):
        user = await _challenged_user(db, body.challenge)
        await _count_attempt(request, user)
        if not await _spend_sms(db, user.id, body.code):
            raise HTTPException(401, BAD_CODE)
        return await _finish_login(request, response, background, db, user)


async def unreadable_secrets(db: AsyncSession) -> list:
    """The ids of accounts whose second-step secrets cannot be read with the encryption key the server has now. Empty when all is well.
    Run at start-up: a lost or changed UPLOAD_ENCRYPTION_KEY would otherwise show up only as people who cannot sign in."""
    bad = set()
    rows = (await db.execute(select(TotpCredential.user_id, TotpCredential.secret_enc).where(TotpCredential.confirmed_ms.is_not(None)))).all()
    rows += (await db.execute(select(SmsFactor.user_id, SmsFactor.phone_enc).where(SmsFactor.confirmed_ms.is_not(None)))).all()
    for user_id, stored in rows:
        try:
            totp.decrypt_secret(stored)
        except totp.TotpUnavailable:
            bad.add(user_id)
    return sorted(bad)


async def remove_second_step(db: AsyncSession, user_id: str) -> None:
    """Turn it off for a user: every method and every recovery code. Also used by the owner's command-line tool."""
    await _remove_all(db, user_id)
    await db.commit()


async def _remove_all(db: AsyncSession, user_id: str) -> None:
    for table in (TotpRecoveryCode, TotpCredential, SmsCode, SmsFactor, WebauthnCredential):
        await db.execute(delete(table).where(table.user_id == user_id))
