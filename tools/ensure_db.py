import asyncio
import os
import sys
from pathlib import Path

import aiomysql

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import local_secrets  # noqa: E402

local_secrets.load_into_environ()


async def main():
    # Administrative login (creates the database if missing). The app itself uses the restricted DATABASE_USER.
    conn = await aiomysql.connect(host='127.0.0.1', port=3306, user=os.environ.get('ADMIN_DATABASE_USER', 'root'),
                                  password=os.environ.get('ADMIN_DATABASE_PASSWORD', ''))
    async with conn.cursor() as cur:
        await cur.execute("SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = 'liferecord'")
        if not await cur.fetchone():
            await cur.execute('CREATE DATABASE liferecord CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')
            print('Created liferecord database')
    await conn.commit()
    conn.close()


if __name__ == "__main__":
    asyncio.run(main())
