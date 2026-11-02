"""The one-time-code algorithm, checked against the published test vectors (RFC 6238, appendix B) rather than against itself,
plus the rules around it: a code is accepted once, only near the present, and recovery codes look and compare as they should."""
import base64

import pytest

import totp

# RFC 6238 uses the ASCII secret "12345678901234567890" with SHA-1; its 8-digit answers end in these 6 digits.
RFC_SECRET = base64.b32encode(b"12345678901234567890").decode().rstrip("=")
RFC_VECTORS = [(59, "287082"), (1111111109, "081804"), (1111111111, "050471"), (1234567890, "005924"), (2000000000, "279037"), (20000000000, "353130")]


@pytest.mark.parametrize("seconds,expected", RFC_VECTORS)
def test_the_codes_match_the_published_test_vectors(seconds, expected):
    assert totp.code_at(RFC_SECRET, seconds // 30) == expected


def test_a_code_is_accepted_near_the_present_and_not_far_from_it():
    now = 1_700_000_000
    step = now // 30
    assert totp.verify(RFC_SECRET, totp.code_at(RFC_SECRET, step), now=now) == step
    assert totp.verify(RFC_SECRET, totp.code_at(RFC_SECRET, step - 1), now=now) == step - 1, "one step of clock drift either way"
    assert totp.verify(RFC_SECRET, totp.code_at(RFC_SECRET, step + 1), now=now) == step + 1
    assert totp.verify(RFC_SECRET, totp.code_at(RFC_SECRET, step - 2), now=now) is None
    assert totp.verify(RFC_SECRET, totp.code_at(RFC_SECRET, step + 2), now=now) is None


def test_a_step_that_was_already_used_is_not_accepted_again():
    now = 1_700_000_000
    step = now // 30
    code = totp.code_at(RFC_SECRET, step)
    assert totp.verify(RFC_SECRET, code, now=now, last_step=step) is None
    assert totp.verify(RFC_SECRET, code, now=now, last_step=step - 1) == step


@pytest.mark.parametrize("junk", ["", "12345", "1234567", "abcdef", "12 456", None])
def test_anything_that_is_not_six_digits_is_refused_without_error(junk):
    assert totp.verify(RFC_SECRET, junk, now=1_700_000_000) is None


def test_a_new_secret_is_random_base32_of_the_standard_length():
    a, b = totp.new_secret(), totp.new_secret()
    assert a != b and len(a) == 32 and set(a) <= set("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
    base64.b32decode(a)  # decodes


def test_the_link_for_an_authenticator_app_names_the_account_and_the_secret_and_escapes_the_address():
    uri = totp.otpauth_uri(RFC_SECRET, "someone+tag@example.com", "Life Record")
    assert uri.startswith("otpauth://totp/Life%20Record:someone%2Btag%40example.com?")
    assert f"secret={RFC_SECRET}" in uri and "issuer=Life%20Record" in uri and "period=30" in uri and "digits=6" in uri


def test_the_secret_is_stored_encrypted_and_comes_back_exactly(monkeypatch):
    monkeypatch.setenv("UPLOAD_ENCRYPTION_KEY", "ZmFrZWZha2VmYWtlZmFrZWZha2VmYWtlZmFrZWZha2U=")
    stored = totp.encrypt_secret(RFC_SECRET)
    assert RFC_SECRET not in stored and totp.decrypt_secret(stored) == RFC_SECRET


def test_without_the_server_key_nothing_is_stored_in_the_clear(monkeypatch):
    monkeypatch.delenv("UPLOAD_ENCRYPTION_KEY", raising=False)
    with pytest.raises(totp.TotpUnavailable):
        totp.encrypt_secret(RFC_SECRET)


def test_recovery_codes_are_distinct_easy_to_read_out_and_compared_without_regard_to_spacing_or_case(monkeypatch):
    monkeypatch.setenv("UPLOAD_ENCRYPTION_KEY", "ZmFrZWZha2VmYWtlZmFrZWZha2VmYWtlZmFrZWZha2U=")
    codes = totp.new_recovery_codes()
    assert len(codes) == 8 and len(set(codes)) == 8
    assert all(len(c) == 11 and c[5] == "-" for c in codes), codes
    code = codes[0]
    stored = totp.recovery_hash("user-1", code)
    assert stored == totp.recovery_hash("user-1", code.upper().replace("-", " ")) and code not in stored
    assert stored != totp.recovery_hash("user-2", code), "a stored hash belongs to one account"
