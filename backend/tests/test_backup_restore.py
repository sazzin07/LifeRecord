"""S-07: a backup that has been restored is the only kind that counts. These tests run the real tools end to end on a
scratch schema: dump it, restore the dump into ANOTHER scratch schema, and compare every table."""
import datetime as dt
import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

import isolated_env as ie
from support_populate import populate
from support_users import create_verified_user

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / "tools"
sys.path.insert(0, str(TOOLS))
import backup  # noqa: E402

isolated_only = pytest.mark.skipif(os.environ.get("LR_ISOLATED") != "1", reason="dumps whatever DATABASE_NAME points at; run it on the scratch schema")


def _name(day, hour=3, suffix=".zip"):
    return f"liferecord-{day.strftime('%Y%m%d')}-{hour:02d}0000{suffix}"


def test_retention_keeps_a_backup_per_day_for_two_weeks_and_per_week_for_two_months():
    now = dt.datetime(2026, 11, 1, 12, 0, tzinfo=dt.timezone.utc)
    names = [_name(now - dt.timedelta(days=d)) for d in range(0, 120)]
    keep = set(names) - set(backup.plan_retention(names, now, daily=14, weekly=8))
    days = {n for n in keep if now - backup.parsed_time(n) < dt.timedelta(days=14)}
    assert len(days) == 14                                   # one for each of the last 14 days
    assert 14 + 6 <= len(keep) <= 14 + 9               # plus about one per week for the next 8 weeks
    assert _name(now) in keep                                # the newest is never removed
    assert _name(now - dt.timedelta(days=119)) not in keep   # anything older than the weekly window goes


def test_two_backups_on_one_day_keep_only_the_latest_of_that_day():
    now = dt.datetime(2026, 11, 1, 12, 0, tzinfo=dt.timezone.utc)
    names = [_name(now, 1), _name(now, 9), _name(now, 5)]
    assert sorted(backup.plan_retention(names, now, daily=14, weekly=8)) == sorted([_name(now, 1), _name(now, 5)])


def test_files_that_are_not_ours_are_never_planned_for_deletion():
    now = dt.datetime(2026, 11, 1, tzinfo=dt.timezone.utc)
    assert backup.plan_retention(["notes.txt", "liferecord-latest.zip", "photo.jpg"], now, daily=14, weekly=8) == []


@isolated_only
def test_a_backup_can_be_restored_and_every_table_matches(tmp_path):
    user = create_verified_user("export")
    populate(user)
    dest = tmp_path / "backups"
    made = subprocess.run([sys.executable, str(TOOLS / "backup.py"), "--dest", str(dest), "--encrypt", "none"], capture_output=True, text=True, timeout=300)
    assert made.returncode == 0, made.stdout[-1200:] + made.stderr[-1200:]
    archives = list(dest.glob("liferecord-*.zip"))
    assert len(archives) == 1
    with zipfile.ZipFile(archives[0]) as zf:
        names = zf.namelist()
        manifest = json.loads(zf.read("MANIFEST.json"))
    assert "liferecord.sql" in names and any(n.startswith("storage/") for n in names)  # the database and the (encrypted) uploads
    assert manifest["tables"]["users"] >= 1 and manifest["tables"]["transactions"] >= 1
    text = made.stdout + made.stderr
    assert os.environ["ADMIN_DATABASE_PASSWORD"] not in text and os.environ["ADMIN_DATABASE_PASSWORD"] not in json.dumps(manifest)

    checked = subprocess.run([sys.executable, str(TOOLS / "restore_check.py"), "--backup", str(archives[0])], capture_output=True, text=True, timeout=600)
    assert checked.returncode == 0, checked.stdout[-1500:] + checked.stderr[-1500:]
    assert "ALL TABLES MATCH" in checked.stdout
    assert not [n for n in _scratch_schemas() if "restore" in n]  # the rehearsal schema is gone again


def _scratch_schemas():
    conn = ie._admin_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME LIKE 'liferecord%%'")
            return [r[0] for r in cur.fetchall()]
    finally:
        conn.close()


@isolated_only
def test_a_damaged_backup_is_reported_not_trusted(tmp_path):
    dest = tmp_path / "backups"
    subprocess.run([sys.executable, str(TOOLS / "backup.py"), "--dest", str(dest), "--encrypt", "none"], check=True, capture_output=True, timeout=300)
    archive = next(dest.glob("liferecord-*.zip"))
    broken = tmp_path / "liferecord-20260101-000000.zip"
    with zipfile.ZipFile(archive) as src, zipfile.ZipFile(broken, "w") as out:
        for n in src.namelist():
            data = src.read(n)
            if n == "liferecord.sql":
                data = data.replace(b"INSERT INTO `users`", b"-- removed `users`", 1)  # a dump that lost a table's rows
            out.writestr(n, data)
    checked = subprocess.run([sys.executable, str(TOOLS / "restore_check.py"), "--backup", str(broken)], capture_output=True, text=True, timeout=600)
    assert checked.returncode != 0 and "MISMATCH" in checked.stdout


def test_encrypted_and_plain_backups_are_both_ours_for_retention():
    now = dt.datetime(2026, 11, 1, 12, 0, tzinfo=dt.timezone.utc)
    names = [_name(now - dt.timedelta(days=d), suffix=".zip.dpapi") for d in range(0, 3)] + [_name(now - dt.timedelta(days=3))]
    assert backup.plan_retention(names, now) == []                      # all four are within the daily window
    old = _name(now - dt.timedelta(days=200), suffix=".zip.dpapi")
    assert backup.plan_retention(names + [old], now) == [old]           # an old encrypted one is pruned like any other


@pytest.mark.skipif(sys.platform != "win32", reason="DPAPI is a Windows feature")
def test_dpapi_file_encryption_round_trips_across_chunks_and_rejects_damage(tmp_path, monkeypatch):
    import local_secrets
    monkeypatch.setattr(local_secrets, "_CHUNK", 1000)                    # several chunks from a small file
    plain = tmp_path / "plain.bin"
    plain.write_bytes(os.urandom(4321))
    sealed, back = tmp_path / "plain.bin.dpapi", tmp_path / "back.bin"
    local_secrets.encrypt_file(plain, sealed)
    assert plain.read_bytes()[:64] not in sealed.read_bytes()             # not readable without Windows' help
    local_secrets.decrypt_file(sealed, back)
    assert back.read_bytes() == plain.read_bytes()
    sealed.write_bytes(sealed.read_bytes()[:-50])                         # cut short
    with pytest.raises(local_secrets.SecretsError):
        local_secrets.decrypt_file(sealed, tmp_path / "nope.bin")
    other = tmp_path / "other.bin"
    other.write_bytes(b"not a backup")
    with pytest.raises(local_secrets.SecretsError):
        local_secrets.decrypt_file(other, tmp_path / "nope2.bin")


@pytest.mark.skipif(sys.platform != "win32", reason="DPAPI is a Windows feature")
def test_the_default_backup_is_encrypted_restorable_and_logged(tmp_path):
    user = create_verified_user("export")
    populate(user)
    dest = tmp_path / "backups"
    made = subprocess.run([sys.executable, str(TOOLS / "backup.py"), "--dest", str(dest)], capture_output=True, text=True, timeout=300)
    assert made.returncode == 0, made.stdout[-1200:] + made.stderr[-1200:]
    assert not list(dest.glob("liferecord-*.zip"))                        # no plain archive is left behind
    sealed = list(dest.glob("liferecord-*.zip.dpapi"))
    assert len(sealed) == 1 and not zipfile.is_zipfile(sealed[0])
    assert b"CREATE TABLE" not in sealed[0].read_bytes() and b"MANIFEST" not in sealed[0].read_bytes()
    assert "OK" in (dest / "backup.log").read_text(encoding="utf-8")
    checked = subprocess.run([sys.executable, str(TOOLS / "restore_check.py"), "--dest", str(dest)], capture_output=True, text=True, timeout=600)
    assert checked.returncode == 0, checked.stdout[-1500:] + checked.stderr[-1500:]
    assert "ALL TABLES MATCH" in checked.stdout
    # a run that cannot work (a login that is refused) says so in the log instead of dying silently
    broken = subprocess.run([sys.executable, str(TOOLS / "backup.py"), "--dest", str(dest)], capture_output=True, text=True, timeout=300,
                            env={**os.environ, "DATABASE_NAME": "liferecord_does_not_exist"})
    assert broken.returncode != 0
    assert "FAIL" in (dest / "backup.log").read_text(encoding="utf-8")
