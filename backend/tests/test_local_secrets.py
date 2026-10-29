"""The encrypted secrets store (Windows DPAPI): round trip, precedence, and the .env migration."""
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import local_secrets as ls  # noqa: E402

windows_only = pytest.mark.skipif(sys.platform != "win32", reason="DPAPI is Windows-only")


@windows_only
def test_round_trip_and_the_file_does_not_contain_the_secret(tmp_path):
    path = tmp_path / "secrets.dpapi"
    ls.write_store({"JWT_SECRET": "s3cret-value-XYZ", "SENDGRID_API_KEY": "SG.abc"}, path)
    assert ls.read_store(path) == {"JWT_SECRET": "s3cret-value-XYZ", "SENDGRID_API_KEY": "SG.abc"}
    raw = path.read_bytes()
    assert b"s3cret-value-XYZ" not in raw and b"SG.abc" not in raw and b"JWT_SECRET" not in raw


@windows_only
def test_a_corrupted_store_is_an_error_not_silently_empty(tmp_path):
    path = tmp_path / "secrets.dpapi"
    ls.write_store({"A": "b"}, path)
    path.write_bytes(path.read_bytes()[:-5] + b"xxxxx")
    with pytest.raises(ls.SecretsError):
        ls.read_store(path)


def test_a_missing_store_reads_as_empty(tmp_path):
    assert ls.read_store(tmp_path / "nope.dpapi") == {}


@windows_only
def test_load_into_environ_does_not_override_a_real_environment_variable(tmp_path):
    path = tmp_path / "secrets.dpapi"
    ls.write_store({"LR_TEST_A": "from-store", "LR_TEST_B": "from-store"}, path)
    env = {"LR_TEST_A": "from-real-env"}
    loaded = ls.load_into_environ(env, path)
    assert env == {"LR_TEST_A": "from-real-env", "LR_TEST_B": "from-store"}
    assert loaded == ["LR_TEST_B"]


def test_load_into_environ_with_no_store_is_a_no_op(tmp_path):
    env = {}
    assert ls.load_into_environ(env, tmp_path / "nope.dpapi") == []
    assert env == {}


@windows_only
def test_migrate_moves_only_secrets_and_keeps_the_rest(tmp_path):
    env_file = tmp_path / ".env"
    env_file.write_text(
        "# comment\nDATABASE_HOST=localhost\nDATABASE_PASSWORD=\nJWT_SECRET=abc123\n"
        "SENDGRID_API_KEY=SG.key\nSENDGRID_FROM_EMAIL=me@example.com\n", encoding="utf-8")
    store = tmp_path / "secrets.dpapi"
    moved = ls.migrate_env_file(env_file, store)
    assert moved == ["JWT_SECRET", "SENDGRID_API_KEY"]  # empty DATABASE_PASSWORD is not a secret worth storing
    assert ls.read_store(store) == {"JWT_SECRET": "abc123", "SENDGRID_API_KEY": "SG.key"}
    text = env_file.read_text(encoding="utf-8")
    assert "abc123" not in text and "SG.key" not in text
    assert "DATABASE_HOST=localhost" in text and "SENDGRID_FROM_EMAIL=me@example.com" in text and "# comment" in text


@windows_only
def test_migrate_merges_with_an_existing_store(tmp_path):
    store = tmp_path / "secrets.dpapi"
    ls.write_store({"GEMINI_API_KEY": "g-key"}, store)
    env_file = tmp_path / ".env"
    env_file.write_text("JWT_SECRET=abc\n", encoding="utf-8")
    ls.migrate_env_file(env_file, store)
    assert ls.read_store(store) == {"GEMINI_API_KEY": "g-key", "JWT_SECRET": "abc"}


@windows_only
def test_rotate_jwt_secret_replaces_the_value_with_a_long_random_one(tmp_path):
    store = tmp_path / "secrets.dpapi"
    ls.write_store({"JWT_SECRET": "old"}, store)
    ls.rotate_jwt_secret(store)
    new = ls.read_store(store)["JWT_SECRET"]
    assert new != "old" and len(new) >= 64
    ls.rotate_jwt_secret(store)
    assert ls.read_store(store)["JWT_SECRET"] != new


@windows_only
def test_names_lists_keys_but_never_values(tmp_path, capsys):
    store = tmp_path / "secrets.dpapi"
    ls.write_store({"JWT_SECRET": "very-secret"}, store)
    ls.main(["names", "--store", str(store)])
    out = capsys.readouterr().out
    assert "JWT_SECRET" in out and "very-secret" not in out


@windows_only
def test_run_passes_stored_secrets_to_the_command(tmp_path):
    store = tmp_path / "secrets.dpapi"
    ls.write_store({"LR_RUN_TEST": "visible-to-child"}, store)
    out = tmp_path / "out.txt"
    code = ls.main(["run", "--store", str(store), "--", sys.executable, "-c",
                    f"import os,pathlib; pathlib.Path(r'{out}').write_text(os.environ.get('LR_RUN_TEST',''))"])
    assert code == 0 and out.read_text() == "visible-to-child"
    assert "LR_RUN_TEST" not in os.environ
