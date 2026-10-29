"""Direct database access for tests (reading verification codes, removing test users).

Uses the administrative login (ADMIN_DATABASE_USER / ADMIN_DATABASE_PASSWORD from the encrypted store or the
environment), not the restricted account the app runs as.
"""
import os
import sys
from pathlib import Path

import pymysql

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import local_secrets  # noqa: E402

local_secrets.load_into_environ()


def connect(**kwargs):
    return pymysql.connect(host="127.0.0.1", port=3306, user=os.environ.get("ADMIN_DATABASE_USER", "root"),
                           password=os.environ.get("ADMIN_DATABASE_PASSWORD", ""), database="liferecord", **kwargs)
