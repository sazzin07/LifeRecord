"""Binding a session to the browser that started it: a refresh cookie that was copied is not enough to use.

The browser makes an ECDSA P-256 key pair with WebCrypto, marked non-extractable, so the private half cannot be read out of it. When a
session starts it announces the public half (header `X-Session-Key`, a base64url JWK). From then on every refresh must carry a proof
(header `X-Session-Proof`): a base64url JSON payload {"iat": ms, "jti": random}, a dot, and the raw r||s signature over the payload.
The server checks the signature against the stored public key, that the proof is fresh, and that it was never seen before.

A thief with only the cookie (from a log, a backup, a proxy, a shoulder) can no longer refresh, however closely he follows the real
browser. Refusing him does NOT end the session, so he cannot use this to sign the owner out. Sessions that announced no key (scripts and
apps; browsers without WebCrypto or IndexedDB) are unbound and behave as before. What it does not stop: someone who holds the private
key too (the whole browser profile), or script running in the page, which can ask the browser to sign.
"""
import base64
import json
from typing import Optional

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

MAX_HEADER = 400
MAX_PROOF = 600
PROOF_TOLERANCE_MS = 120_000  # clocks differ a little; the browser also corrects for the server's clock


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _public_key(x: str, y: str):
    return ec.EllipticCurvePublicNumbers(int.from_bytes(_unb64(x), "big"), int.from_bytes(_unb64(y), "big"), ec.SECP256R1()).public_key()


def parse_public_key(header: Optional[str]) -> Optional[str]:
    """The canonical JWK text to store for a session, or None when the header is absent or is not a real P-256 key."""
    if not header or len(header) > MAX_HEADER:
        return None
    try:
        jwk = json.loads(_unb64(header))
        if jwk.get("kty") != "EC" or jwk.get("crv") != "P-256":
            return None
        _public_key(jwk["x"], jwk["y"])  # raises unless the point is really on the curve
        return json.dumps({"crv": "P-256", "kty": "EC", "x": jwk["x"], "y": jwk["y"]}, separators=(",", ":"), sort_keys=True)
    except Exception:
        return None


def verify_proof(stored_key: str, proof: Optional[str], now_ms: int) -> Optional[str]:
    """The proof's `jti` when it is a fresh, correctly signed proof for the stored key, else None."""
    if not proof or len(proof) > MAX_PROOF or proof.count(".") != 1:
        return None
    try:
        payload_text, signature_text = proof.split(".")
        signature = _unb64(signature_text)
        if len(signature) != 64:
            return None
        payload = json.loads(_unb64(payload_text))
        issued, jti = int(payload["iat"]), str(payload["jti"])
        if abs(now_ms - issued) > PROOF_TOLERANCE_MS or not 8 <= len(jti) <= 64:
            return None
        jwk = json.loads(stored_key)
        _public_key(jwk["x"], jwk["y"]).verify(
            encode_dss_signature(int.from_bytes(signature[:32], "big"), int.from_bytes(signature[32:], "big")),
            payload_text.encode(), ec.ECDSA(hashes.SHA256()))
        return jti
    except (InvalidSignature, ValueError, KeyError, TypeError):
        return None
