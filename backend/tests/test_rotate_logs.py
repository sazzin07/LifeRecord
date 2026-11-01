"""S-14: logs live in one folder and cannot grow without bound."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools"))
import rotate_logs  # noqa: E402

MB = 1024 * 1024


def test_a_log_over_the_limit_is_rotated_and_older_ones_shift_up(tmp_path):
    (tmp_path / "backend.log").write_bytes(b"x" * (6 * MB))
    (tmp_path / "backend.log.1").write_text("one")
    (tmp_path / "backend.log.2").write_text("two")
    rotate_logs.rotate(tmp_path, max_bytes=5 * MB, keep=3)
    assert (tmp_path / "backend.log").stat().st_size == 0                      # a fresh, empty log to write into
    assert (tmp_path / "backend.log.1").stat().st_size == 6 * MB               # what was current is now the newest copy
    assert (tmp_path / "backend.log.2").read_text() == "one"
    assert (tmp_path / "backend.log.3").read_text() == "two"


def test_only_the_newest_few_are_kept(tmp_path):
    (tmp_path / "backend.log").write_bytes(b"x" * (6 * MB))
    for i in range(1, 4):
        (tmp_path / f"backend.log.{i}").write_text(str(i))
    rotate_logs.rotate(tmp_path, max_bytes=5 * MB, keep=3)
    assert sorted(p.name for p in tmp_path.iterdir()) == ["backend.log", "backend.log.1", "backend.log.2", "backend.log.3"]
    assert (tmp_path / "backend.log.3").read_text() == "2"                     # the oldest ("3") was dropped


def test_a_small_log_is_left_alone_and_other_files_are_never_touched(tmp_path):
    (tmp_path / "backend.log").write_text("short")
    (tmp_path / "notes.txt").write_bytes(b"x" * (9 * MB))
    rotate_logs.rotate(tmp_path, max_bytes=5 * MB, keep=3)
    assert (tmp_path / "backend.log").read_text() == "short"
    assert (tmp_path / "notes.txt").stat().st_size == 9 * MB and not (tmp_path / "notes.txt.1").exists()


def test_stray_logs_are_moved_into_the_folder_not_deleted(tmp_path):
    project, logs = tmp_path / "project", tmp_path / "project" / "logs"
    project.mkdir()
    (project / "backend-run.log").write_text("old run")
    (project / "notes.md").write_text("keep")
    moved = rotate_logs.adopt_strays(project, logs)
    assert moved == ["backend-run.log"]
    assert (logs / "old-backend-run.log").read_text() == "old run" and not (project / "backend-run.log").exists()
    assert (project / "notes.md").exists()
    assert rotate_logs.adopt_strays(project, logs) == []                       # nothing left to move the second time
