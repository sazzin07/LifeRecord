import tempfile
from pathlib import Path

# Accounts registered by test_auth_multiuser.py (prefix_<hex>@example.com). They are removed once the whole run
# has finished: its test classes run on different xdist workers, so a per-module teardown would delete users
# another worker is still using. Their data goes with them (every user FK cascades).
TEST_USER_EMAIL = r"^(aiiso|authtest|catiso|expired|invalid|isolation|refresh|reset|reused|unverified)_[0-9a-f]+@example[.]com$"


def pytest_sessionfinish(session, exitstatus):
    # Only the controller (not xdist workers) cleans up shared state.
    if hasattr(session.config, "workerinput"):
        return
    for f in Path(tempfile.gettempdir()).glob("liferecord-test-login-*.json"):
        f.unlink(missing_ok=True)
    try:
        import pymysql
        conn = pymysql.connect(host="localhost", port=3306, user="root", password="", database="liferecord")
        try:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM users WHERE role = 'user' AND email REGEXP %s", (TEST_USER_EMAIL,))
            conn.commit()
        finally:
            conn.close()
    except Exception as exc:  # cleanup must never turn a green run red
        print(f"\n[conftest] could not remove test users: {exc}")
