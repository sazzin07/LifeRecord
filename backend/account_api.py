"""Your data, and your account: export everything, or delete the account (S-11).

Registered the same way as the other domain modules (`register(api_router, server_module)`), so it uses the server's
own session, database and password helpers rather than reimplementing them.
"""
from datetime import datetime, timezone

from fastapi import BackgroundTasks, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import account_data
import account_status
import email_service
from models import Photo, User


class DeleteAccountBody(BaseModel):
    password: str = Field(..., min_length=1, max_length=200)
    confirm: str = Field(..., max_length=100)


class DeactivateAccountBody(BaseModel):
    password: str = Field(..., min_length=1, max_length=200)


def register(api_router, srv):
    @api_router.get("/account/export")
    async def export_account(user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        """Everything in the account as a .zip: data.json plus the original pictures. Never contains a secret."""
        await srv.usage_limits.check_user_limit(user["_id"], "account_export")
        db_user = (await db.execute(select(User).where(User.id == user["_id"]))).scalar_one()
        blob = await account_data.build_export(srv, db, db_user)
        name = f"liferecord-export-{datetime.now(timezone.utc).strftime('%Y-%m-%d')}.zip"
        return Response(content=blob, media_type="application/zip",
                        headers={"Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store"})

    @api_router.post("/account/deactivate")
    async def deactivate_account(body: DeactivateAccountBody, request: Request, response: Response, background: BackgroundTasks,
                                 user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        """Switch the account off without deleting anything: every session ends at once and nobody can sign in until it is
        switched back on (by the emailed reset link, see account_status.py). Needs the current password; the owner is refused."""
        await srv.check_rate_limit(request, f"{user['_id']}:deactivate-account")  # guessing the password with a stolen session
        db_user = (await db.execute(select(User).where(User.id == user["_id"]))).scalar_one_or_none()
        if not db_user:
            raise HTTPException(401, "User not found")
        if db_user.role == "owner":
            raise HTTPException(403, "The owner account cannot be deactivated from the app. It is managed on the server (backend/owner_admin.py).")
        if not srv.verify_password(body.password, db_user.password_hash):
            raise HTTPException(400, "Password is incorrect")
        await account_status.deactivate(db, db_user.id, account_status.SELF)
        background.add_task(email_service.send_security_notice, db_user.email, db_user.name, "account_deactivated")
        response.delete_cookie(srv.REFRESH_COOKIE, path="/api/auth", httponly=True, secure=srv.refresh_cookie_secure(), samesite=srv.COOKIE_SAMESITE)
        return {"ok": True}

    @api_router.delete("/account")
    async def delete_account(body: DeleteAccountBody, request: Request, response: Response, background: BackgroundTasks,
                             user: dict = Depends(srv.get_current_user), db: AsyncSession = Depends(srv.get_db)):
        """Delete the account and everything in it. Needs the current password and the exact phrase; the owner account is refused."""
        await srv.check_rate_limit(request, f"{user['_id']}:delete-account")  # guessing the password with a stolen session
        db_user = (await db.execute(select(User).where(User.id == user["_id"]))).scalar_one_or_none()
        if not db_user:
            raise HTTPException(401, "User not found")
        if db_user.role == "owner":
            raise HTTPException(403, "The owner account cannot be deleted from the app. It is managed on the server (backend/owner_admin.py).")
        # 400, not 401: the session is valid, and a 401 would sign the person out over a typo.
        if not srv.verify_password(body.password, db_user.password_hash):
            raise HTTPException(400, "Password is incorrect")
        if body.confirm != account_data.CONFIRM_PHRASE:
            raise HTTPException(400, f'Type "{account_data.CONFIRM_PHRASE}" exactly to confirm')
        photo_paths = [p for p in (await db.execute(select(Photo.storage_path).where(Photo.user_id == db_user.id))).scalars().all() if p]
        email, name = db_user.email, db_user.name
        removed = await account_data.delete_account(db, db_user.id)
        await db.commit()
        # Files and the notice come after the commit: if the database refused, nothing was removed and no one is told otherwise.
        background.add_task(account_data.remove_files, srv.STORAGE_DIR, db_user.id, photo_paths)
        background.add_task(email_service.send_security_notice, email, name, "account_deleted")
        response.delete_cookie(srv.REFRESH_COOKIE, path="/api/auth", httponly=True, secure=srv.refresh_cookie_secure(), samesite=srv.COOKIE_SAMESITE)
        return {"ok": True, "removed": removed}
