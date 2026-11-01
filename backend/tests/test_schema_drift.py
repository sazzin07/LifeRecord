"""The schema is built two ways: Alembic migrations (what a production database gets) and `create_all` at startup (what
a new development database gets). Nothing else proves they agree, so a model change without its migration would only
show up on the first real upgrade. This builds an empty scratch schema from the migrations alone and asks Alembic
whether the models still describe it."""
import os
import subprocess
import sys
from pathlib import Path

import pytest
import sqlalchemy as sa
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext

import isolated_env as ie

BACKEND = Path(__file__).resolve().parents[1]


@pytest.fixture
def migrated_schema():
    name = f"liferecord_test_{os.getpid()}_{900 + next(ie._counter)}"
    ie._create_schema(name)
    try:
        user, password = ie.admin_credentials()
        env = {**ie.baseline_environ(), "DATABASE_NAME": name, "ADMIN_DATABASE_USER": user, "ADMIN_DATABASE_PASSWORD": password,
               "DATABASE_HOST": "127.0.0.1", "JWT_SECRET": "x" * 40}
        out = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND, env=env,
                             capture_output=True, text=True, timeout=300)
        assert out.returncode == 0, out.stdout[-1500:] + out.stderr[-1500:]
        yield name  # the name only: pytest prints fixture values in failures, and credentials must never be among them
    finally:
        ie._drop_schema(name)


def test_alembic_head_matches_the_models(migrated_schema):
    name = migrated_schema
    user, password = ie.admin_credentials()
    import urllib.parse
    from models import Base
    engine = sa.create_engine(f"mysql+pymysql://{urllib.parse.quote_plus(user)}:{urllib.parse.quote_plus(password)}@127.0.0.1/{name}")
    try:
        with engine.connect() as conn:
            diffs = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    finally:
        engine.dispose()
    assert diffs == [], "models and migrations disagree:\n" + "\n".join(map(str, diffs[:25]))
