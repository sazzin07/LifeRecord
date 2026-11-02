"""Used by Playwright specs that sign up a brand-new account: read the emailed code, remove the account afterwards.

    python e2e_user_tool.py code        e2e_<hex>@example.com   # plants and prints a known verification code
    python e2e_user_tool.py reset-token e2e_<hex>@example.com   # prints what the emailed reset link would carry
    python e2e_user_tool.py delete      e2e_<hex>@example.com

Works on whatever DATABASE_NAME is in the environment (the real stack or a scratch schema). Only throw-away
addresses of the form e2e_<hex>@example.com are ever touched.
"""
import re
import sys

import support_db

SAFE = re.compile(r"^e2e_[0-9a-f]{6,}@example[.]com$")


def main(argv):
    if len(argv) != 2 or argv[0] not in ("code", "reset-token", "delete") or not SAFE.fullmatch(argv[1]):
        print("usage: e2e_user_tool.py code|reset-token|delete e2e_<hex>@example.com", file=sys.stderr)
        return 2
    action, email = argv
    conn = support_db.connect()
    try:
        with conn.cursor() as cur:
            if action == "code":
                code = support_db.verification_code_for(email)
                if not code:
                    return 1
                print(code)
            elif action == "reset-token":
                print(support_db.issue_reset_token(email))
            else:
                cur.execute("DELETE FROM users WHERE email=%s AND role='user'", (email,))
                print(cur.rowcount)
        conn.commit()
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
