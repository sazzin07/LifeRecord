"""The throw-away backend used by the test suite (isolated_env.py): it must never touch the real schema, never
hold a real secret, and never be able to send mail or call a model."""
import re
import subprocess
import sys
from pathlib import Path

import pytest
import requests

import isolated_env as ie

BACKEND = Path(__file__).resolve().parents[1]


def test_only_scratch_schema_names_are_accepted():
    for ok in ("liferecord_test_123", "liferecord_test_123_4"):
        ie.assert_scratch_name(ok)
    for bad in ("liferecord", "liferecord_test_", "liferecord_test_x", "mysql", "liferecord_test_1; DROP DATABASE liferecord"):
        with pytest.raises(ValueError):
            ie.assert_scratch_name(bad)


def test_environment_points_at_the_scratch_schema_and_holds_no_real_secret():
    env = ie.build_environment("liferecord_test_9_1", "C:/tmp/storage", "root", "admin-pw", port=8123)
    assert env["DATABASE_NAME"] == "liferecord_test_9_1" and env["DATABASE_HOST"] == "127.0.0.1"
    assert env["SCHEDULER_ENABLED"] == "false"
    # every provider key is present AND blank, so neither the secrets store nor backend/.env can fill it in
    for name in ("GEMINI_API_KEY", "SENDGRID_API_KEY", "SENDGRID_FROM_EMAIL", "SMTP_PASSWORD"):
        assert env[name] == "", name
    assert (env["SMTP_HOST"], env["SMTP_PORT"]) == ("127.0.0.1", "1")  # mail goes nowhere
    # the assistant is "configured" but its address has no usable scheme: no model can ever be reached
    assert env["OPENCODE_BASE_URL"] == "scratch://dead-end" and env["OPENCODE_API_KEY"] == "scratch-key-not-a-real-key"
    # secrets the app needs are fresh random values, never the stored ones
    assert len(env["JWT_SECRET"]) >= 32 and len(env["ADMIN_PASSWORD"]) >= 16
    env2 = ie.build_environment("liferecord_test_9_2", "C:/tmp/storage", "root", "admin-pw", port=8124)
    assert env["JWT_SECRET"] != env2["JWT_SECRET"] and env["UPLOAD_ENCRYPTION_KEY"] != env2["UPLOAD_ENCRYPTION_KEY"]


def test_the_scratch_environment_can_only_reach_a_dead_end_for_mail():
    env = ie.build_environment("liferecord_test_9_3", "C:/tmp/storage", "root", "pw", port=8125)
    code = "import email_service as e; print(e.provider_name(), e.SMTP_HOST, e.SMTP_PORT, bool(e.sendgrid_key()))"
    out = subprocess.run([sys.executable, "-c", code], cwd=BACKEND, env={**ie.baseline_environ(), **env},
                         capture_output=True, text=True, timeout=60)
    assert out.stdout.strip().endswith("smtp 127.0.0.1 1 False"), out.stdout + out.stderr


def test_a_scratch_backend_starts_serves_and_is_removed():
    env = ie.start()
    try:
        assert re.fullmatch(r"liferecord_test_\d+_\d+", env.db_name)
        assert requests.get(f"{env.base_url}/api/health", timeout=10).json() == {"status": "ok"}
        r = requests.post(f"{env.base_url}/api/auth/login", json={"email": env.user_email, "password": env.user_password}, timeout=20)
        assert r.status_code == 200 and r.json()["user"]["email"] == env.user_email
        assert env.user_email.endswith("@example.com")  # a reserved domain: no real mailbox exists
        assert ie.schema_exists(env.db_name)
    finally:
        env.stop()
    assert not ie.schema_exists(env.db_name)
    assert ie.schema_exists("liferecord")  # the real schema is still there
    with pytest.raises(requests.RequestException):
        requests.get(f"{env.base_url}/api/health", timeout=3)


def test_no_script_hardcodes_the_real_schema():
    """Scripts that open their own database connection must honour DATABASE_NAME, or running them against a scratch
    stack would write to the real database (seed_john.py once did, through cleanup_account.connect())."""
    offenders = []
    for path in list(BACKEND.glob("*.py")) + list((BACKEND.parent / "tools").glob("*.py")):
        text = path.read_text(encoding="utf-8")
        if re.search(r"database\s*=\s*[\"']liferecord[\"']", text) and path.name != "provision_db.py":
            offenders.append(path.name)
    assert offenders == []
