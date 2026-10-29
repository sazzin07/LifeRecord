"""Direct database access for tests (reading verification codes, removing test users).

Uses the administrative login (ADMIN_DATABASE_USER / ADMIN_DATABASE_PASSWORD from the encrypted store or the
environment), not the restricted account the app runs as.
"""
import os
import sys
from pathlib import Path

import pymysql

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import local_secrets  # noqa: E402

local_secrets.load_into_environ()


def connect(**kwargs):
    return pymysql.connect(host="127.0.0.1", port=3306, user=os.environ.get("ADMIN_DATABASE_USER", "root"),
                           password=os.environ.get("ADMIN_DATABASE_PASSWORD", ""), database="liferecord", **kwargs)


def issue_reset_token(email: str) -> str:
    """What the emailed link would carry: a valid reset token whose hash is stored for the user (as the app does)."""
    import datetime as dt
    from security_utils import create_password_reset_token, hash_token
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM users WHERE email=%s", (email,))
            token = create_password_reset_token(cur.fetchone()[0])
            expires = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=30)).isoformat()
            cur.execute("UPDATE users SET password_reset_token=%s, password_reset_expires_at=%s WHERE email=%s",
                        (hash_token(token), expires, email))
        conn.commit()
        return token
    finally:
        conn.close()
