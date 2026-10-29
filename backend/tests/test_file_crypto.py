"""Uploaded files (progress photos, chat pictures) are encrypted at rest."""
import os
import sys
import uuid
from pathlib import Path

import pytest
import requests
from cryptography.fernet import Fernet

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import file_crypto as fc  # noqa: E402
from support_auth import BASE_URL, session  # noqa: E402

PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0f01f0005000201"
    "a5f645400000000049454e44ae426082")


@pytest.fixture
def key(monkeypatch):
    k = Fernet.generate_key().decode()
    monkeypatch.setenv("UPLOAD_ENCRYPTION_KEY", k)
    return k


def test_round_trip_and_the_blob_does_not_contain_the_picture(key):
    blob = fc.encrypt(PNG)
    assert blob.startswith(fc.MAGIC) and PNG not in blob and b"PNG" not in blob
    assert fc.decrypt(blob) == PNG


def test_each_encryption_is_different(key):
    assert fc.encrypt(PNG) != fc.encrypt(PNG)


def test_a_tampered_file_is_an_error_not_garbage(key):
    blob = bytearray(fc.encrypt(PNG))
    blob[-3] ^= 0x01
    with pytest.raises(fc.FileCryptoError):
        fc.decrypt(bytes(blob))


def test_the_wrong_key_cannot_read_it(key, monkeypatch):
    blob = fc.encrypt(PNG)
    monkeypatch.setenv("UPLOAD_ENCRYPTION_KEY", Fernet.generate_key().decode())
    with pytest.raises(fc.FileCryptoError):
        fc.decrypt(blob)


def test_files_written_before_encryption_existed_still_read(key):
    assert fc.decrypt(PNG) == PNG  # no magic header = legacy plaintext


def test_an_encrypted_file_without_a_key_is_a_clear_error(key, monkeypatch):
    blob = fc.encrypt(PNG)
    monkeypatch.delenv("UPLOAD_ENCRYPTION_KEY")
    with pytest.raises(fc.FileCryptoError, match="UPLOAD_ENCRYPTION_KEY"):
        fc.decrypt(blob)


def test_without_a_key_new_files_are_stored_as_they_are(monkeypatch):
    monkeypatch.delenv("UPLOAD_ENCRYPTION_KEY", raising=False)
    assert fc.encrypt(PNG) == PNG


def test_encrypt_tree_encrypts_plaintext_once_and_keeps_the_content(key, tmp_path):
    (tmp_path / "u1").mkdir()
    a, b = tmp_path / "u1" / "a.png", tmp_path / "b.png"
    a.write_bytes(PNG)
    b.write_bytes(fc.encrypt(PNG))  # already encrypted
    before = b.read_bytes()
    assert fc.encrypt_tree(tmp_path) == 1
    assert a.read_bytes().startswith(fc.MAGIC) and fc.decrypt(a.read_bytes()) == PNG
    assert b.read_bytes() == before
    assert fc.encrypt_tree(tmp_path) == 0  # idempotent


def test_a_photo_is_stored_encrypted_and_served_decrypted():
    if not os.environ.get("UPLOAD_ENCRYPTION_KEY"):
        pytest.skip("no UPLOAD_ENCRYPTION_KEY in the environment/store")
    s = session()
    r = s.post(f"{BASE_URL}/api/photos", params={"note": f"TEST_{uuid.uuid4().hex[:6]}"}, files={"file": ("t.png", PNG, "image/png")})
    assert r.status_code == 200, r.text
    p = r.json()
    try:
        storage = Path(os.environ.get("STORAGE_DIR", Path(__file__).resolve().parents[1] / "storage"))
        on_disk = (storage / p["storage_path"]).read_bytes()
        assert on_disk.startswith(fc.MAGIC) and PNG not in on_disk
        served = s.get(f"{BASE_URL}{p['url']}")
        assert served.status_code == 200 and served.content == PNG
        assert served.headers["content-type"].startswith("image/")
    finally:
        s.delete(f"{BASE_URL}/api/photos/{p['id']}")
