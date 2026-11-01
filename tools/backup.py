"""Back up the Life Record database and its uploaded files into one dated .zip (roadmap S-07).

    python tools/backup.py --dest D:\\Backups\\LifeRecord            # one backup now, then prune old ones
    python tools/backup.py --dest ... --daily 14 --weekly 8         # retention (these are the defaults)
    python tools/backup.py --dest ... --no-uploads                  # database only

What goes into liferecord-YYYYMMDD-HHMMSS.zip:
  liferecord.sql   a consistent dump (mysqldump --single-transaction) of the database named by DATABASE_NAME
  storage/...      the uploaded files exactly as stored, so still encrypted: useless without UPLOAD_ENCRYPTION_KEY
  MANIFEST.json    when, which database, row counts per table taken in the same snapshot, a hash of the dump

What does NOT go in: any secret. The administrative database login comes from the encrypted store (or the environment)
and reaches mysqldump only through its environment, never a command line. The backup holds health data and password
hashes, so keep the folder somewhere only you can read (an encrypted drive). UPLOAD_ENCRYPTION_KEY is a separate
duty (roadmap S-08): without it the photos and chat pictures in a backup cannot be opened.

A backup that has never been restored is a hope. Run tools/restore_check.py on it.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent / "backend"
sys.path.insert(0, str(BACKEND))

NAME_RE = re.compile(r"^liferecord-(\d{8})-(\d{6})\.zip$")
MYSQL_BIN = Path(r"C:\Program Files\MySQL\MySQL Server 8.4\bin")


def parsed_time(name: str) -> dt.datetime:
    m = NAME_RE.match(name)
    return dt.datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S").replace(tzinfo=dt.timezone.utc)


def plan_retention(names, now: dt.datetime, daily: int = 14, weekly: int = 8) -> list:
    """Names to delete: keep the latest backup of each of the last `daily` days, then the latest of each week for the
    next `weekly` weeks. Anything that is not one of our files is left alone."""
    ours = {n: parsed_time(n) for n in names if NAME_RE.match(n)}
    keep, by_day, by_week = set(), {}, {}
    for n, t in ours.items():
        age = (now.date() - t.date()).days
        by_day.setdefault(t.date(), []).append(n)
        if daily <= age < daily + weekly * 7:
            by_week.setdefault(t.isocalendar()[:2], []).append(n)
    for day, group in by_day.items():
        if (now.date() - day).days < daily:
            keep.add(max(group, key=ours.get))
    for group in by_week.values():
        keep.add(max(group, key=ours.get))
    return sorted(n for n in ours if n not in keep)


def find_client(name: str) -> str:
    env = os.environ.get(name.upper())
    if env:
        return env
    return shutil.which(name) or str(MYSQL_BIN / f"{name}.exe")


def admin_login():
    import local_secrets
    local_secrets.load_into_environ()
    return os.environ.get("ADMIN_DATABASE_USER", "root"), os.environ.get("ADMIN_DATABASE_PASSWORD", "")


def child_env(password: str) -> dict:
    keep = ("PATH", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "COMSPEC", "WINDIR")
    return {**{k: v for k, v in os.environ.items() if k in keep}, "MYSQL_PWD": password}


def snapshot_counts(user: str, password: str, database: str):
    """Open a consistent snapshot and count every table in it. The connection stays open: the caller starts the dump
    while it is held, so the counts describe the same moment as the dump (as far as a live system allows)."""
    import pymysql
    conn = pymysql.connect(host="127.0.0.1", port=int(os.environ.get("DATABASE_PORT", "3306")), user=user, password=password, database=database)
    cur = conn.cursor()
    cur.execute("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ")
    cur.execute("START TRANSACTION WITH CONSISTENT SNAPSHOT")
    cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = %s AND table_type = 'BASE TABLE' ORDER BY 1", (database,))
    counts = {}
    for (table,) in cur.fetchall():
        cur.execute(f"SELECT COUNT(*) FROM `{table}`")
        counts[table] = cur.fetchone()[0]
    return conn, counts


def main(argv) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dest", required=True, help="folder for the backups (outside the project, ideally another drive)")
    ap.add_argument("--daily", type=int, default=14, help="keep the latest backup of each of the last N days")
    ap.add_argument("--weekly", type=int, default=8, help="then the latest of each week for N weeks")
    ap.add_argument("--no-uploads", action="store_true", help="database only")
    args = ap.parse_args(argv)

    dest = Path(args.dest).resolve()
    project = HERE.parent.resolve()
    if project == dest or project in dest.parents:
        print("Refusing to write backups inside the project folder (they would be committed or lost with it).", file=sys.stderr)
        return 2
    dest.mkdir(parents=True, exist_ok=True)

    user, password = admin_login()
    database = os.environ.get("DATABASE_NAME", "liferecord")
    storage = Path(os.environ.get("STORAGE_DIR", str(BACKEND / "storage")))
    now = dt.datetime.now(dt.timezone.utc)
    name = f"liferecord-{now.strftime('%Y%m%d-%H%M%S')}.zip"

    with tempfile.TemporaryDirectory(prefix="lr-backup-") as tmp:
        sql_path = Path(tmp) / "liferecord.sql"
        conn, counts = snapshot_counts(user, password, database)
        try:
            run = subprocess.run(
                [find_client("mysqldump"), "--host=127.0.0.1", f"--port={os.environ.get('DATABASE_PORT', '3306')}", f"--user={user}",
                 "--single-transaction", "--routines", "--triggers", "--default-character-set=utf8mb4",
                 f"--result-file={sql_path}", database],
                env=child_env(password), capture_output=True, text=True)
        finally:
            conn.rollback()
            conn.close()
        if run.returncode != 0 or not sql_path.exists():
            print("mysqldump failed:\n" + (run.stderr or "")[-1500:], file=sys.stderr)
            return 1
        digest = hashlib.sha256(sql_path.read_bytes()).hexdigest()

        files = []
        if not args.no_uploads and storage.is_dir():
            files = [p for p in sorted(storage.rglob("*")) if p.is_file()]
        manifest = {"tool": "backup.py", "format": 1, "created_at": now.isoformat(), "database": database,
                    "tables": counts, "rows": sum(counts.values()), "sql_sha256": digest, "files": len(files)}

        partial = dest / f".{name}.partial"
        with zipfile.ZipFile(partial, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.write(sql_path, "liferecord.sql")
            for f in files:
                zf.write(f, "storage/" + f.relative_to(storage).as_posix())
            zf.writestr("MANIFEST.json", json.dumps(manifest, indent=1))
        partial.replace(dest / name)  # a half-written archive never carries a final name

    for old in plan_retention([p.name for p in dest.iterdir()], now, args.daily, args.weekly):
        (dest / old).unlink()
        print(f"pruned {old}")
    size = (dest / name).stat().st_size
    print(f"Backup written: {dest / name} ({size / 1024 / 1024:.1f} MB; {len(counts)} tables, {manifest['rows']} rows, {len(files)} files)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
