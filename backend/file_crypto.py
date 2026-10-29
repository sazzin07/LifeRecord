"""Encryption at rest for uploaded files (progress photos, pictures attached to chats).

Files are stored as  MAGIC + Fernet token  (AES-128-CBC with an HMAC, so tampering is detected). The key is
UPLOAD_ENCRYPTION_KEY, kept in the encrypted secrets store (see local_secrets.py).

- Without a key, new files are written as they are (and the app logs a warning once); nothing breaks.
- Files written before encryption existed have no MAGIC header and are still readable.
- An encrypted file with a missing or wrong key is an error. It is never served as garbage.

    python file_crypto.py encrypt-existing      # encrypt plaintext files already in STORAGE_DIR (idempotent)

LOSING THE KEY MAKES THE ENCRYPTED FILES UNREADABLE. Keep a copy of it somewhere safe
(`python local_secrets.py reveal UPLOAD_ENCRYPTION_KEY`, then store it in a password manager).
"""
import logging
import os
import sys
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

MAGIC = b"LRENC1\n"
logger = logging.getLogger("liferecord")
_warned = False


class FileCryptoError(RuntimeError):
    pass


def _fernet():
    key = os.environ.get("UPLOAD_ENCRYPTION_KEY", "").strip()
    if not key:
        return None
    try:
        return Fernet(key.encode())
    except ValueError as exc:
        raise FileCryptoError("UPLOAD_ENCRYPTION_KEY is not a valid Fernet key.") from exc


def encrypt(data: bytes) -> bytes:
    global _warned
    f = _fernet()
    if f is None:
        if not _warned:
            logger.warning("UPLOAD_ENCRYPTION_KEY is not set: uploads are stored unencrypted.")
            _warned = True
        return data
    return MAGIC + f.encrypt(data)


def decrypt(blob: bytes) -> bytes:
    if not blob.startswith(MAGIC):
        return blob  # stored before encryption was introduced
    f = _fernet()
    if f is None:
        raise FileCryptoError("This file is encrypted but UPLOAD_ENCRYPTION_KEY is not available.")
    try:
        return f.decrypt(blob[len(MAGIC):])
    except InvalidToken as exc:
        raise FileCryptoError("The file could not be decrypted (wrong key, or the file was altered).") from exc


def encrypt_tree(root: Path) -> int:
    """Encrypt every plaintext file under `root` in place; returns how many were changed."""
    if _fernet() is None:
        raise FileCryptoError("UPLOAD_ENCRYPTION_KEY is not available; nothing was changed.")
    changed = 0
    for path in sorted(Path(root).rglob("*")):
        if not path.is_file():
            continue
        data = path.read_bytes()
        if data.startswith(MAGIC):
            continue
        blob = encrypt(data)
        if decrypt(blob) != data:  # verify before replacing the original
            raise FileCryptoError(f"Round-trip check failed for {path}; nothing further was changed.")
        tmp = path.with_name(path.name + ".enc-tmp")
        tmp.write_bytes(blob)
        os.replace(tmp, path)
        changed += 1
    return changed


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if argv != ["encrypt-existing"]:
        print(__doc__)
        return 2
    import local_secrets
    local_secrets.load_into_environ()
    root = Path(os.environ.get("STORAGE_DIR", str(Path(__file__).parent / "storage")))
    print(f"Encrypted {encrypt_tree(root)} file(s) in {root}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
