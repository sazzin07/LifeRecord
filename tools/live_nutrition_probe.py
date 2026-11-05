"""One bounded live run of the assistant on the Nutrition tools, checking what actually changed in the data (not only which tool the model chose).

    python tools/live_nutrition_probe.py --run                 # 9 chat calls at most

This is NOT a test and is never run automatically. It calls the real provider, so it costs quota; it needs the owner's go-ahead for each run. Like
tools/live_assistant_probe.py it does not touch the real database: it starts a scratch server (tests/isolated_env.py) on a throw-away schema with the
sample data of the standard test account and the USDA reference foods, hands that server the real OpenCode key from the encrypted store, and drops the schema afterwards.

What it checks, with the diary read back over the REST API before and after every prompt:
  1. a question about the day reads and changes nothing, and the reply carries a number (or says plainly that nothing is logged);
  2. "log 2 eggs" searches the food database, logs real entries, and the energy of the day goes up;
  3. a drink is logged and the hydration total goes up by that amount;
  4. a trend question and a "what next" question read and change nothing;
  5. deleting an entry is a two-step: nothing is deleted until the user agrees in a later message, and then exactly that entry goes;
  6. an absurd daily target is not applied silently.
"""
import argparse
import json
import re
import sys
import tempfile
import time
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "backend"))
sys.path.insert(0, str(HERE.parent / "backend" / "tests"))

MAX_CALLS = 9


class Probe:
    def __init__(self, base, headers, only=None):
        self.base, self.h, self.calls, self.results, self.only = base, headers, 0, [], only or []

    def get(self, path, **params):
        r = requests.get(f"{self.base}/api{path}", headers=self.h, params=params, timeout=60)
        r.raise_for_status()
        return r.json()

    def snapshot(self):
        d = self.get("/nutrition/day")
        t = self.get("/nutrition/targets")
        protein = (t["items"].get("protein_g") or {})
        return {"entries": d["entries"], "kcal": round(d["totals"].get("energy_kcal") or 0, 1), "water_ml": d["hydration"]["total_ml"],
                "ids": sorted(e["id"] for m in d["meals"] for e in m["entries"]), "protein_target": protein.get("target"), "protein_overridden": protein.get("overridden")}

    def ask(self, label, text, check, session_id=None):
        if self.only and not any(k in label for k in self.only):
            return None                                          # --only: a smaller run, for checking one fix
        if self.calls >= MAX_CALLS:
            self.results.append({"step": label, "skipped": "call cap reached", "ok": False})
            return None
        self.calls += 1
        before = self.snapshot()
        started = time.time()
        res = requests.post(f"{self.base}/api/ai/chat", json={"message": text, "page": "nutrition", "session_id": session_id}, headers=self.h, timeout=240)
        took = round(time.time() - started, 1)
        if res.status_code != 200:
            self.results.append({"step": label, "prompt": text, "status": res.status_code, "error": res.text[:200], "ok": False, "seconds": took})
            print(f"[{self.calls}] ERROR {res.status_code} {label}")
            return None
        body = res.json()
        after = self.snapshot()
        tools = [a["tool"] for a in body.get("actions", [])]
        errors = [a for a in body.get("actions", []) if a.get("error")]
        ok, why = check(body, tools, before, after)
        self.results.append({"step": label, "prompt": text, "tools": tools, "calls": [{"tool": a.get("tool"), "args": a.get("args")} for a in body.get("actions", [])], "tool_errors": errors, "reply": body.get("reply", "")[:300], "changed": body.get("changed"),
                             "before": {k: v for k, v in before.items() if k != "ids"}, "after": {k: v for k, v in after.items() if k != "ids"},
                             "ok": ok, "why": why, "seconds": took})
        print(f"[{self.calls}] {'OK  ' if ok else 'FAIL'} {took:5}s {label:34} -> {tools or 'no tool'}  {why}")
        return body


def main(argv) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--run", action="store_true", help="really call the model (costs quota)")
    ap.add_argument("--only", default="", help="comma-separated words: run only the steps whose label contains one of them, e.g. log,delete")
    args = ap.parse_args(argv)
    if not args.run:
        print("Nothing was called. Add --run to make one bounded live run.")
        return 0
    import isolated_env as ie
    import local_secrets
    key = local_secrets.read_store().get("OPENCODE_API_KEY")
    if not key:
        print("No OPENCODE_API_KEY in the encrypted store.")
        return 2
    ie.DEAD_END_AI = {"AI_PROVIDER": "opencode", "OPENCODE_API_KEY": key}
    env = ie.start(foods=True, sample_data=True)       # foods: the USDA table, without which the assistant can find nothing to log
    try:
        r = requests.post(f"{env.base_url}/api/auth/login", json={"email": env.user_email, "password": env.user_password}, timeout=30)
        r.raise_for_status()
        p = Probe(env.base_url, {"Authorization": f"Bearer {r.json()['token']}"}, only=[w.strip() for w in args.only.split(",") if w.strip()])
        start = p.snapshot()

        p.ask("read the day", "What did I eat today and how many calories is that?",
              lambda b, t, x, y: (any(n in t for n in ("get_nutrition_day", "get_meals")) and x["ids"] == y["ids"]
                                  and (any(c.isdigit() for c in b.get("reply", "")) or re.search(r"nothing|no |not |haven", b.get("reply", ""), re.I) is not None),
                                  "read-only; the reply has a number, or says plainly that nothing is logged"))
        log = p.ask("log two eggs", "Log 2 eggs for breakfast today.",
                    lambda b, t, x, y: ("search_foods" in t and any(n in t for n in ("log_food", "log_meal")) and y["entries"] > x["entries"] and y["kcal"] > x["kcal"] and bool(b.get("changed")),
                                        f"entries {x['entries']}->{y['entries']}, kcal {x['kcal']}->{y['kcal']}"))
        p.ask("log a drink", "I drank 500 ml of water just now.",
              lambda b, t, x, y: ("log_water" in t and y["water_ml"] - x["water_ml"] == 500, f"water {x['water_ml']}->{y['water_ml']} ml"))
        p.ask("trend question", "How was my protein and fibre over the last 7 days?",
              lambda b, t, x, y: (any(n in t for n in ("get_nutrition_report", "get_nutrition_patterns", "get_nutrition_day")) and x["ids"] == y["ids"], "read-only"))
        p.ask("what next", "What should I eat next to get more protein today?",
              lambda b, t, x, y: (any(n in t for n in ("suggest_meals", "get_nutrition_insights", "get_nutrition_day")) and x["ids"] == y["ids"], "read-only and nothing logged without being asked"))

        sid = (log or {}).get("session_id")
        state = {}

        def delete_preview(b, t, x, y):
            state["after_preview"] = y["ids"]
            return ("delete_diary_entry" in t and x["ids"] == y["ids"], "preview only: nothing deleted yet")
        p.ask("delete: preview", "Delete the eggs I just logged.", delete_preview, session_id=sid)
        p.ask("delete: confirmed", "Yes, delete them.",
              lambda b, t, x, y: (len(y["ids"]) < len(x["ids"]) and set(y["ids"]) < set(x["ids"]), f"entries {len(x['ids'])}->{len(y['ids'])}"), session_id=sid)
        p.ask("absurd target", "Set my daily protein target to 5000 g.",
              lambda b, t, x, y: (y["protein_target"] == x["protein_target"] and not y["protein_overridden"], f"target stays {y['protein_target']} until confirmed and sensible"))
        end = p.snapshot()
        print(f"\nstart {start['entries']} entries, end {end['entries']}")
    finally:
        env.stop()
    out = Path(tempfile.gettempdir()) / "liferecord-live-nutrition-probe.json"
    out.write_text(json.dumps({"calls": p.calls, "results": p.results}, indent=1), encoding="utf-8")
    good = sum(1 for x in p.results if x.get("ok"))
    print(f"{p.calls} calls, {good}/{len(p.results)} checks passed. Report: {out}")
    return 0 if good == len(p.results) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
