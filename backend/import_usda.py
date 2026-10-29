"""Import the USDA FoodData Central reference foods (public domain, no API key) into the shared `foods` table.

    python import_usda.py            # download (if needed) and import Foundation Foods + SR Legacy
    python import_usda.py --dir PATH # use already-downloaded, unzipped CSV folders found under PATH

Data: U.S. Department of Agriculture, FoodData Central, https://fdc.nal.usda.gov (U.S. Government work, CC0 / public domain).
  - Foundation Foods, release 2025-12-18 (analytical values, richest nutrient coverage)
  - SR Legacy, April 2018 (the final release of the long-running Standard Reference, ~7,800 foods)
Branded foods are not imported (use Open Food Facts lookups for packaged products).

Idempotent: foods are matched by (source, source_id) and updated in place when they exist (diary entries refer to foods
by id, so rows are never deleted). A nutrient that the source did not report is simply absent: nothing is invented.
The raw files are cached under %LOCALAPPDATA%\\LifeRecord\\datasets\\usda (outside the project, not committed).
"""
import csv
import json
import os
import sys
import urllib.request
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import pymysql

sys.path.insert(0, str(Path(__file__).resolve().parent))
import local_secrets  # noqa: E402
from nutrition_data import NUTRIENTS  # noqa: E402

local_secrets.load_into_environ()
csv.field_size_limit(10_000_000)

BASE = "https://fdc.nal.usda.gov/fdc-datasets/"
DATASETS = [
    dict(source="usda_foundation", data_type="foundation_food", zip="FoodData_Central_foundation_food_csv_2025-12-18.zip",
         version="USDA FoodData Central, Foundation Foods (2025-12-18)"),
    dict(source="usda_sr_legacy", data_type="sr_legacy_food", zip="FoodData_Central_sr_legacy_food_csv_2018-04.zip",
         version="USDA FoodData Central, SR Legacy (April 2018)"),
]
CACHE = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "LifeRecord" / "datasets" / "usda"
# FoodData Central nutrient id -> our key (several ids for one key are in order of preference)
ID_TO_KEY = {}
for n in NUTRIENTS:
    for rank, nid in enumerate(n["usda"]):
        ID_TO_KEY[nid] = (n["key"], rank)
UNIT_FIX = {"UG": "µg", "MG": "mg", "G": "g", "KCAL": "kcal"}


def connect():
    return pymysql.connect(host="127.0.0.1", port=3306, user=os.environ.get("ADMIN_DATABASE_USER", "root"),
                           password=os.environ.get("ADMIN_DATABASE_PASSWORD", ""), database="liferecord", charset="utf8mb4")


def locate(ds: dict, root: Path) -> Path:
    """The folder holding food.csv for this dataset, downloading and unzipping it if necessary."""
    zip_path = root / ds["zip"]
    if not zip_path.exists():
        root.mkdir(parents=True, exist_ok=True)
        print(f"Downloading {ds['zip']} ...")
        urllib.request.urlretrieve(BASE + ds["zip"], zip_path)
    target = root / zip_path.stem
    if not list(target.rglob("food.csv")):
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(target)
    return next(target.rglob("food.csv")).parent


def read(folder: Path, name: str):
    with open(folder / name, encoding="utf-8", newline="") as f:
        yield from csv.DictReader(f)


def label_for(row: dict, units: dict) -> str:
    amount = row.get("amount") or ""
    try:
        amount = f"{float(amount):g}" if amount else ""
    except ValueError:
        pass
    unit = units.get(row.get("measure_unit_id") or "", "")
    unit = "" if unit.lower() in ("undetermined", "") else unit
    extra = (row.get("modifier") or row.get("portion_description") or "").strip()
    if not unit:  # SR Legacy stores the unit in the modifier: "1" + "cup" -> "1 cup"
        return " ".join(p for p in (amount, extra) if p).strip()[:100]
    text = f"{amount} {unit}".strip()
    return (f"{text}, {extra}" if extra else text)[:100]


def import_dataset(cur, ds: dict, folder: Path) -> dict:
    cats = {r["id"]: r["description"] for r in read(folder, "food_category.csv")}
    units = {r["id"]: r["name"] for r in read(folder, "measure_unit.csv")}
    foods = {}
    for r in read(folder, "food.csv"):
        if r["data_type"] == ds["data_type"]:
            foods[r["fdc_id"]] = {"name": r["description"].strip(), "category": cats.get(r.get("food_category_id") or "", None) or None}
    nutrients = {fid: {} for fid in foods}  # fid -> {key: (rank, amount)}
    for r in read(folder, "food_nutrient.csv"):
        fid = r["fdc_id"]
        if fid not in nutrients or not r["amount"]:
            continue
        meta = ID_TO_KEY.get(int(r["nutrient_id"]))
        if not meta:
            continue
        key, rank = meta
        cur_best = nutrients[fid].get(key)
        if cur_best is None or rank < cur_best[0]:
            nutrients[fid][key] = (rank, float(r["amount"]))
    portions = {fid: [] for fid in foods}
    for r in read(folder, "food_portion.csv"):
        fid = r["fdc_id"]
        try:
            grams = float(r["gram_weight"])
        except (ValueError, KeyError):
            continue
        if fid in portions and grams > 0:
            lab = label_for(r, units)
            if lab and all(p["label"] != lab for p in portions[fid]) and len(portions[fid]) < 12:
                portions[fid].append({"label": lab, "grams": round(grams, 2)})

    cur.execute("SELECT source_id, id FROM foods WHERE source=%s AND user_id IS NULL", (ds["source"],))
    existing = dict(cur.fetchall())
    now = datetime.now(timezone.utc).isoformat()
    added = updated = skipped = 0
    for fid, f in foods.items():
        values = {k: round(v[1], 4) for k, v in nutrients[fid].items()}
        # USDA's "carbohydrate, by difference" is 100 - water - protein - fat - ash and comes out slightly negative for some
        # high-protein foods (a rounding artefact in the source). A negative amount is meaningless, so it is stored as 0.
        if values.get("carbs_g", 0) < 0:
            values["carbs_g"] = 0.0
        if "energy_kcal" not in values or not values:
            skipped += 1  # nothing usable to log
            continue
        args = (f["name"][:500], f["name"].lower()[:255], f["category"], json.dumps(values), json.dumps(portions[fid]), ds["version"], now)
        if fid in existing:
            cur.execute("UPDATE foods SET name=%s, name_lower=%s, category=%s, nutrients=%s, portions=%s, data_version=%s, updated_at=%s WHERE id=%s",
                        args + (existing[fid],))
            updated += 1
        else:
            cur.execute("INSERT INTO foods (id,user_id,source,source_id,name,name_lower,category,quality,nutrients,portions,data_version,created_at,updated_at) "
                        "VALUES (%s,NULL,%s,%s,%s,%s,%s,'verified',%s,%s,%s,%s,%s)",
                        (str(uuid.uuid4()), ds["source"], fid, args[0], args[1], args[2], args[3], args[4], args[5], now, now))
            added += 1
    return {"source": ds["source"], "foods_in_file": len(foods), "added": added, "updated": updated, "skipped_no_energy": skipped}


def main(argv) -> int:
    root = Path(argv[argv.index("--dir") + 1]) if "--dir" in argv else CACHE
    conn = connect()
    try:
        cur = conn.cursor()
        for ds in DATASETS:
            result = import_dataset(cur, ds, locate(ds, root))
            conn.commit()
            print(result)
        cur.execute("SELECT source, COUNT(*) FROM foods WHERE user_id IS NULL GROUP BY source")
        print("shared foods now:", dict(cur.fetchall()))
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
