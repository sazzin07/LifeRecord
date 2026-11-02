"""Refuse passwords that have appeared in known data breaches (Have I Been Pwned "range" API, k-anonymity).

Only the first five characters of the password's SHA-1 are sent; the service answers with every hash suffix that starts that way
and the comparison is made here, so neither the password nor its full hash leaves this server.

OFF by default: it is a call to a third party from the server, which is the owner's decision. Switch it on with
PASSWORD_BREACH_CHECK=1. It FAILS OPEN: if the service cannot be reached, answers badly or is slow (3 seconds), nobody is stopped
from choosing a password. PASSWORD_BREACH_MIN_COUNT (default 1) is how many times a password must have been seen to be refused.
"""
import hashlib
import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger("liferecord")
BREACHED_MESSAGE = "That password has appeared in known data breaches, so attackers already try it. Choose another."
RANGE_URL = os.environ.get("PASSWORD_BREACH_URL", "https://api.pwnedpasswords.com/range/")


def enabled() -> bool:
    return os.environ.get("PASSWORD_BREACH_CHECK", "").lower() in ("1", "true", "yes")


async def _fetch_range(prefix: str) -> str:
    async with httpx.AsyncClient(timeout=3.0) as client:
        # Add-Padding makes every answer look alike in size, so even the length of the reply says nothing about the password.
        response = await client.get(f"{RANGE_URL}{prefix}", headers={"Add-Padding": "true", "User-Agent": "LifeRecord-password-check"})
        response.raise_for_status()
        return response.text


async def is_breached(password: str) -> Optional[bool]:
    """True: seen in a breach. False: not seen. None: not checked (switched off, or the service could not be asked)."""
    if not enabled():
        return None
    digest = hashlib.sha1(password.encode()).hexdigest().upper()
    prefix, suffix = digest[:5], digest[5:]
    try:
        body = await _fetch_range(prefix)
    except Exception as exc:  # never a reason to stop someone: no network, a timeout, a refusal
        logger.warning("password breach check skipped: %s", type(exc).__name__)
        return None
    try:
        minimum = max(1, int(os.environ.get("PASSWORD_BREACH_MIN_COUNT", "1")))
    except ValueError:
        minimum = 1
    for line in body.splitlines():
        found, _, count = line.strip().partition(":")
        if found.upper() == suffix:
            try:
                return int(count or 0) >= minimum
            except ValueError:
                return False
    return False
