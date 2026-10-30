"""Meal-plan generation from what the person already has. Pure functions: no database, no network.

For every day the open meal slots are filled one after another. Each slot reuses the scoring of "what could I eat?" (nutrition_suggest), with
the day's remaining needs reduced by what earlier slots of that day already provide, so a day is aimed at covering the focus nutrients as a
whole. On top of that: nothing twice in a day, nothing more often than `max_repeats` in the whole plan, a small penalty for repeating the same
item in the same slot on consecutive days, and a preference for the meals a food is usually eaten at. If the pool is too small, slots stay
open and the result says so: nothing is invented to fill them.
"""
import hashlib
import json
from collections import Counter
from typing import Dict, Iterable, List, Optional, Set, Tuple

import nutrition_suggest as sg

SLOT_ORDER = ["breakfast", "lunch", "dinner", "snack"]
REPEAT_PENALTY = 0.12
SAME_SLOT_NEXT_DAY_PENALTY = 0.20
USUAL_MEAL_BONUS = 0.10
FLOOR = 0.15  # once the focus nutrients are covered for the day, later slots still prefer items that keep helping (15% of the target stays "open")


def _slot_ctx(base: dict, day_remaining: Dict[str, float], day_headroom: Dict[str, float], slot: str, share: float) -> dict:
    budget = base["energy_target"] * share
    return {**base, "remaining": dict(day_remaining), "headroom": dict(day_headroom), "meal_type": slot, "budget_kcal": budget, "remaining_kcal": budget}


def plan_days(dates: List[str], candidates: Iterable[dict], base: dict, slots: List[str], max_repeats: int = 2,
              occupied: Optional[Set[Tuple[str, str]]] = None) -> dict:
    """{"days": [{"date", "items": [...], "unfilled": [slots], "skipped": [slots already planned]}], "notes": [...]}."""
    occupied = occupied or set()
    pool = sorted(candidates, key=lambda c: (str(c["kind"]), str(c["id"])))   # a fixed order, so the same data always gives the same plan
    wanted = [s for s in SLOT_ORDER if s in slots]
    uses: Counter = Counter()
    last_in_slot: Dict[str, tuple] = {}
    days = []
    for date in dates:
        remaining = dict(base["remaining"])
        floor = {k: v * FLOOR for k, v in base["remaining"].items()}
        headroom = dict(base["headroom"])
        used_today: Set[tuple] = set()
        items, unfilled, skipped = [], [], []
        for slot in wanted:
            if (date, slot) in occupied:
                skipped.append(slot)
                continue
            ctx = _slot_ctx(base, {k: max(v, floor.get(k, 0.0)) for k, v in remaining.items()}, headroom, slot, sg.MEAL_SHARE[slot])   # a meal is its own share of the day, however many meals are planned
            best = None
            for c in pool:
                key = (c["kind"], c["id"])
                if key in used_today or uses[key] >= max_repeats:
                    continue
                s = sg.score({**c, "pantry": None, "eaten_days_ago": None}, ctx)
                if not s:
                    continue
                usual = c.get("usual_meals") or []
                total = (s["score"] - REPEAT_PENALTY * uses[key] - (SAME_SLOT_NEXT_DAY_PENALTY if last_in_slot.get(slot) == key else 0.0)
                         + (USUAL_MEAL_BONUS if slot in usual else -USUAL_MEAL_BONUS if usual else 0.0))
                rank = (-total, c["name"], str(c["id"]))
                if best is None or rank < best[0]:
                    best = (rank, c, s, total)
            if best is None:
                unfilled.append(slot)
                continue
            _, c, s, total = best
            key = (c["kind"], c["id"])
            uses[key] += 1
            used_today.add(key)
            last_in_slot[slot] = key
            n = c["nutrients"]
            for k in remaining:
                remaining[k] = max(remaining[k] - (n.get(k) or 0.0), 0.0)
            for k in headroom:
                headroom[k] -= n.get(k) or 0.0
            items.append({"date": date, "meal_type": slot, "kind": c["kind"], "id": c["id"], "name": c["name"], "portion": c.get("portion"), "nutrients": n,
                          "quality": c.get("quality"), "flags": c.get("flags") or [], "log": c.get("log"),
                          "covers": [{"nutrient": x["nutrient"], "name": x["name"], "percent_of_remaining": x["percent_of_remaining"]} for x in s["covers"][:3]]})
        days.append({"date": date, "items": items, "unfilled": unfilled, "skipped": skipped})
    notes = []
    open_slots = sum(len(d["unfilled"]) for d in days)
    if open_slots:
        biggest = max((sg.MEAL_SHARE[s] for s in wanted), default=0.3)
        why = sg.diagnose(pool, {**base, "budget_kcal": base["energy_target"] * biggest})
        notes.append(f"There are not enough suitable recipes or foods for {open_slots} of the {sum(len(d['items']) + len(d['unfilled']) for d in days)} open slots "
                     f"(each can be used {max_repeats} times at most, and only what fits the meal and helps with the focus is considered). " + " ".join(why)
                     + (" " if why else "") + "Save more recipes or star more foods, or choose a different focus, and try again.")
    return {"days": days, "notes": notes}


def digest(plan: dict) -> str:
    """Identifies exactly which items were proposed where, so applying a plan can check that nothing changed since it was previewed."""
    rows = [(i["date"], i["meal_type"], i["kind"], str(i["id"]), (i.get("portion") or {}).get("quantity"), (i.get("portion") or {}).get("unit"))
            for d in plan["days"] for i in d["items"]]
    return hashlib.sha256(json.dumps(rows, sort_keys=True, default=str).encode()).hexdigest()[:20]
