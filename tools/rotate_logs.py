"""Keep the project's logs in one folder (logs/) and stop them growing without bound (roadmap S-14).

    python tools/rotate_logs.py            # run by start-all.ps1 before the services start

- logs/*.log bigger than 5 MB are rotated: backend.log -> backend.log.1 -> .2 -> .3, the oldest is dropped, and a fresh
  empty backend.log is left for the service to write into. Nothing else in the folder is touched.
- *.log files lying around in the project folder from earlier runs (backend-run.log, backend_8001_out.log, ...) are
  MOVED into logs/ with an "old-" prefix, never deleted: deleting is for a person to decide.
"""
import shutil
import sys
from pathlib import Path

MAX_BYTES = 5 * 1024 * 1024
KEEP = 3


def rotate(folder: Path, max_bytes: int = MAX_BYTES, keep: int = KEEP) -> list:
    rotated = []
    for log in sorted(Path(folder).glob("*.log")):
        if log.stat().st_size <= max_bytes:
            continue
        oldest = log.with_name(f"{log.name}.{keep}")
        oldest.unlink(missing_ok=True)
        for i in range(keep - 1, 0, -1):
            src = log.with_name(f"{log.name}.{i}")
            if src.exists():
                src.replace(log.with_name(f"{log.name}.{i + 1}"))
        log.replace(log.with_name(f"{log.name}.1"))
        log.write_bytes(b"")
        rotated.append(log.name)
    return rotated


def adopt_strays(project: Path, folder: Path) -> list:
    moved = []
    for stray in sorted(Path(project).glob("*.log")):
        folder.mkdir(parents=True, exist_ok=True)
        try:
            shutil.move(str(stray), str(folder / f"old-{stray.name}"))
        except OSError:  # a running service still holds it open (Windows): leave it, it moves on the next start
            print(f"{stray.name} is in use; left where it is")
            continue
        moved.append(stray.name)
    return moved


def main() -> int:
    project = Path(__file__).resolve().parents[1]
    logs = project / "logs"
    logs.mkdir(exist_ok=True)
    for name in adopt_strays(project, logs):
        print(f"moved {name} into logs/ (as old-{name})")
    for name in rotate(logs):
        print(f"rotated logs/{name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
