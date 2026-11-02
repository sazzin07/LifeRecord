"""A person's data as a whole: which tables hold it, how to export it, how to remove it (S-11).

The table list is derived from the models (every table with a user_id, plus the one child table that has none), so a
table added later is exported and removed without anyone having to remember a list. Removal itself is the database's
own `ON DELETE CASCADE` from `users`; this module counts what goes, and deletes the files that live outside the
database (progress photos, pictures attached to chats), which a cascade cannot reach.
"""
import io
import json
import shutil
import zipfile
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Dict, Iterable, List

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import Base, User

# Tables with no user_id of their own: (column pointing at the parent, parent table). Owned through the parent.
OWNED_THROUGH_PARENT = {"splits": ("transaction_id", "transactions")}
# Short-lived internal state (a confirmation waiting a few minutes), not something a person created.
NOT_EXPORTED = {"ai_pending_confirmations", "auth_sessions"}
# Columns that are secrets or only meaningful to the server, kept out of an export.
SECRET_COLUMNS = {"report_recipients": {"code_hash"}}
CONFIRM_PHRASE = "DELETE MY ACCOUNT"


def user_tables() -> List[str]:
    """Every table that holds a person's data, children before parents (the order rows can be removed in)."""
    return [t.name for t in reversed(Base.metadata.sorted_tables) if "user_id" in t.c or t.name in OWNED_THROUGH_PARENT]


def _owned(table, user_id: str):
    if table.name in OWNED_THROUGH_PARENT:
        column, parent = OWNED_THROUGH_PARENT[table.name]
        parent_table = Base.metadata.tables[parent]
        return table.c[column].in_(select(parent_table.c.id).where(parent_table.c.user_id == user_id))
    return table.c.user_id == user_id


def _json_default(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray)):
        return None  # nothing in the models stores binary data; never export raw bytes into a text file
    raise TypeError(f"cannot export {type(value).__name__}")


async def row_counts(db: AsyncSession, user_id: str) -> Dict[str, int]:
    out = {}
    for name in user_tables():
        table = Base.metadata.tables[name]
        out[name] = (await db.execute(select(func.count()).select_from(table).where(_owned(table, user_id)))).scalar() or 0
    return out


async def export_tables(db: AsyncSession, user_id: str) -> Dict[str, list]:
    out = {}
    for name in reversed(user_tables()):  # parents first reads better
        if name in NOT_EXPORTED:
            continue
        table = Base.metadata.tables[name]
        columns = [c for c in table.c if c.name not in SECRET_COLUMNS.get(name, ())]
        rows = (await db.execute(select(*columns).where(_owned(table, user_id)))).mappings().all()
        out[name] = [dict(r) for r in rows]
    return out


def file_paths(srv, user_id: str, photo_paths: Iterable[str]) -> List[str]:
    """Storage-relative paths of this person's files: progress photos, and every picture attached to a chat."""
    paths = [p for p in photo_paths if p]
    folder = srv._safe_storage_path(f"chat_images/{user_id}")
    if folder.is_dir():
        root = srv.STORAGE_DIR.resolve()
        paths += [str(f.resolve().relative_to(root)).replace("\\", "/") for f in sorted(folder.rglob("*")) if f.is_file()]
    return paths


_README = """Life Record: your data
=======================

data.json   every record in your account, grouped by table (amounts are plain numbers, dates are ISO text).
files/      your progress photos and the pictures you attached in chats, as the original images.

Not included: your password and anything derived from it, sign-in codes, and short-lived internal state.
"""


async def build_export(srv, db: AsyncSession, user: User) -> bytes:
    tables = await export_tables(db, user.id)
    document = {
        "format": 1, "exported_at": datetime.now(timezone.utc).isoformat(),
        "account": {"id": user.id, "email": user.email, "name": user.name, "role": user.role,
                    "email_verified": bool(user.email_verified), "created_at": user.created_at},
        "tables": tables,
    }
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("README.txt", _README)
        zf.writestr("data.json", json.dumps(document, indent=1, ensure_ascii=False, default=_json_default))
        for rel in file_paths(srv, user.id, (p["storage_path"] for p in tables.get("photos", []))):
            try:
                zf.writestr(f"files/{rel}", srv.read_object(rel))
            except Exception:  # a file that cannot be read must not make the whole export fail; the data is still there
                srv.logger.warning("export: could not read %s", rel)
    return buffer.getvalue()


async def delete_account(db: AsyncSession, user_id: str) -> Dict[str, int]:
    """Remove the account row (everything else follows by ON DELETE CASCADE). Returns the rows that went, per table.
    The caller commits, and removes the files afterwards."""
    counts = await row_counts(db, user_id)
    await db.execute(delete(User).where(User.id == user_id))
    return counts


def remove_files(storage_root: Path, user_id: str, photo_paths: Iterable[str]) -> int:
    """Delete this person's files, only inside their own folders. Call after the database commit."""
    root = Path(storage_root).resolve()
    removed = 0
    folder = (root / "chat_images" / user_id).resolve()
    if folder.is_dir() and root in folder.parents and folder.name == user_id:
        removed += sum(1 for p in folder.rglob("*") if p.is_file())
        shutil.rmtree(folder, ignore_errors=True)
    for rel in photo_paths:
        f = (root / rel).resolve()
        if rel and f.is_file() and root in f.parents:
            f.unlink()
            removed += 1
    return removed
