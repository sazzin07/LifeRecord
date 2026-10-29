"""Browser-test support: seed one scheduled task whose history has a failed, a missed and a succeeded-but-undelivered run
(so the failure and retry UI can be exercised without a real failure), or remove it again.

    python tests/support_seed_runs.py seed     # prints {"task_id": "..."}
    python tests/support_seed_runs.py clean
"""
import asyncio
import json
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402,F401  (loads backend/.env)
import scheduling as sch  # noqa: E402
from database import AsyncSessionLocal  # noqa: E402
from sqlalchemy import delete, select  # noqa: E402
from models import ScheduledTask, ScheduledTaskRun, User  # noqa: E402
from support_auth import OWNER_EMAIL  # noqa: E402

TITLE = "E2E seeded history"


async def clean():
    async with AsyncSessionLocal() as db:
        ids = (await db.execute(select(ScheduledTask.id).where(ScheduledTask.title == TITLE))).scalars().all()
        await db.execute(delete(ScheduledTaskRun).where(ScheduledTaskRun.task_id.in_(ids)))
        await db.execute(delete(ScheduledTask).where(ScheduledTask.id.in_(ids)))
        await db.commit()


async def seed():
    await clean()
    now = datetime.now(timezone.utc)
    iso = sch.iso
    async with AsyncSessionLocal() as db:
        owner = (await db.execute(select(User).where(User.email == OWNER_EMAIL))).scalar_one()
        task = ScheduledTask(id=str(uuid.uuid4()), user_id=owner.id, title=TITLE, instruction="Summarise last week's spending.",
                             schedule={"kind": "daily", "time": "09:00"}, timezone="Europe/Lisbon", data_sources=["money"],
                             recipients=["e2e-unverified@example.test"], status="active", next_run_at=iso(now + timedelta(days=1)), confirmed_at=iso(now),
                             last_run_at=iso(now - timedelta(hours=1)), last_status="succeeded", created_at=iso(now), updated_at=iso(now))
        db.add(task)
        await db.flush()

        def run(key, minutes_ago, **kw):
            kw.setdefault("delivery_status", "none")
            return ScheduledTaskRun(id=str(uuid.uuid4()), task_id=task.id, user_id=owner.id, run_key=key, trigger="schedule",
                                    scheduled_for=iso(now - timedelta(minutes=minutes_ago)), created_at=iso(now - timedelta(minutes=minutes_ago)),
                                    started_at=iso(now - timedelta(minutes=minutes_ago)), finished_at=iso(now - timedelta(minutes=minutes_ago)),
                                    duration_ms=4200, **kw)
        db.add(run("seed:missed", 3000, status="missed", error="The server was not running at the scheduled time."))
        db.add(run("seed:failed", 1500, status="failed", error="The AI usage limit for this plan has been reached for now (5-hour, weekly or monthly). Try again later."))
        db.add(run("seed:ok", 60, status="succeeded", output="Spending was €214.60 last week, down 12% on the week before.\n\n- Groceries: €98.40\n- Eating out: €41.20",
                   tools_used=["get_transactions"], data_errors=[], delivery_status="failed",
                   delivery_detail="Sent to 0 of 1. SendGrid refused the message: the sender address is not verified.",
                   deliveries=[{"email": "e2e-unverified@example.test", "status": "failed", "detail": "SendGrid refused the message: the sender address is not verified."}]))
        await db.commit()
        return task.id


if __name__ == "__main__":
    if sys.argv[1:] == ["seed"]:
        print(json.dumps({"task_id": asyncio.run(seed())}))
    else:
        asyncio.run(clean())
        print(json.dumps({"cleaned": True}))
