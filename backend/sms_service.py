"""Sending a text message (for the second step at sign-in), and reading a phone number the way people write it.

Provider: Twilio's Messages API over HTTPS. Nothing is sent unless the server is configured for it:

    SMS_PROVIDER=twilio
    TWILIO_ACCOUNT_SID=AC...                 TWILIO_AUTH_TOKEN=...  (a secret: python local_secrets.py set TWILIO_AUTH_TOKEN)
    TWILIO_FROM=+351...                      or TWILIO_MESSAGING_SERVICE_SID=MG...
    TWILIO_API_BASE=https://api.twilio.com   (only for tests, which point it at a stand-in on loopback)

A phone number is personal data: it is never written to a log here, and the errors raised carry words for the person, not the
provider's reply.
"""
import logging
import os
import re
from typing import Optional

import httpx

logger = logging.getLogger("liferecord")

BAD_NUMBER = "That does not look like a number that can receive text messages. Include the country code, for example +351 912 345 678."
SEND_FAILED = "The text message could not be sent right now. Try again in a moment, or use another way to sign in."
# Twilio's "not a valid phone number" and "not a mobile number" families
_BAD_NUMBER_CODES = {21211, 21214, 21217, 21401, 21421, 21614}


class SmsError(Exception):
    """A text message that did not go. `str()` is words fit to show a person."""


def verify_mode() -> bool:
    """True when Twilio Verify (TWILIO_VERIFY_SERVICE_SID=VA...) makes, sends and checks the codes instead of this server."""
    return bool(os.environ.get("TWILIO_VERIFY_SERVICE_SID"))


def available() -> bool:
    return (os.environ.get("SMS_PROVIDER", "").lower() == "twilio" and bool(os.environ.get("TWILIO_ACCOUNT_SID"))
            and bool(os.environ.get("TWILIO_AUTH_TOKEN"))
            and bool(verify_mode() or os.environ.get("TWILIO_FROM") or os.environ.get("TWILIO_MESSAGING_SERVICE_SID")))


def _verify_url(path: str) -> str:
    base = (os.environ.get("TWILIO_VERIFY_API_BASE") or os.environ.get("TWILIO_API_BASE") or "https://verify.twilio.com").rstrip("/")
    return f"{base}/v2/Services/{os.environ['TWILIO_VERIFY_SERVICE_SID']}/{path}"


async def _verify_post(path: str, data: dict) -> httpx.Response:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            return await client.post(_verify_url(path), data=data,
                                     auth=(os.environ["TWILIO_ACCOUNT_SID"], os.environ["TWILIO_AUTH_TOKEN"]))
    except httpx.HTTPError as exc:
        logger.warning("verification request failed: %s", type(exc).__name__)
        raise SmsError(SEND_FAILED) from exc


async def start_verification(to: str) -> None:
    """Have Twilio Verify text a code to the E.164 number `to`. Raises SmsError (words for the person) on any failure."""
    if not (available() and verify_mode()):
        raise SmsError("Text messages are not set up on this server.")
    response = await _verify_post("Verifications", {"To": to, "Channel": "sms"})
    if response.status_code < 300:
        return
    try:
        code = int(response.json().get("code") or 0)
    except Exception:
        code = 0
    logger.warning("verification refused by the provider: HTTP %s, code %s", response.status_code, code or "-")
    if code in _BAD_NUMBER_CODES or code in (60200, 60205):
        raise SmsError(BAD_NUMBER)
    raise SmsError(SEND_FAILED)


async def check_verification(to: str, code: str) -> bool:
    """True when Twilio Verify approves `code` for `to`. A wrong, expired or already-used code is False; an outage raises SmsError."""
    if not (available() and verify_mode()):
        raise SmsError("Text messages are not set up on this server.")
    response = await _verify_post("VerificationCheck", {"To": to, "Code": code})
    if response.status_code == 404 or response.status_code == 429:  # no pending verification (expired or spent) / too many checks
        return False
    if response.status_code >= 300:
        logger.warning("verification check failed: HTTP %s", response.status_code)
        raise SmsError(SEND_FAILED)
    try:
        return response.json().get("status") == "approved"
    except Exception:
        return False


def normalise_phone(text: str) -> Optional[str]:
    """'+351 912-345-678' -> '+351912345678' (E.164); None if it cannot be a number. The country code is required: guessing one
    would text a stranger."""
    raw = (text or "").strip()
    if raw.startswith("00"):
        raw = "+" + raw[2:]
    if not raw.startswith("+"):
        return None
    digits = re.sub(r"[ \-.()]", "", raw[1:])
    if not re.fullmatch(r"[1-9]\d{7,14}", digits):
        return None
    return "+" + digits


def hint_for(phone: str) -> str:
    """All a screen ever shows of the number: '+•• ••• ••• 678'."""
    return f"+•• ••• ••• {phone[-3:]}"


async def send(to: str, body: str) -> None:
    """Send `body` to the E.164 number `to`. Raises SmsError (with words for the person) on any failure."""
    if not available():
        raise SmsError("Text messages are not set up on this server.")
    base = os.environ.get("TWILIO_API_BASE", "https://api.twilio.com").rstrip("/")
    sid = os.environ["TWILIO_ACCOUNT_SID"]
    data = {"To": to, "Body": body}
    if os.environ.get("TWILIO_MESSAGING_SERVICE_SID"):
        data["MessagingServiceSid"] = os.environ["TWILIO_MESSAGING_SERVICE_SID"]
    else:
        data["From"] = os.environ["TWILIO_FROM"]
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(f"{base}/2010-04-01/Accounts/{sid}/Messages.json", data=data,
                                         auth=(sid, os.environ["TWILIO_AUTH_TOKEN"]))
    except httpx.HTTPError as exc:
        logger.warning("text message not sent: %s", type(exc).__name__)
        raise SmsError(SEND_FAILED) from exc
    if response.status_code < 300:
        return
    try:
        code = int(response.json().get("code") or 0)
    except Exception:
        code = 0
    logger.warning("text message refused by the provider: HTTP %s, code %s", response.status_code, code or "-")
    if code in _BAD_NUMBER_CODES:
        raise SmsError(BAD_NUMBER)
    raise SmsError(SEND_FAILED)
