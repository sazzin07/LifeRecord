import asyncio
import aiomysql
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("migration")

DB_CONFIG = {
    "host": "localhost",
    "port": 3306,
    "user": "root",
    "password": "",
    "db": "liferecord",
}

USER_TABLES = [
    "accounts", "categories", "people", "transactions", "settlements",
    "tasks", "weight_entries", "workouts", "photos", "groceries",
    "price_records", "shopping_items", "meals", "recipes", "ai_actions", "ai_messages",
]

USER_COLUMNS = """
    email_verified TINYINT(1) NOT NULL DEFAULT 0,
    verification_code VARCHAR(10) DEFAULT NULL,
    verification_code_expires_at VARCHAR(32) DEFAULT NULL,
    verification_attempts INT NOT NULL DEFAULT 0,
    last_verification_sent_at VARCHAR(32) DEFAULT NULL,
    password_reset_token VARCHAR(255) DEFAULT NULL UNIQUE,
    password_reset_expires_at VARCHAR(32) DEFAULT NULL
"""


async def migrate():
    conn = await aiomysql.connect(**DB_CONFIG)
    try:
        async with conn.cursor() as cur:
            # 1. Add verification columns to users
            logger.info("Adding verification columns to users...")
            for col_def in USER_COLUMNS.strip().split(",\n"):
                col_def = col_def.strip()
                if not col_def:
                    continue
                col_name = col_def.split()[0]
                try:
                    await cur.execute(f"ALTER TABLE users ADD COLUMN {col_def}")
                    logger.info("  Added %s", col_name)
                except Exception as exc:
                    if "Duplicate" in str(exc) or "already exists" in str(exc).lower():
                        logger.info("  %s already exists", col_name)
                    else:
                        raise

            # 2. Find or create default admin user
            logger.info("Finding admin user...")
            await cur.execute("SELECT id, email FROM users ORDER BY created_at LIMIT 1")
            row = await cur.fetchone()
            if row:
                admin_id = row[0]
                logger.info("  Existing admin: %s (%s)", row[1], admin_id)
            else:
                logger.info("  No users found; admin will be seeded by backend on startup")
                # We can't backfill without a user, so stop here for data tables.
                # But we still add the columns so the schema is ready.
                await conn.commit()
                return

            # 3. Add user_id columns and backfill
            for table in USER_TABLES:
                logger.info("Migrating %s...", table)
                try:
                    await cur.execute(f"ALTER TABLE {table} ADD COLUMN user_id VARCHAR(36) DEFAULT NULL")
                except Exception as exc:
                    if "Duplicate" in str(exc) or "already exists" in str(exc).lower():
                        logger.info("  user_id already exists")
                    else:
                        raise

                # Backfill existing rows with admin_id
                await cur.execute(f"UPDATE {table} SET user_id = %s WHERE user_id IS NULL", (admin_id,))
                affected = cur.rowcount
                logger.info("  Backfilled %s rows", affected)

                # Add FK constraint
                try:
                    await cur.execute(
                        f"ALTER TABLE {table} ADD CONSTRAINT fk_{table}_user "
                        f"FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE"
                    )
                    logger.info("  Added FK")
                except Exception as exc:
                    if "Duplicate" in str(exc) or "already exists" in str(exc).lower():
                        logger.info("  FK already exists")
                    else:
                        raise

                # Make NOT NULL
                await cur.execute(f"ALTER TABLE {table} MODIFY COLUMN user_id VARCHAR(36) NOT NULL")
                logger.info("  Made NOT NULL")

                # Add index
                try:
                    await cur.execute(f"CREATE INDEX ix_{table}_user_id ON {table}(user_id)")
                    logger.info("  Added index")
                except Exception as exc:
                    if "Duplicate" in str(exc) or "already exists" in str(exc).lower():
                        logger.info("  Index already exists")
                    else:
                        raise



        await conn.commit()
        logger.info("Migration completed successfully")
    finally:
        conn.close()


if __name__ == "__main__":
    asyncio.run(migrate())
