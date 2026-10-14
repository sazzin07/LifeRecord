import asyncio
import aiomysql


async def main():
    conn = await aiomysql.connect(host='localhost', port=3306, user='root', password='')
    async with conn.cursor() as cur:
        await cur.execute("SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = 'liferecord'")
        if not await cur.fetchone():
            await cur.execute('CREATE DATABASE liferecord CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')
            print('Created liferecord database')
    await conn.commit()
    conn.close()


if __name__ == "__main__":
    asyncio.run(main())
