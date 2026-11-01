"""Remove ALL data that belongs to one account, keeping the account itself (login, name, role).

    python cleanup_account.py someone@example.com            # dry run: shows what would be removed
    python cleanup_account.py someone@example.com --apply    # does it, in one transaction

Safety:
- the user id is looked up from the email and printed; every DELETE is filtered by that id (splits through the
  account's own transactions); shared rows (products with no owner) and other users are never matched;
- everything runs in one transaction on the administrative database login: any error rolls it all back;
- afterwards it re-counts and refuses to commit if another user's row count or the shared catalog changed;
- uploaded files of that user (chat pictures, progress photos) are removed only after the commit, from their own folders;
- take a backup first (mysqldump of the liferecord database).
"""
import os
import sys
from pathlib import Path

import pymysql

sys.path.insert(0, str(Path(__file__).resolve().parent))
import local_secrets  # noqa: E402

local_secrets.load_into_environ()

# Children before parents, derived from the models: every table with a user_id (plus splits, owned through its
# transaction). It used to be a hand-kept list that had fallen behind: it missed the five nutrition tables.
import account_data  # noqa: E402

ORDER = account_data.user_tables()


def connect():
    return pymysql.connect(host="127.0.0.1", port=3306, user=os.environ.get("ADMIN_DATABASE_USER", "root"),
                           password=os.environ.get("ADMIN_DATABASE_PASSWORD", ""),
                           database=os.environ.get("DATABASE_NAME", "liferecord"), autocommit=False)


def owned_where(table: str) -> str:
    if table in account_data.OWNED_THROUGH_PARENT:
        column, parent = account_data.OWNED_THROUGH_PARENT[table]
        return f"{column} IN (SELECT id FROM {parent} WHERE user_id = %s)"
    return "user_id = %s"


def counts_for(cur, uid: str) -> dict:
    out = {}
    for t in ORDER:
        cur.execute(f"SELECT COUNT(*) FROM `{t}` WHERE {owned_where(t)}", (uid,))
        out[t] = cur.fetchone()[0]
    return out


def others_snapshot(cur, uid: str) -> dict:
    """Row counts that must not change: every other user's rows, and the shared catalog."""
    snap = {}
    for t in ORDER:
        if t == "splits":
            cur.execute("SELECT COUNT(*) FROM splits WHERE transaction_id NOT IN (SELECT id FROM transactions WHERE user_id = %s)", (uid,))
        else:
            cur.execute(f"SELECT COUNT(*) FROM `{t}` WHERE user_id IS NULL OR user_id <> %s", (uid,))
        snap[t] = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM users")
    snap["users"] = cur.fetchone()[0]
    return snap


def main(argv) -> int:
    if not argv or argv[0].startswith("-"):
        print(__doc__)
        return 2
    email, apply = argv[0].strip().lower(), "--apply" in argv
    conn = connect()
    try:
        cur = conn.cursor()
        cur.execute("SELECT id, email, role FROM users WHERE LOWER(email) = %s", (email,))
        row = cur.fetchone()
        if not row:
            print(f"No account with email {email}.")
            return 1
        uid = row[0]
        print(f"Account: {row[1]} (role {row[2]}), user id {uid}")
        before, others_before = counts_for(cur, uid), others_snapshot(cur, uid)
        photo_paths = []
        if apply:
            cur.execute("SELECT storage_path FROM photos WHERE user_id = %s", (uid,))
            photo_paths = [r[0] for r in cur.fetchall() if r[0]]
        width = max(len(t) for t in ORDER)
        print(f"\n{'table':<{width}}  before  after")
        if not apply:
            for t in ORDER:
                print(f"{t:<{width}}  {before[t]:>6}  (dry run)")
            print(f"\nTotal rows that would be removed: {sum(before.values())}. Nothing was changed. Add --apply to run it.")
            return 0
        for t in ORDER:
            cur.execute(f"DELETE FROM `{t}` WHERE {owned_where(t)}", (uid,))
        after, others_after = counts_for(cur, uid), others_snapshot(cur, uid)
        for t in ORDER:
            print(f"{t:<{width}}  {before[t]:>6}  {after[t]:>5}")
        if any(after.values()) or others_after != others_before:
            conn.rollback()
            print("\nVERIFICATION FAILED: rows remain or other data changed. Rolled back; nothing was removed.")
            return 1
        cur.execute("SELECT COUNT(*) FROM users WHERE id = %s", (uid,))
        if cur.fetchone()[0] != 1:
            conn.rollback()
            print("\nThe account itself would have been removed. Rolled back.")
            return 1
        conn.commit()
        print(f"\nCommitted. Removed {sum(before.values())} rows; the account, other users and the shared catalog are unchanged.")
    except Exception as exc:
        conn.rollback()
        print(f"Error, rolled back: {exc}")
        return 1
    finally:
        conn.close()

    # Files: only after the database commit, only inside this user's own folders.
    storage = Path(os.environ.get("STORAGE_DIR", str(Path(__file__).resolve().parent / "storage")))
    removed = account_data.remove_files(storage, uid, photo_paths)
    print(f"Files removed from storage: {removed}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
