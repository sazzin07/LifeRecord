import tempfile
from pathlib import Path


def pytest_sessionfinish(session, exitstatus):
    # Only the controller (not xdist workers) removes the shared login cache written by support_auth.login().
    if hasattr(session.config, "workerinput"):
        return
    for f in Path(tempfile.gettempdir()).glob("liferecord-test-login-*.json"):
        f.unlink(missing_ok=True)
