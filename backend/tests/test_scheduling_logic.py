"""Pure schedule logic: validation, next-run arithmetic, daylight-saving behaviour and plain-language descriptions."""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import scheduling as sch  # noqa: E402

UTC = timezone.utc
LISBON = "Europe/Lisbon"
NOW = datetime(2026, 10, 23, 12, 0, tzinfo=UTC)  # a Friday


def at(y, m, d, hh=0, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=UTC)


def nxt(schedule, tz=LISBON, after=NOW):
    return sch.compute_next_run(sch.validate_schedule(schedule, tz, after), tz, after)


# ------------------------------------------------------------------ validation
@pytest.mark.parametrize("raw,needle", [
    ({}, "Choose once"),
    ({"kind": "yearly"}, "Choose once"),
    ({"kind": "daily", "time": "25:00"}, "Time must"),
    ({"kind": "daily"}, "Time must"),
    ({"kind": "weekly", "time": "09:00", "weekdays": []}, "weekday"),
    ({"kind": "weekly", "time": "09:00", "weekdays": [7]}, "weekday"),
    ({"kind": "monthly", "time": "09:00", "day_of_month": 32}, "between 1 and 31"),
    ({"kind": "interval", "every": 0, "unit": "hours"}, "at most once every"),
    ({"kind": "interval", "every": 5, "unit": "weeks"}, "hours or days"),
    ({"kind": "interval", "every": 999, "unit": "days"}, "too long"),
    ({"kind": "once", "time": "09:00", "date": "2026-10-01"}, "already passed"),
    ({"kind": "once", "time": "09:00", "date": "not-a-date"}, "date"),
])
def test_invalid_schedules_are_rejected_with_a_readable_message(raw, needle):
    with pytest.raises(ValueError) as exc:
        sch.validate_schedule(raw, LISBON, NOW)
    assert needle in str(exc.value)


def test_unknown_timezone_is_rejected():
    with pytest.raises(ValueError, match="Unknown timezone"):
        sch.validate_schedule({"kind": "daily", "time": "09:00"}, "Mars/Olympus", NOW)


def test_validation_normalises_input():
    out = sch.validate_schedule({"kind": "weekly", "time": "9:05", "weekdays": ["4", 0, 0], "junk": 1}, LISBON, NOW)
    assert out == {"kind": "weekly", "time": "09:05", "weekdays": [0, 4]}


# ----------------------------------------------------------------- next runs
def test_daily_picks_today_if_still_ahead_else_tomorrow():
    assert nxt({"kind": "daily", "time": "14:00"}) == at(2026, 10, 23, 13, 0)  # 14:00 Lisbon is UTC+1 on 23 Oct
    assert nxt({"kind": "daily", "time": "09:00"}) == at(2026, 10, 24, 8, 0)


def test_weekly_every_monday_at_nine():
    assert nxt({"kind": "weekly", "time": "09:00", "weekdays": [0]}) == at(2026, 10, 26, 9, 0)  # DST ended 25 Oct: UTC+0


def test_weekly_with_several_days_and_after_midweek():
    assert nxt({"kind": "weekly", "time": "08:00", "weekdays": [1, 4]}, after=at(2026, 10, 27, 12, 0)) == at(2026, 10, 30, 8, 0)


def test_monthly_clamps_to_the_last_day_of_short_months():
    sched = {"kind": "monthly", "time": "10:00", "day_of_month": 31}
    runs = sch.upcoming_runs(sch.validate_schedule(sched, "UTC"), "UTC", 4, at(2026, 1, 31, 12, 0))
    assert [(r.month, r.day) for r in runs] == [(2, 28), (3, 31), (4, 30), (5, 31)]


def test_monthly_rolls_over_the_year():
    assert nxt({"kind": "monthly", "time": "09:00", "day_of_month": 1}, "UTC", at(2026, 12, 15, 0, 0)) == at(2027, 1, 1, 9, 0)


def test_interval_steps_from_its_start_and_never_goes_backwards():
    start = at(2026, 10, 23, 10, 0)
    sched = {"kind": "interval", "every": 6, "unit": "hours", "start_at": start.isoformat()}
    assert nxt(sched, "UTC", start - timedelta(hours=1)) == start
    assert nxt(sched, "UTC", start) == start + timedelta(hours=6)
    assert nxt(sched, "UTC", start + timedelta(hours=13)) == start + timedelta(hours=18)


def test_once_has_no_next_run_after_it_passes():
    sched = sch.validate_schedule({"kind": "once", "time": "18:00", "date": "2026-10-24"}, LISBON, NOW)
    when = sch.compute_next_run(sched, LISBON, NOW)
    assert when == at(2026, 10, 24, 17, 0)
    assert sch.compute_next_run(sched, LISBON, when) is None


def test_next_run_is_strictly_after_the_reference_time():
    mid_november = at(2026, 11, 10, 12, 0)  # away from any clock change
    first = nxt({"kind": "daily", "time": "09:00"}, after=mid_november)
    assert sch.compute_next_run({"kind": "daily", "time": "09:00"}, LISBON, first) == first + timedelta(days=1)
    assert first > mid_november


# ------------------------------------------------------- daylight-saving time
def test_wall_clock_time_is_kept_across_the_autumn_change():
    # Lisbon leaves summer time on Sun 25 Oct 2026 (02:00 -> 01:00). Daily 09:00 must stay 09:00 local.
    runs = sch.upcoming_runs(sch.validate_schedule({"kind": "daily", "time": "09:00"}, LISBON), LISBON, 4, at(2026, 10, 23, 12, 0))
    assert [r.isoformat() for r in runs] == ["2026-10-24T08:00:00+00:00", "2026-10-25T09:00:00+00:00",
                                              "2026-10-26T09:00:00+00:00", "2026-10-27T09:00:00+00:00"]


def test_wall_clock_time_is_kept_across_the_spring_change():
    # Lisbon enters summer time on Sun 29 Mar 2026 (01:00 -> 02:00).
    runs = sch.upcoming_runs(sch.validate_schedule({"kind": "daily", "time": "09:00"}, LISBON), LISBON, 3, at(2026, 3, 27, 12, 0))
    assert [r.isoformat() for r in runs] == ["2026-03-28T09:00:00+00:00", "2026-03-29T08:00:00+00:00", "2026-03-30T08:00:00+00:00"]


def test_a_time_that_does_not_exist_runs_once_after_the_gap():
    # 01:30 on 29 Mar 2026 does not exist in Lisbon; it must still run exactly once that day.
    runs = sch.upcoming_runs(sch.validate_schedule({"kind": "daily", "time": "01:30"}, LISBON), LISBON, 3, at(2026, 3, 28, 12, 0))
    assert len(runs) == 3 and runs[0].date().isoformat() == "2026-03-29" and runs[1].date().isoformat() == "2026-03-30"
    assert len({r.date() for r in runs}) == 3


def test_a_time_that_happens_twice_runs_once():
    # 01:30 on 25 Oct 2026 happens twice in Lisbon; daily must not produce two runs that day.
    runs = sch.upcoming_runs(sch.validate_schedule({"kind": "daily", "time": "01:30"}, LISBON), LISBON, 3, at(2026, 10, 24, 12, 0))
    assert len({r.astimezone(sch.get_zone(LISBON)).date() for r in runs}) == 3


def test_other_timezones_use_their_own_offsets():
    ny = nxt({"kind": "daily", "time": "09:00"}, "America/New_York", NOW)
    assert ny == at(2026, 10, 23, 13, 0)  # 09:00 EDT (UTC-4) is still ahead of 08:00 EDT


# ----------------------------------------------------------- descriptions
def test_descriptions_read_naturally():
    d = lambda s, tz=LISBON: sch.describe_schedule(sch.validate_schedule(s, tz, NOW), tz)  # noqa: E731
    assert d({"kind": "weekly", "time": "09:00", "weekdays": [0]}) == "Every Monday at 09:00 (Europe/Lisbon)"
    assert d({"kind": "weekly", "time": "09:00", "weekdays": [0, 1, 2, 3, 4]}) == "Every weekdays at 09:00 (Europe/Lisbon)"
    assert d({"kind": "daily", "time": "18:30"}) == "Every day at 18:30 (Europe/Lisbon)"
    assert d({"kind": "monthly", "time": "08:00", "day_of_month": 1}) == "Monthly on the 1st at 08:00 (Europe/Lisbon)"
    assert d({"kind": "monthly", "time": "08:00", "day_of_month": 22}).startswith("Monthly on the 22nd")
    assert d({"kind": "interval", "every": 1, "unit": "days"}) == "Every day"
    assert d({"kind": "interval", "every": 6, "unit": "hours"}) == "Every 6 hours"


# --------------------------------------------------- data sources and context
def test_every_source_tool_is_a_real_read_only_tool():
    import server
    declared = {t["function"]["name"] for t in server.AI_TOOLS}
    for name in sch.ALWAYS_ALLOWED + [n for names in sch.SOURCE_TOOLS.values() for n in names]:
        assert name in declared and (name.startswith("get_") or name == "suggest_recipes_from_inventory"), name


def test_allowed_tools_follow_the_chosen_sources_and_default_to_all_reads():
    only = sch.allowed_tools(["tasks"])
    assert "get_tasks" in only and "get_transactions" not in only and "create_task" not in only
    everything = set(sch.allowed_tools([]))
    assert "get_transactions" in everything and not any(n.startswith(("create_", "delete_", "update_", "record_")) for n in everything)


def test_unknown_sources_are_rejected():
    with pytest.raises(ValueError):
        sch.normalise_sources(["passwords"])
    assert sch.normalise_sources([]) == [] and sch.normalise_sources(["money", "money", "tasks"]) == ["money", "tasks"]


def test_date_context_names_the_previous_week_and_month():
    ctx = sch.date_context(at(2026, 10, 26, 8, 0), LISBON)
    assert "2026-10-19 to 2026-10-25" in ctx and "Last month: 2026-09" in ctx


# ------------------------------------------------------------- email rendering
def test_email_rendering_escapes_markup_and_keeps_tables():
    subject, html_body, text = sch.render_email("Weekly <b>spend</b>", "# Summary\n\n| A | B |\n|---|---|\n| x | €1.00 |\n\n<script>alert(1)</script>", "Sá", "Every Monday", "26 Oct 2026")
    assert "<script>" not in html_body and "&lt;b&gt;" in html_body and "<table" in html_body and "€1.00" in html_body
    assert subject.startswith("Weekly <b>spend</b>") is True  # subject is plain text, never HTML
    assert "Weekly <b>spend</b>" in text
