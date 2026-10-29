import os
import tempfile
from pathlib import Path

# The API tests read REACT_APP_BACKEND_URL (else frontend/.env). On Windows, Python resolves "localhost" to IPv6
# first and waits ~2 s per request before falling back to IPv4, where uvicorn listens; use the IPv4 address.
if not os.environ.get("REACT_APP_BACKEND_URL"):
    _env = Path(__file__).resolve().parents[2] / "frontend" / ".env"
    if _env.exists():
        for _line in _env.read_text(encoding="utf-8").splitlines():
            if _line.startswith("REACT_APP_BACKEND_URL="):
                os.environ["REACT_APP_BACKEND_URL"] = _line.split("=", 1)[1].strip().replace("//localhost", "//127.0.0.1")

# Accounts registered by test_auth_multiuser.py and test_change_password.py (prefix_<hex>@example.com). They are removed once the whole run
# has finished: its test classes run on different xdist workers, so a per-module teardown would delete users
# another worker is still using. Their data goes with them (every user FK cascades).
TEST_USER_EMAIL = r"^(aiiso|authtest|catiso|expired|invalid|isolation|pwchange|refresh|nutri|reset|reused|session|unverified)_[0-9a-f]+@example[.]com$"


def pytest_sessionfinish(session, exitstatus):
    # Only the controller (not xdist workers) cleans up shared state.
    if hasattr(session.config, "workerinput"):
        return
    for f in Path(tempfile.gettempdir()).glob("liferecord-test-login-*.json"):
        f.unlink(missing_ok=True)
    try:
        import support_db
        conn = support_db.connect()
        try:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM users WHERE role = 'user' AND email REGEXP %s", (TEST_USER_EMAIL,))
                cur.execute("DELETE FROM email_events WHERE recipient_domain IN ('example.com', 'example.test')")
            conn.commit()
        finally:
            conn.close()
    except Exception as exc:  # cleanup must never turn a green run red
        print(f"\n[conftest] could not remove test users: {exc}")
