"""Recurring transactions: the date arithmetic (F-11)."""
from datetime import date

import recurring


def test_monthly_on_the_31st_uses_the_last_day_of_short_months_then_goes_back():
    d = date(2026, 1, 31)
    d = recurring.next_due(d, "monthly", 31)
    assert d == date(2026, 2, 28)
    d = recurring.next_due(d, "monthly", 31)
    assert d == date(2026, 3, 31)           # not Mar 28: the original day is kept
    assert recurring.next_due(d, "monthly", 31) == date(2026, 4, 30)


def test_leap_day_yearly_falls_back_and_returns():
    d = recurring.next_due(date(2028, 2, 29), "yearly", 29)
    assert d == date(2029, 2, 28)
    d = recurring.next_due(d, "yearly", 29)
    d = recurring.next_due(d, "yearly", 29)
    assert d == date(2031, 2, 28)
    assert recurring.next_due(date(2031, 2, 28), "yearly", 29) == date(2032, 2, 29)


def test_weekly_adds_seven_days_and_december_rolls_the_year():
    assert recurring.next_due(date(2026, 12, 28), "weekly", 28) == date(2027, 1, 4)
    assert recurring.next_due(date(2026, 12, 15), "monthly", 15) == date(2027, 1, 15)


def test_due_dates_catch_up_each_missed_date_once():
    got = recurring.due_dates(date(2026, 8, 1), "monthly", 1, today=date(2026, 11, 4), end=None)
    assert got == [date(2026, 8, 1), date(2026, 9, 1), date(2026, 10, 1), date(2026, 11, 1)]


def test_due_dates_stop_at_the_end_date_and_at_the_limit():
    assert recurring.due_dates(date(2026, 8, 1), "monthly", 1, today=date(2026, 11, 4), end=date(2026, 9, 15)) == [date(2026, 8, 1), date(2026, 9, 1)]
    assert recurring.due_dates(date(2026, 11, 5), "monthly", 5, today=date(2026, 11, 4), end=None) == []      # not due yet
    many = recurring.due_dates(date(2020, 1, 1), "weekly", 1, today=date(2026, 11, 4), end=None, limit=31)
    assert len(many) == 31                                                                                       # never an unbounded burst


def test_bad_repeat_is_refused():
    import pytest
    with pytest.raises(ValueError):
        recurring.next_due(date(2026, 1, 1), "daily", 1)
