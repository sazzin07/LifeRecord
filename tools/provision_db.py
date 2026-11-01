"""Give the database a least-privilege app login and a password for root. Safe to run more than once.

- DATABASE_USER (app login "liferecord") gets SELECT/INSERT/UPDATE/DELETE/CREATE/INDEX/REFERENCES on the
  liferecord database only. It cannot alter or drop tables, read other databases, or manage accounts.
- root keeps full rights but is only used for migrations, tests' cleanup and administration
  (ADMIN_DATABASE_USER / ADMIN_DATABASE_PASSWORD).
- New passwords are generated here and written to the encrypted store before the database is changed, so a
  failure part-way never locks you out. Nothing is printed.

Run from backend/ with the venv:  python ../tools/provision_db.py
"""
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import local_secrets  # noqa: E402
import pymysql  # noqa: E402

DB_NAME = "liferecord"
APP_USER = "liferecord"
HOST = "127.0.0.1"


def connect(user: str, password: str):
    return pymysql.connect(host=HOST, user=user, password=password)


def main() -> int:
    stored = local_secrets.read_store()
    admin_pw = stored.get("ADMIN_DATABASE_PASSWORD") or ""
    app_pw = stored.get("DATABASE_PASSWORD") or ""

    # Which root password works right now? (empty = not provisioned yet)
    root_is_open = False
    try:
        connect("root", "").close()
        root_is_open = True
    except pymysql.err.OperationalError:
        if not admin_pw:
            print("root has a password but none is stored; cannot continue.")
            return 1

    if root_is_open and not admin_pw:
        admin_pw = secrets.token_urlsafe(32)
    if not app_pw:
        app_pw = secrets.token_urlsafe(32)
    local_secrets.write_store({**stored, "ADMIN_DATABASE_PASSWORD": admin_pw, "DATABASE_PASSWORD": app_pw})

    conn = connect("root", "" if root_is_open else admin_pw)
    try:
        with conn.cursor() as cur:
            cur.execute(f"CREATE USER IF NOT EXISTS '{APP_USER}'@'localhost' IDENTIFIED BY %s", (app_pw,))
            cur.execute(f"ALTER USER '{APP_USER}'@'localhost' IDENTIFIED BY %s", (app_pw,))
            cur.execute(f"REVOKE ALL PRIVILEGES, GRANT OPTION FROM '{APP_USER}'@'localhost'")
            cur.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX, REFERENCES ON `{DB_NAME}`.* TO '{APP_USER}'@'localhost'")
            if root_is_open:
                cur.execute("ALTER USER 'root'@'localhost' IDENTIFIED BY %s", (admin_pw,))
            cur.execute("FLUSH PRIVILEGES")
        conn.commit()
    finally:
        conn.close()

    # Prove both logins work before reporting success.
    connect("root", admin_pw).close()
    app = pymysql.connect(host=HOST, user=APP_USER, password=app_pw, database=DB_NAME)
    with app.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM users")
    app.close()
    print(f"root now requires a password (stored encrypted); app login '{APP_USER}' works. "
          "Set DATABASE_USER=liferecord and ADMIN_DATABASE_USER=root in backend/.env.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
