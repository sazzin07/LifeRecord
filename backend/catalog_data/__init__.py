"""Curated starter catalog: a few hundred everyday products organised by category and subcategory.

Each module lists BLOCKS of (category, subcategory, default flags, default unit, rows). A row is

    name;emoji;qty;kcal;protein;carbs;fat;flags;unit;synonyms

with empty fields falling back to the block defaults. Nutrition is per 100 g (or 100 ml) and approximate.
Flags are letters: V vegan (implies vegetarian), T vegetarian, G gluten-free, L lactose-free.
Household rows leave the nutrition empty.
"""
from typing import Any, Dict, List

from . import drinks_snacks_other, pantry, produce, protein

FLAG_TAGS = {"V": ["vegan", "vegetarian"], "T": ["vegetarian"], "G": ["gluten-free"], "L": ["lactose-free"]}
TAG_ORDER = ["vegan", "vegetarian", "gluten-free", "lactose-free"]


def _num(v: str):
    v = (v or "").strip()
    return float(v) if v else None


def _tags(flags: str) -> List[str]:
    found = {t for ch in flags for t in FLAG_TAGS.get(ch, [])}
    return [t for t in TAG_ORDER if t in found]


def _parse(blocks) -> List[Dict[str, Any]]:
    out = []
    for category, subcategory, default_flags, default_unit, body in blocks:
        for line in body.strip().splitlines():
            if not line.strip():
                continue
            f = (line.split(";") + [""] * 10)[:10]
            name, emoji, qty, kcal, prot, carbs, fat, flags, unit, syn = (x.strip() for x in f)
            nutrition = None
            if kcal:
                nutrition = {"calories_per_100g": _num(kcal), "protein": _num(prot) or 0,
                             "carbs": _num(carbs) or 0, "fat": _num(fat) or 0}
            out.append({
                "name": name, "category": category, "subcategory": subcategory, "icon": emoji or None,
                "default_unit": unit or default_unit, "typical_quantity": _num(qty),
                "nutrition": nutrition, "tags": _tags(flags or default_flags),
                "synonyms": [s.strip() for s in syn.split(",") if s.strip()],
            })
    return out


LIBRARY: List[Dict[str, Any]] = (
    _parse(produce.BLOCKS) + _parse(protein.BLOCKS) + _parse(pantry.BLOCKS) + _parse(drinks_snacks_other.BLOCKS)
)
