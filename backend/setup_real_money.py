"""One-time setup for real money accounts.
Run after extending the Account model. Uses environment variables from .env.
"""
import os
import asyncio
from datetime import datetime, timezone
from dotenv import load_dotenv

load_dotenv()

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import select, delete

from models import Account, Transaction
from database import DATABASE_URL

EMAIL = "tiagosa743@gmail.com"

engine = create_async_engine(DATABASE_URL, poolclass=None, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


def now_iso():
    return datetime.now(timezone.utc).isoformat()


async def main():
    async with AsyncSessionLocal() as db:
        from models import User
        user = (await db.execute(select(User).where(User.email == EMAIL))).scalar_one_or_none()
        if not user:
            print(f"User {EMAIL} not found")
            return
        user_id = user.id
        print(f"Setting up real money for user {user_id}")

        # Delete user's money-related transactions and accounts.
        await db.execute(delete(Transaction).where(
            Transaction.user_id == user_id,
            Transaction.type.in_(["expense", "income", "transfer"])
        ))
        await db.execute(delete(Account).where(Account.user_id == user_id))
        await db.commit()

        # Create accounts.
        def make(name, type, opening_balance, parent_id=None, currency="EUR", sort_order=0, initial_balance=None):
            import uuid
            return Account(
                id=str(uuid.uuid4()),
                user_id=user_id,
                name=name,
                type=type,
                parent_id=parent_id,
                currency=currency,
                opening_balance=opening_balance,
                initial_balance=initial_balance,
                sort_order=sort_order,
                is_active=True,
                created_at=now_iso(),
            )

        bank = make("Bank account", "bank", 300.00, sort_order=0, initial_balance=1400.00)
        cash = make("Money in hand", "cash", 0.00, sort_order=1)
        revolut = make("Revolut", "revolut", 30.66, sort_order=2)

        db.add_all([bank, cash, revolut])
        await db.flush()

        wallet = make("Wallet", "cash_place", 0.00, parent_id=cash.id, sort_order=0)
        envelope = make("Envelope", "cash_place", 130.00, parent_id=cash.id, sort_order=1)
        pounds = make("British pounds", "cash_place", 20.00, parent_id=cash.id, sort_order=2)
        coin_pouch = make("Coin pouch", "cash_place", 16.15, parent_id=cash.id, sort_order=3)

        db.add_all([wallet, envelope, pounds, coin_pouch])
        await db.commit()
        print("Real money accounts created.")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
