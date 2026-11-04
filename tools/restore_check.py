"""Rehearse a restore: load a backup into a throw-away schema and compare it with what the backup says it holds.

    python tools/restore_check.py --backup D:\\Backups\\LifeRecord\\liferecord-20261101-030000.zip
    python tools/restore_check.py --dest D:\\Backups\\LifeRecord          # the newest backup in that folder

It never touches the live database: it creates a schema named liferecord_test_<pid>_<n> (the only kind of schema this
project's test tooling will create or drop), restores the dump into it, counts every table, compares with the
MANIFEST.json counts and the number of upload files, and drops the schema again. Exit code 0 only if everything matches.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "backend" / "tests"))

import backup  # noqa: E402
import isolated_env as ie  # noqa: E402


def newest(dest: Path) -> Path:
    found = sorted((p for p in dest.glob("liferecord-*.zip*") if backup.NAME_RE.match(p.name)), key=lambda p: p.name)
    if not found:
        raise SystemExit(f"no backup found in {dest}")
    return found[-1]


def restored_counts(schema: str) -> dict:
    conn = ie._admin_connection(schema)
    try:
        cur = conn.cursor()
        cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = %s AND table_type = 'BASE TABLE' ORDER BY 1", (schema,))
        out = {}
        for (table,) in cur.fetchall():
            cur.execute(f"SELECT COUNT(*) FROM `{table}`")
            out[table] = cur.fetchone()[0]
        return out
    finally:
        conn.close()


def main(argv) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--backup", help="a liferecord-*.zip file")
    group.add_argument("--dest", help="a backup folder: use the newest backup in it")
    args = ap.parse_args(argv)
    archive = Path(args.backup) if args.backup else newest(Path(args.dest))
    print(f"Backup: {archive}")

    plain = None
    if archive.name.endswith(".dpapi"):
        import local_secrets
        plain = Path(tempfile.mkdtemp(prefix="lr-decrypt-")) / archive.name[:-len(".dpapi")]
        local_secrets.decrypt_file(archive, plain)   # only the Windows account that made the backup can do this
    with zipfile.ZipFile(plain or archive) as zf:
        manifest = json.loads(zf.read("MANIFEST.json"))
        upload_files = sum(1 for n in zf.namelist() if n.startswith("storage/") and not n.endswith("/"))
        tmp = tempfile.mkdtemp(prefix="lr-restore-")
        sql_path = Path(tmp) / "liferecord.sql"
        sql_path.write_bytes(zf.read("liferecord.sql"))
    if plain:
        plain.unlink(missing_ok=True)
        plain.parent.rmdir()

    user, password = backup.admin_login()
    schema = f"liferecord_test_{os.getpid()}_{700 + next(ie._counter)}"
    ie._create_schema(schema)  # refuses any name that is not a scratch schema
    try:
        with open(sql_path, "rb") as stdin:
            run = subprocess.run([backup.find_client("mysql"), "--host=127.0.0.1", f"--port={os.environ.get('DATABASE_PORT', '3306')}", f"--user={user}",
                                  "--default-character-set=utf8mb4", schema], stdin=stdin, env=backup.child_env(password), capture_output=True, text=True)
        if run.returncode != 0:
            print("RESTORE FAILED:\n" + (run.stderr or "")[-1500:])
            return 1
        got = restored_counts(schema)
    finally:
        ie._drop_schema(schema)
        sql_path.unlink(missing_ok=True)
        Path(tmp).rmdir()

    expected = manifest["tables"]
    width = max(len(t) for t in set(expected) | set(got))
    print(f"\n{'table':<{width}}  backup  restored")
    problems = []
    for table in sorted(set(expected) | set(got)):
        want, have = expected.get(table), got.get(table)
        flag = "" if want == have else "   <-- MISMATCH"
        if flag:
            problems.append(table)
        print(f"{table:<{width}}  {want if want is not None else '-':>6}  {have if have is not None else '-':>8}{flag}")
    if upload_files != manifest.get("files", upload_files):
        problems.append("storage files")
        print(f"\nupload files: manifest says {manifest['files']}, archive holds {upload_files}   <-- MISMATCH")
    if problems:
        print(f"\nMISMATCH in: {', '.join(problems)}. If the app was in use while the backup ran, back up again and retry; otherwise do not trust this backup.")
        return 1
    print(f"\nALL TABLES MATCH ({len(got)} tables, {sum(got.values())} rows, {upload_files} upload files). The restore schema was removed.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
