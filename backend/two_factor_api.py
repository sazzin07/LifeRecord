"""The optional second step at sign-in: set it up, sign in with it, recover from a lost phone, turn it off.

Once it is on, a correct password only earns a short-lived CHALLENGE (security_utils.create_totp_challenge_token); the session
starts when a current code from the authenticator app, or an unused recovery code, is also given. A password reset does not
skip it either: the emailed link proves the mailbox, not the phone. The mechanics (codes, secrets) are in totp.py.

Registered like the other domain modules (`register(api_router, server_module)`); `enabled` is also used by server.py.
"""
import re
import time
import uuid
from typing import Optional

import jwt
from fastapi import BackgroundTasks, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

import email_service
import totp
from models import TotpCredential, TotpRecoveryCode, User
from security_utils import decode_token

BAD_CODE = "That code is not right. Check the app and try again."
TOTP_ATTEMPTS = 10          # code guesses per account in the window, whoever makes them
TOTP_WINDOW_SECONDS = 900


class PasswordBody(BaseModel):
    password: str = Field(..., min_length=1, max_length=255)


class CodeBody(BaseModel):
    code: str = Field(..., min_length=1, max_length=40)


class PasswordAndCodeBody(BaseModel):
    password: str = Field(..., min_length=1, max_length=255)
    code: str = Field(..., min_length=1, max_length=40)


class TotpLoginBody(BaseModel):
    challenge: str = Field(..., min_length=1, max_length=2048)
    code: str = Field(..., min_length=1, max_length=40)


async def credential(db: AsyncSession, user_id: str) -> Optional[TotpCredential]:
    return (await db.execute(select(TotpCredential).where(TotpCredential.user_id == user_id))).scalar_one_or_none()


async def enabled(db: AsyncSession, user_id: str) -> bool:
    """True only for a second step the person has finished setting up (typed a first code in)."""
    row = await credential(db, user_id)
    return row is not None and row.confirmed_ms is not None


async def recovery_codes_left(db: AsyncSession, user_id: str) -> int:
    return (await db.execute(select(func.count()).select_from(TotpRecoveryCode)
                             .where(TotpRecoveryCode.user_id == user_id, TotpRecoveryCode.used_ms.is_(None)))).scalar_one()


async def _use_code(db: AsyncSession, user_id: str, row: TotpCredential, code: str) -> bool:
    """Spend a code: a current authenticator code (once per 30-second step) or an unused recovery code (once, ever).
    Each is one conditional UPDATE, so two requests carrying the same code cannot both succeed."""
    code = (code or "").strip()
    if re.fullmatch(r"\d{6}", code):
        step = totp.verify(totp.decrypt_secret(row.secret_enc), code, last_step=int(row.last_step or 0))
        if step is None:
            return False
        won = await db.execute(update(TotpCredential).where(TotpCredential.user_id == user_id, TotpCredential.last_step < step)
                               .values(last_step=step))
        await db.commit()
        return won.rowcount == 1
    spent = await db.execute(update(TotpRecoveryCode).where(
        TotpRecoveryCode.user_id == user_id, TotpRecoveryCode.code_hash == totp.recovery_hash(user_id, code), TotpRecoveryCode.used_ms.is_(None)
    ).values(used_ms=int(time.time() * 1000)))
    await db.commit()
    return spent.rowcount == 1


async def _new_recovery_codes(db: AsyncSession, user_id: str) -> list:
    codes = totp.new_recovery_codes()
    await db.execute(delete(TotpRecoveryCode).where(TotpRecoveryCode.user_id == user_id))
    for code in codes:
        db.add(TotpRecoveryCode(id=str(uuid.uuid4()), user_id=user_id, code_hash=totp.recovery_hash(user_id, code)))
    return codes


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

    @api_router.get("/auth/2fa")
    async def two_factor_status(user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        on = await enabled(db, user["_id"])
        return {"enabled": on, "recovery_codes_left": await recovery_codes_left(db, user["_id"]) if on else 0}

    @api_router.post("/auth/2fa/setup")
    async def two_factor_setup(body: PasswordBody, request: Request, user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        """Start setting it up: a fresh secret for the authenticator app. Nothing is switched on until a code from the app is typed in."""
        await srv.check_rate_limit(request, f"{user['_id']}:2fa-setup")
        db_user = await _user(db, user)
        _check_password(db_user, body.password)
        if await enabled(db, db_user.id):
            raise HTTPException(400, "Two-step sign-in is already on. Turn it off first to set it up again.")
        secret = totp.new_secret()
        encrypted = await _unavailable(_async(totp.encrypt_secret, secret))
        await db.execute(delete(TotpCredential).where(TotpCredential.user_id == db_user.id))
        db.add(TotpCredential(user_id=db_user.id, secret_enc=encrypted, confirmed_ms=None, last_step=0, created_ms=int(time.time() * 1000)))
        await db.commit()
        return {"secret": " ".join(secret[i:i + 4] for i in range(0, len(secret), 4)), "uri": totp.otpauth_uri(secret, db_user.email)}

    @api_router.post("/auth/2fa/enable")
    async def two_factor_enable(body: CodeBody, request: Request, background: BackgroundTasks,
                                user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        """Finish setting it up with a first code from the app, and get the recovery codes (shown this once)."""
        await srv.check_rate_limit(request, f"{user['_id']}:2fa-enable")
        db_user = await _user(db, user)
        row = await credential(db, db_user.id)
        if row is None or row.confirmed_ms is not None:
            raise HTTPException(400, "Start the setup first." if row is None else "Two-step sign-in is already on.")
        step = totp.verify(await _unavailable(_async(totp.decrypt_secret, row.secret_enc)), body.code.strip(), last_step=0)
        if step is None:
            raise HTTPException(400, BAD_CODE)
        row.confirmed_ms, row.last_step = int(time.time() * 1000), step
        codes = await _new_recovery_codes(db, db_user.id)
        await db.commit()
        background.add_task(email_service.send_security_notice, db_user.email, db_user.name, "two_factor_on")
        return {"recovery_codes": codes}

    async def _password_and_code(request, user, db, body: PasswordAndCodeBody, what: str):
        await srv.check_rate_limit(request, f"{user['_id']}:2fa-{what}")
        db_user = await _user(db, user)
        _check_password(db_user, body.password)
        row = await credential(db, db_user.id)
        if row is None or row.confirmed_ms is None:
            raise HTTPException(400, "Two-step sign-in is not on.")
        if not await _unavailable(_use_code(db, db_user.id, row, body.code)):
            raise HTTPException(400, BAD_CODE)
        return db_user

    @api_router.post("/auth/2fa/disable")
    async def two_factor_disable(body: PasswordAndCodeBody, request: Request, background: BackgroundTasks,
                                 user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        """Turn it off. Needs the password AND a current code (or a recovery code), so a stolen session cannot do it alone."""
        db_user = await _password_and_code(request, user, db, body, "disable")
        await _remove(db, db_user.id)
        await db.commit()
        background.add_task(email_service.send_security_notice, db_user.email, db_user.name, "two_factor_off")
        return {"ok": True}

    @api_router.post("/auth/2fa/recovery-codes")
    async def two_factor_new_recovery_codes(body: PasswordAndCodeBody, request: Request,
                                            user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        """A fresh set of recovery codes; the old ones stop working."""
        db_user = await _password_and_code(request, user, db, body, "recovery")
        codes = await _new_recovery_codes(db, db_user.id)
        await db.commit()
        return {"recovery_codes": codes}

    @api_router.post("/auth/login/totp")
    async def login_with_code(body: TotpLoginBody, request: Request, response: Response, background: BackgroundTasks, db: AsyncSession = Depends(srv.get_db)):
        """The second half of signing in: the challenge from /auth/login plus a current code or a recovery code."""
        try:
            payload = decode_token(body.challenge, token_type="totp_challenge")
        except jwt.InvalidTokenError:
            raise HTTPException(401, BAD_CODE)
        user_id = payload.get("sub")
        user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none() if user_id else None
        if user is None or not user.email_verified:
            raise HTTPException(401, BAD_CODE)
        await srv.check_rate_limit(request, f"{user.id}:totp")
        # Whoever makes them, from wherever: ten guesses per account per window (six digits are not many).
        await srv.throttle_account("totp", user.email, TOTP_ATTEMPTS, TOTP_WINDOW_SECONDS, "code attempts")
        row = await credential(db, user.id)
        if row is None or row.confirmed_ms is None:
            raise HTTPException(401, BAD_CODE)  # it was turned off after the challenge was issued
        if not await _unavailable(_use_code(db, user.id, row, body.code)):
            raise HTTPException(401, BAD_CODE)
        await srv.forgive_logins(user.email)
        await srv.forgive_account("totp", user.email)
        if srv._wants_cookie(request) and srv._known_device_user(request) != user.id:
            background.add_task(email_service.send_security_notice, user.email, user.name, "new_sign_in",
                                srv.device_label(request.headers.get("User-Agent", "")))
        return await srv._issue_session(request, response, db, user,
                                        {"user": {"id": user.id, "email": user.email, "name": user.name, "email_verified": True}})


async def remove_second_step(db: AsyncSession, user_id: str) -> None:
    """Turn it off for a user: the secret and every recovery code. Also used by the owner's command-line tool."""
    await _remove(db, user_id)
    await db.commit()


async def _remove(db: AsyncSession, user_id: str) -> None:
    await db.execute(delete(TotpRecoveryCode).where(TotpRecoveryCode.user_id == user_id))
    await db.execute(delete(TotpCredential).where(TotpCredential.user_id == user_id))


async def _async(fn, *args):
    """Lets the synchronous encryption helpers go through the same 503 handling as the awaited ones."""
    return fn(*args)
