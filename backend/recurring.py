"""Recurring transactions (roadmap F-11): the date arithmetic, and the tick that turns due rules into real transactions.

A rule repeats weekly, monthly or yearly. A monthly or yearly rule keeps its ORIGINAL day (`anchor_day`): one that started on the 31st falls on
the last day of a shorter month and returns to the 31st afterwards. Dates are plain `date`s: a rule is due on a calendar day, in no time zone.
"""
import calendar
from datetime import date, timedelta
from typing import List, Optional

REPEATS = ("weekly", "monthly", "yearly")


def _clamped(year: int, month: int, day: int) -> date:
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))


def next_due(current: date, repeat: str, anchor_day: int) -> date:
    """The day after `current` on which the rule is due again."""
    if repeat == "weekly":
        return current + timedelta(days=7)
    if repeat == "monthly":
        year, month = (current.year + 1, 1) if current.month == 12 else (current.year, current.month + 1)
        return _clamped(year, month, anchor_day)
    if repeat == "yearly":
        return _clamped(current.year + 1, current.month, anchor_day)
    raise ValueError(f"unknown repeat {repeat!r}")


def due_dates(next_due_: date, repeat: str, anchor_day: int, today: date, end: Optional[date], limit: int = 31) -> List[date]:
    """Every due date from `next_due_` up to `today` (and not past `end`), oldest first, at most `limit` of them: after a long stop the
    missed dates are created once each, but never an unbounded burst."""
    out: List[date] = []
    d = next_due_
    while d <= today and (end is None or d <= end) and len(out) < limit:
        out.append(d)
        d = next_due(d, repeat, anchor_day)
    return out
