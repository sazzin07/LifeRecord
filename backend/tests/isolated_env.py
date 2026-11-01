"""A throw-away LifeRecord backend for tests: a scratch MySQL schema plus a server on a free local port.

    LR_ISOLATED=1 python -m pytest tests          # the whole suite runs against a scratch schema (see conftest.py)
    python tests/isolated_env.py serve            # backend + React dev server for browser tests (see serve())
    python tests/isolated_env.py run -- CMD ...   # run CMD with that stack's settings (for example: npx playwright test)

Guarantees (each pinned by test_isolated_env.py):
- Only schemas named liferecord_test_<pid>[_<n>] are ever created or dropped; the real `liferecord` schema is refused.
- Nothing real reaches the scratch server: JWT, upload and owner secrets are fresh random values, the Gemini and
  SendGrid keys are the empty string (an empty value still counts as "already set", so neither the encrypted store nor
  backend/.env can fill it in), and both the assistant's provider and mail point at dead ends on loopback. It can
  neither call a model nor send mail.
- The test account lives on the reserved domain example.com, which is never mailed.
The administrative database login (ADMIN_DATABASE_*) from the secrets store or the environment is used only to
create and drop the scratch schema; the scratch server runs with it because the schema is disposable.
"""
import atexit
import itertools
import os
import re
import secrets
import socket
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import pymysql
import requests

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
import local_secrets  # noqa: E402

SCHEMA_RE = re.compile(r"^liferecord_test_(\d+)(?:_(\d+))?$")
_counter = itertools.count(1)

# Everything a real deployment configures that the scratch server must not have.
BLANKED = ("GEMINI_API_KEY", "SENDGRID_API_KEY", "SENDGRID_FROM_EMAIL", "SMTP_PASSWORD")
# Mail is "configured" (so reserved test domains are skipped exactly as in a real setup) but the relay is a dead end:
# loopback port 1 has no listener, so even a non-reserved recipient could only produce a connection error.
# The assistant counts as "configured" (so validation and error paths behave as in production) but its provider address is
# an address with no usable scheme: the HTTP client refuses it before any network activity, so no model can ever be reached.
DEAD_END_AI = {"AI_PROVIDER": "opencode", "OPENCODE_API_KEY": "scratch-key-not-a-real-key", "OPENCODE_BASE_URL": "scratch://dead-end"}
DEAD_END_MAIL = {"EMAIL_PROVIDER": "smtp", "SMTP_HOST": "127.0.0.1", "SMTP_PORT": "1", "SMTP_USERNAME": "apikey",
                 "SMTP_USE_TLS": "false", "SMTP_FROM_EMAIL": "scratch@example.com", "SMTP_FROM_NAME": "Life Record (scratch)"}


def assert_scratch_name(name: str) -> None:
    if not isinstance(name, str) or not SCHEMA_RE.fullmatch(name):
        raise ValueError(f"{name!r} is not a scratch schema name (liferecord_test_<pid>[_<n>]); refusing to touch it")


def admin_credentials() -> tuple:
    user = os.environ.get("ADMIN_DATABASE_USER", "root")
    password = os.environ.get("ADMIN_DATABASE_PASSWORD")
    if password is None:
        password = local_secrets.read_store().get("ADMIN_DATABASE_PASSWORD", "")
    return user, password


def _admin_connection(database: Optional[str] = None):
    user, password = admin_credentials()
    return pymysql.connect(host="127.0.0.1", port=int(os.environ.get("DATABASE_PORT", "3306")), user=user, password=password,
                           database=database, autocommit=True)


def schema_exists(name: str) -> bool:
    conn = _admin_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = %s", (name,))
            return cur.fetchone() is not None
    finally:
        conn.close()


def _create_schema(name: str) -> None:
    assert_scratch_name(name)
    conn = _admin_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(f"CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
    finally:
        conn.close()


def _drop_schema(name: str) -> None:
    assert_scratch_name(name)
    conn = _admin_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(f"DROP DATABASE IF EXISTS `{name}`")
    finally:
        conn.close()


def _pid_alive(pid: int) -> bool:
    if pid == os.getpid():
        return True
    if os.name == "nt":
        out = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True).stdout
        return str(pid) in out
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def drop_stale_schemas() -> list:
    """Remove scratch schemas left behind by runs that crashed (their process no longer exists)."""
    conn = _admin_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME LIKE 'liferecord\\_test\\_%'")
            names = [r[0] for r in cur.fetchall()]
    finally:
        conn.close()
    dropped = []
    for name in names:
        m = SCHEMA_RE.fullmatch(name)
        if m and not _pid_alive(int(m.group(1))):
            _drop_schema(name)
            dropped.append(name)
    return dropped


def baseline_environ() -> dict:
    """What a child process needs from the current environment (PATH, SystemRoot, ...) and nothing secret."""
    keep = ("PATH", "PATHEXT", "SystemRoot", "SYSTEMROOT", "TEMP", "TMP", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA",
            "COMSPEC", "WINDIR", "USERNAME", "USER", "LOGNAME", "USERDOMAIN", "COMPUTERNAME", "OS",
            "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS", "LANG", "LC_ALL")
    return {k: v for k, v in os.environ.items() if k in keep}


def build_environment(db_name: str, storage_dir: str, admin_user: str, admin_password: str, port: int,
                      cors_origins: str = "http://127.0.0.1:3000,http://localhost:3000") -> dict:
    from cryptography.fernet import Fernet
    assert_scratch_name(db_name)
    env = {
        "DATABASE_HOST": "127.0.0.1", "DATABASE_PORT": os.environ.get("DATABASE_PORT", "3306"), "DATABASE_NAME": db_name,
        "DATABASE_USER": admin_user, "DATABASE_PASSWORD": admin_password,
        "ADMIN_DATABASE_USER": admin_user, "ADMIN_DATABASE_PASSWORD": admin_password,
        "ADMIN_EMAIL": "scratch-owner@example.com", "ADMIN_PASSWORD": "Aa1-" + secrets.token_urlsafe(18),
        "JWT_SECRET": secrets.token_urlsafe(48), "UPLOAD_ENCRYPTION_KEY": Fernet.generate_key().decode(),
        "STORAGE_DIR": storage_dir, "SCHEDULER_ENABLED": "false",
        "CORS_ORIGINS": cors_origins, "FRONTEND_URL": f"http://127.0.0.1:{port}",
        "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8",
    }
    env.update({name: "" for name in BLANKED})
    env.update(DEAD_END_MAIL)
    env.update(DEAD_END_AI)
    return env


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@dataclass
class IsolatedEnv:
    db_name: str
    base_url: str
    user_email: str
    user_password: str
    admin_email: str
    settings: dict
    storage_dir: str
    _proc: Optional[subprocess.Popen] = field(default=None, repr=False)
    _log: str = ""
    _stopped: bool = False

    def stop(self) -> None:
        if self._stopped:
            return
        self._stopped = True
        if self._proc and self._proc.poll() is None:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                self._proc.kill()
        _drop_schema(self.db_name)
        import shutil
        shutil.rmtree(self.storage_dir, ignore_errors=True)
        Path(self._log).unlink(missing_ok=True)

    def connect(self):
        """A direct database connection to the scratch schema (administrative login)."""
        return _admin_connection(self.db_name)


def _wait_for_health(base_url: str, proc: subprocess.Popen, log_path: str, timeout: float = 120.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            tail = Path(log_path).read_text(encoding="utf-8", errors="replace")[-2500:]
            raise RuntimeError(f"scratch backend exited with {proc.returncode}:\n{tail}")
        try:
            if requests.get(f"{base_url}/api/health", timeout=2).status_code == 200:
                return
        except requests.RequestException:
            pass
        time.sleep(0.4)
    raise RuntimeError(f"scratch backend did not become healthy within {timeout:.0f}s (log: {log_path})")


def _register_verified(env: IsolatedEnv, name: str) -> None:
    """Sign up through the real endpoints and confirm with the code read from the scratch schema."""
    r = requests.post(f"{env.base_url}/api/auth/register",
                      json={"email": env.user_email, "password": env.user_password, "name": name}, timeout=30)
    assert r.status_code == 200, r.text
    conn = env.connect()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT verification_code FROM users WHERE email = %s", (env.user_email,))
            code = cur.fetchone()[0]
    finally:
        conn.close()
    r = requests.post(f"{env.base_url}/api/auth/verify", json={"email": env.user_email, "code": code}, timeout=30)
    assert r.status_code == 200, r.text


def load_reference_foods(env: IsolatedEnv) -> None:
    """The shared USDA food table (public domain), through the real importer and the dataset cached outside the project."""
    out = subprocess.run([sys.executable, str(BACKEND / "import_usda.py")], cwd=str(BACKEND), capture_output=True, text=True,
                         env={**baseline_environ(), **env.settings}, timeout=900)
    if out.returncode != 0:
        raise RuntimeError("import_usda.py failed:\n" + out.stdout[-1500:] + "\n" + out.stderr[-1500:])


def seed_sample_data(env: IsolatedEnv) -> None:
    """The documented standard testing account: John's fictional sample data, through the scratch server's own API."""
    out = subprocess.run([sys.executable, str(BACKEND / "seed_john.py")], cwd=str(BACKEND), capture_output=True, text=True,
                         env={**baseline_environ(), **env.settings, "SEED_BASE_URL": env.base_url, "SEED_EMAIL": env.user_email,
                              "SEED_PASSWORD": env.user_password}, timeout=900)
    if out.returncode != 0:
        raise RuntimeError("seed_john.py failed:\n" + out.stdout[-1500:] + "\n" + out.stderr[-1500:])


def start(*, user_email: str = "john.test@example.com", user_name: str = "John", cors_origins: Optional[str] = None,
          port: Optional[int] = None, register_user: bool = True, foods: bool = False, sample_data: bool = False) -> IsolatedEnv:
    """Create a scratch schema, start a server on it, and (by default) register one verified test user.
    `foods` loads the USDA reference foods; `sample_data` seeds the user like the standard testing account (John)."""
    if not user_email.lower().endswith("@example.com"):
        raise ValueError("the scratch test user must be on example.com so no mail can ever reach a real mailbox")
    drop_stale_schemas()
    db_name = f"liferecord_test_{os.getpid()}_{next(_counter)}"
    _create_schema(db_name)
    storage = tempfile.mkdtemp(prefix="lr-scratch-storage-")
    port = port or _free_port()
    admin_user, admin_password = admin_credentials()
    settings = build_environment(db_name, storage, admin_user, admin_password, port,
                                 **({"cors_origins": cors_origins} if cors_origins else {}))
    log_path = os.path.join(tempfile.gettempdir(), f"{db_name}.log")
    env = IsolatedEnv(db_name=db_name, base_url=f"http://127.0.0.1:{port}", user_email=user_email,
                      user_password="Aa1-" + secrets.token_urlsafe(14), admin_email=settings["ADMIN_EMAIL"],
                      settings=settings, storage_dir=storage, _log=log_path)
    atexit.register(env.stop)
    try:
        with open(log_path, "wb") as log:
            env._proc = subprocess.Popen(
                [sys.executable, "-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
                cwd=str(BACKEND), env={**baseline_environ(), **settings}, stdout=log, stderr=subprocess.STDOUT)
        _wait_for_health(env.base_url, env._proc, log_path)
        if foods:
            load_reference_foods(env)
        if register_user:
            _register_verified(env, user_name)
            if sample_data:
                seed_sample_data(env)
    except BaseException:
        env.stop()
        raise
    return env


_current: Optional[IsolatedEnv] = None


def start_for_pytest() -> IsolatedEnv:
    """Point this pytest process (and the xdist workers it spawns) at a scratch backend."""
    global _current
    _current = start(foods=True, sample_data=True)
    os.environ.update(_current.settings)
    os.environ.update({"REACT_APP_BACKEND_URL": _current.base_url, "TEST_EMAIL": _current.user_email,
                       "TEST_PASSWORD": _current.user_password, "LR_ISOLATED_ACTIVE": "1"})
    return _current


def stop_for_pytest() -> None:
    global _current
    if _current is not None:
        _current.stop()
        _current = None


STATE_FILE = Path(tempfile.gettempdir()) / "liferecord-scratch-stack.json"


def _kill_tree(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)
    else:
        proc.terminate()


def serve(frontend_port: int = 3100, with_frontend: bool = True) -> None:
    """A complete scratch stack for browser tests: backend on a free port (John's sample data and the foods loaded) and,
    optionally, the React dev server pointed at it. Writes STATE_FILE; exits and cleans up when STATE_FILE.stop appears."""
    import json
    stop_file = Path(str(STATE_FILE) + ".stop")
    stop_file.unlink(missing_ok=True)
    origins = f"http://127.0.0.1:{frontend_port},http://localhost:{frontend_port}"
    env = start(foods=True, sample_data=True, cors_origins=origins)
    front = None
    try:
        if with_frontend:
            front_env = {**baseline_environ(), "PORT": str(frontend_port), "HOST": "127.0.0.1", "BROWSER": "none",
                         "REACT_APP_BACKEND_URL": env.base_url, "CI": "false"}
            log = open(Path(tempfile.gettempdir()) / "liferecord-scratch-frontend.log", "wb")
            front = subprocess.Popen(["cmd", "/c", "yarn", "start"] if os.name == "nt" else ["yarn", "start"],
                                     cwd=str(BACKEND.parent / "frontend"), env=front_env, stdout=log, stderr=subprocess.STDOUT)
            deadline = time.time() + 300
            while time.time() < deadline:
                try:
                    if requests.get(f"http://127.0.0.1:{frontend_port}/", timeout=2).status_code == 200:
                        break
                except requests.RequestException:
                    pass
                time.sleep(1)
            else:
                raise RuntimeError("the React dev server did not start within 5 minutes")
        STATE_FILE.write_text(json.dumps({
            "api_url": env.base_url, "base_url": f"http://127.0.0.1:{frontend_port}" if front else None,
            "test_email": env.user_email, "test_password": env.user_password, "db_name": env.db_name,
            "settings": {k: v for k, v in env.settings.items() if k not in ("DATABASE_PASSWORD", "ADMIN_DATABASE_PASSWORD")},
        }), encoding="utf-8")
        print(f"scratch stack ready: {STATE_FILE}", flush=True)
        while not stop_file.exists():
            time.sleep(1)
    finally:
        STATE_FILE.unlink(missing_ok=True)
        stop_file.unlink(missing_ok=True)
        if front:
            _kill_tree(front)
        env.stop()


def run_command(command: list) -> int:
    """Run a command with the environment of the stack that `serve` started (database name, test account, URLs). The
    administrative database login is read from the secrets store here, so it is never written to the state file."""
    import json
    if not STATE_FILE.exists():
        raise SystemExit("no scratch stack is running (start one with: python tests/isolated_env.py serve)")
    state = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    admin_user, admin_password = admin_credentials()
    # Test-tool switches (A11Y_LIST, PWDEBUG, DEBUG, CI, ...) pass through; nothing else from the caller's environment does.
    passthrough = {k: v for k, v in os.environ.items() if k.startswith(("A11Y_", "PW", "PLAYWRIGHT_", "DEBUG")) or k == "CI"}
    env = {**baseline_environ(), **passthrough, **state["settings"], "DATABASE_USER": admin_user, "DATABASE_PASSWORD": admin_password,
           "ADMIN_DATABASE_USER": admin_user, "ADMIN_DATABASE_PASSWORD": admin_password,
           "TEST_EMAIL": state["test_email"], "TEST_PASSWORD": state["test_password"], "API_URL": state["api_url"],
           "REACT_APP_BACKEND_URL": state["api_url"]}
    if state.get("base_url"):
        env["BASE_URL"] = state["base_url"]
    import shutil
    exe = shutil.which(command[0], path=env.get("PATH")) or command[0]  # npx is npx.cmd on Windows
    return subprocess.call([exe, *command[1:]], env=env)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "serve":
        serve(with_frontend="--no-frontend" not in sys.argv)
    elif len(sys.argv) > 2 and sys.argv[1] == "run" and sys.argv[2] == "--":
        sys.exit(run_command(sys.argv[3:]))
    else:
        print(__doc__)
