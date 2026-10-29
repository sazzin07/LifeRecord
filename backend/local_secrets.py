"""Encrypted store for secrets (JWT secret, database password, API keys) kept outside the project.

On Windows the secrets live in %LOCALAPPDATA%\\LifeRecord\\secrets.dpapi, encrypted with DPAPI for the signed-in
Windows user: other users and other machines cannot read the file, and no secret sits in plaintext in the repo
folder. Precedence when the app starts: real environment variable > this store > backend/.env.

On other systems there is no store; provide the same names as real environment variables (or a secret manager).

    python local_secrets.py migrate            # move secrets from backend/.env into the store
    python local_secrets.py set NAME           # prompt for a value (not echoed)
    python local_secrets.py names              # list stored names (never values)
    python local_secrets.py rotate-jwt         # new random JWT secret (signs every user out)
    python local_secrets.py run -- CMD ...     # run CMD with the stored secrets as environment variables
"""
import argparse
import ctypes
import getpass
import json
import os
import secrets
import subprocess
import sys
from ctypes import wintypes
from pathlib import Path
from typing import List, Optional

# Names that are moved out of backend/.env. Everything else in .env is plain configuration.
SECRET_KEYS = (
    "JWT_SECRET", "DATABASE_PASSWORD", "ADMIN_PASSWORD", "ADMIN_DATABASE_PASSWORD",
    "GEMINI_API_KEY", "OPENCODE_API_KEY", "SENDGRID_API_KEY", "SMTP_PASSWORD",
)
_ENTROPY = b"LifeRecord/secrets/v1"


class SecretsError(RuntimeError):
    pass


def default_store_path() -> Path:
    override = os.environ.get("LIFERECORD_SECRETS_FILE")
    if override:
        return Path(override)
    base = os.environ.get("LOCALAPPDATA")
    return Path(base) / "LifeRecord" / "secrets.dpapi" if base else Path.home() / ".liferecord" / "secrets.dpapi"


class _Blob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]


def _blob(data: bytes) -> _Blob:
    return _Blob(len(data), ctypes.cast(ctypes.create_string_buffer(data, len(data)), ctypes.POINTER(ctypes.c_char)))


def _dpapi(fn_name: str, data: bytes) -> bytes:
    if sys.platform != "win32":
        raise SecretsError("The encrypted secrets store needs Windows DPAPI; use environment variables on this system.")
    crypt32, kernel32 = ctypes.windll.crypt32, ctypes.windll.kernel32
    src, entropy, out = _blob(data), _blob(_ENTROPY), _Blob()
    fn = getattr(crypt32, fn_name)
    ok = fn(ctypes.byref(src), None, ctypes.byref(entropy), None, None, 0, ctypes.byref(out))
    if not ok:
        raise SecretsError("Could not decrypt the secrets file (wrong Windows user, or the file is damaged).")
    try:
        return ctypes.string_at(out.pbData, out.cbData)
    finally:
        kernel32.LocalFree(out.pbData)


def read_store(path: Optional[Path] = None) -> dict:
    path = Path(path) if path else default_store_path()
    if not path.exists():
        return {}
    try:
        return json.loads(_dpapi("CryptUnprotectData", path.read_bytes()).decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise SecretsError("The secrets file is damaged.") from exc


def write_store(values: dict, path: Optional[Path] = None) -> None:
    path = Path(path) if path else default_store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    blob = _dpapi("CryptProtectData", json.dumps(values).encode("utf-8"))
    tmp = path.with_suffix(f".{os.getpid()}.tmp")
    tmp.write_bytes(blob)
    os.replace(tmp, path)  # never leaves a half-written store behind


def load_into_environ(environ=None, path: Optional[Path] = None) -> List[str]:
    """Copy stored secrets into the environment without overriding variables that are already set."""
    environ = os.environ if environ is None else environ
    loaded = []
    for key, value in read_store(path).items():
        if key not in environ:
            environ[key] = value
            loaded.append(key)
    return loaded


def migrate_env_file(env_file: Path, store: Optional[Path] = None) -> List[str]:
    """Move non-empty secrets from a .env file into the store, then remove them from the file."""
    env_file = Path(env_file)
    lines = env_file.read_text(encoding="utf-8").splitlines()
    found, kept = {}, []
    for line in lines:
        key, sep, value = line.partition("=")
        if sep and key.strip() in SECRET_KEYS:
            if value.strip():
                found[key.strip()] = value.strip()
            else:
                kept.append(line)  # an empty value is configuration, not a secret
        else:
            kept.append(line)
    if not found:
        return []
    merged = {**read_store(store), **found}
    write_store(merged, store)
    if read_store(store) != merged:  # verify before touching the .env
        raise SecretsError("The secrets file did not read back correctly; .env was left unchanged.")
    note = "# Secrets are stored encrypted outside the project (see backend/local_secrets.py)."
    if note not in kept:
        kept.insert(0, note)
    env_file.write_text("\n".join(kept) + "\n", encoding="utf-8")
    return list(found)


def rotate_jwt_secret(store: Optional[Path] = None) -> None:
    values = read_store(store)
    values["JWT_SECRET"] = secrets.token_urlsafe(64)
    write_store(values, store)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["migrate", "set", "names", "rotate-jwt", "run"])
    parser.add_argument("name", nargs="?")
    parser.add_argument("--store", type=Path)
    parser.add_argument("--env-file", type=Path, default=Path(__file__).parent / ".env")
    argv = list(sys.argv[1:] if argv is None else argv)
    child = []
    if "--" in argv:  # everything after -- is the command to run
        cut = argv.index("--")
        argv, child = argv[:cut], argv[cut + 1:]
    args = parser.parse_args(argv)
    if args.command == "migrate":
        moved = migrate_env_file(args.env_file, args.store)
        print("Moved to the encrypted store: " + (", ".join(moved) if moved else "nothing (no secrets in .env)"))
    elif args.command == "set":
        if not args.name:
            parser.error("set needs a NAME")
        value = getpass.getpass(f"Value for {args.name} (hidden): ")
        if not value:
            parser.error("empty value; nothing stored")
        write_store({**read_store(args.store), args.name: value}, args.store)
        print(f"Stored {args.name}.")
    elif args.command == "run":
        if not child:
            parser.error("run needs a command after --")
        env = dict(os.environ)
        load_into_environ(env, args.store)
        return subprocess.call(child, env=env, shell=(sys.platform == "win32"))
    elif args.command == "names":
        print("\n".join(sorted(read_store(args.store))) or "(store is empty)")
    else:
        rotate_jwt_secret(args.store)
        print("JWT secret rotated; every existing session is now invalid.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
