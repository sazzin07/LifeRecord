"""One bounded live run of the assistant against the real model (roadmap F-05): does it pick sensible tools among the ~100 it is offered?

    python tools/live_assistant_probe.py --run                 # 20 prompts, never more than 25 calls

This is NOT a test and is never run automatically. It calls the real provider, so it costs quota; the owner approved one run of at most
25 calls. It does not touch the real database: it starts a scratch server (tests/isolated_env.py) on a throw-away schema with the sample
data of the standard test account, hands that server the real OpenCode key from the encrypted store, and drops the schema afterwards.
Each prompt is a fresh conversation. For every prompt it records which tools the model chose and whether that is one of the sensible
choices (`ok`), and writes a JSON report next to the temp files.
"""
import argparse
import json
import os
import sys
import tempfile
import time
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "backend"))
sys.path.insert(0, str(HERE.parent / "backend" / "tests"))

MAX_CALLS = 25

# (prompt, sensible tools: any one of them counts; read-only questions must not change anything)
PROMPTS = [
    ("How much money do I have in total right now?", {"get_financial_summary", "get_accounts"}),
    ("What did I spend on groceries this month?", {"get_financial_summary"}),
    ("Spent 12.50 at Lidl on groceries, paid with my bank account.", {"create_expense"}),
    ("I got 80 euros from my mum, put it in my wallet.", {"record_income"}),
    ("Move 20 euros from my bank to my cash.", {"transfer_money"}),
    ("Who owes me money?", {"get_people_balances"}),
    ("What is running low in the kitchen?", {"get_grocery_summary", "get_groceries", "get_grocery_suggestions", "get_kitchen_overview", "get_expiring_items"}),
    ("What is about to expire?", {"get_expiring_items", "get_groceries", "get_kitchen_overview"}),
    ("Add milk and eggs to my shopping list.", {"add_shopping_item", "get_shopping_lists"}),
    ("What can I cook with what I have?", {"suggest_recipes_from_inventory", "get_kitchen_overview"}),
    ("Add a task: call the dentist tomorrow at 9.", {"create_task"}),
    ("What is on my task list?", {"get_tasks", "list_tasks", "get_task_summary"}),
    ("I weighed 79.8 kg this morning.", {"record_weight"}),
    ("Log a workout: 30 minutes of running.", {"log_workout"}),
    ("What did I eat today and how many calories is that?", {"get_nutrition_day", "get_nutrition_summary", "get_diary", "get_day_nutrition"}),
    ("Log a banana and a coffee for breakfast.", {"log_meal", "log_food", "add_diary_entry", "log_diary_entry"}),
    ("What is my theme set to, and switch it to dark.", {"get_settings", "update_settings"}),
    ("Show me the price history of olive oil.", {"get_price_history"}),
    ("Create a place called Piggy bank in my cash with 15 euros.", {"create_money_space"}),
    ("Summarise how my week looks: spending, tasks and what to eat.", {"get_financial_summary", "get_tasks", "list_tasks", "get_nutrition_day", "get_nutrition_summary"}),
]


def main(argv) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--run", action="store_true", help="really call the model (costs quota)")
    ap.add_argument("--limit", type=int, default=len(PROMPTS))
    args = ap.parse_args(argv)
    if not args.run:
        print("Nothing was called. Add --run to make one bounded live run.")
        return 0
    prompts = PROMPTS[: min(args.limit, MAX_CALLS)]
    import isolated_env as ie
    import local_secrets
    key = local_secrets.read_store().get("OPENCODE_API_KEY")
    if not key:
        print("No OPENCODE_API_KEY in the encrypted store.")
        return 2
    ie.DEAD_END_AI = {"AI_PROVIDER": "opencode", "OPENCODE_API_KEY": key}   # the scratch server gets the real provider (and only that)
    env = ie.start(sample_data=True)
    results, calls = [], 0
    try:
        r = requests.post(f"{env.base_url}/api/auth/login", json={"email": env.user_email, "password": env.user_password}, timeout=30)
        r.raise_for_status()
        headers = {"Authorization": f"Bearer {r.json()['token']}"}
        for text, ok_tools in prompts:
            if calls >= MAX_CALLS:
                break
            calls += 1
            started = time.time()
            res = requests.post(f"{env.base_url}/api/ai/chat", json={"message": text}, headers=headers, timeout=180)
            took = round(time.time() - started, 1)
            if res.status_code != 200:
                results.append({"prompt": text, "status": res.status_code, "error": res.text[:200], "ok": False, "seconds": took})
                print(f"[{calls:2}] ERROR {res.status_code} {text}")
                if res.status_code in (401, 402, 403, 429, 503):
                    break                                              # no point spending more calls on a provider that refuses
                continue
            body = res.json()
            tools = [a["tool"] for a in body.get("actions", [])]
            ok = bool(set(tools) & ok_tools)
            results.append({"prompt": text, "tools": tools, "sensible": sorted(ok_tools), "ok": ok, "reply": body.get("reply", "")[:160], "seconds": took})
            print(f"[{calls:2}] {'OK  ' if ok else 'MISS'} {took:5}s  {text[:60]:60}  -> {tools or 'no tool'}")
    finally:
        env.stop()
    out = Path(tempfile.gettempdir()) / "liferecord-live-assistant-probe.json"
    out.write_text(json.dumps({"calls": calls, "results": results}, indent=1), encoding="utf-8")
    good = sum(1 for x in results if x.get("ok"))
    print(f"\n{calls} calls, {good}/{len(results)} chose a sensible tool. Report: {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
