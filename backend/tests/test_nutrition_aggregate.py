"""Weekly and monthly buckets for long trends. Pure functions."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import nutrition_insights as ni  # noqa: E402


def day(date, logged=True, kcal=None, protein=None, drinks=0):
    return {"date": date, "logged": logged, "entries": 3 if logged else 0, "drinks_ml": drinks, "energy_kcal": kcal, "protein_g": protein}


SERIES = [day("2026-10-05", kcal=2000, protein=80), day("2026-10-06", kcal=1000, protein=None), day("2026-10-07", logged=False), day("2026-10-12", kcal=1500, protein=60)]


def test_weeks_start_on_monday_and_average_only_the_days_that_were_logged():
    out = ni.aggregate_series(SERIES, "week")
    assert [b["date"] for b in out] == ["2026-10-05", "2026-10-12"] and out[0]["end"] == "2026-10-11"
    assert out[0]["days_logged"] == 2 and out[0]["days"] == 3 and out[0]["logged"] is True
    assert out[0]["energy_kcal"] == pytest.approx(1500)                 # (2000 + 1000) / 2: the unlogged day is not a zero
    assert out[0]["protein_g"] == pytest.approx(80)                      # averaged over the one day that reported protein, not halved
    assert out[1]["energy_kcal"] == pytest.approx(1500)


def test_months_group_by_calendar_month_and_an_unlogged_bucket_stays_empty_not_zero():
    out = ni.aggregate_series(SERIES + [day("2026-11-02", logged=False), day("2026-11-03", logged=False)], "month")
    assert [b["date"] for b in out] == ["2026-10-01", "2026-11-01"]
    assert out[0]["energy_kcal"] == pytest.approx(1500) and out[0]["days_logged"] == 3
    assert out[1]["logged"] is False and out[1]["energy_kcal"] is None and out[1]["days_logged"] == 0


def test_daily_buckets_pass_through_and_unknown_buckets_are_refused():
    assert ni.aggregate_series(SERIES, "day") == SERIES
    with pytest.raises(ValueError):
        ni.aggregate_series(SERIES, "year")
