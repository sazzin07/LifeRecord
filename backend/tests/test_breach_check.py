"""Refusing passwords that have appeared in known data breaches, by the k-anonymity method (the "range" API of Have I Been Pwned).

Only the first FIVE characters of the password's SHA-1 are ever sent; the service answers with every hash suffix that starts that
way and the match is made here, so neither the password nor its full hash leaves the server. It is OFF unless
PASSWORD_BREACH_CHECK=1 (it is a call to a third party, which is the owner's decision), and it fails OPEN: if the service cannot be
reached nobody is stopped from choosing a password. Nothing here touches the network: the call is replaced by a fake.
"""
import asyncio
import hashlib
import uuid

import httpx
import pytest

import breach_check
import server


def _sha1(password):
    return hashlib.sha1(password.encode()).hexdigest().upper()


def _range_body(password, count=12345, extra=("00000000000000000000000000000000000:5", "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:0")):
    return "\r\n".join([*extra, f"{_sha1(password)[5:]}:{count}"])


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv("PASSWORD_BREACH_CHECK", "1")
    monkeypatch.delenv("PASSWORD_BREACH_MIN_COUNT", raising=False)


def _fake(monkeypatch, body=None, error=None):
    asked = []

    async def fetch(prefix):
        asked.append(prefix)
        if error:
            raise error
        return body
    monkeypatch.setattr(breach_check, "_fetch_range", fetch)
    return asked


def test_a_password_in_the_answer_is_breached_and_only_five_characters_were_asked_for(on, monkeypatch):
    password = "Tr0ub4dor&3-x"
    asked = _fake(monkeypatch, _range_body(password))
    assert asyncio.run(breach_check.is_breached(password)) is True
    assert asked == [_sha1(password)[:5]], "exactly the five-character prefix, nothing more"
    assert password not in "".join(asked) and _sha1(password)[5:] not in "".join(asked)


def test_a_password_that_is_not_in_the_answer_is_fine(on, monkeypatch):
    _fake(monkeypatch, _range_body("some-other-password-1", count=9))
    assert asyncio.run(breach_check.is_breached("A-never-seen-passphrase-82")) is False


def test_padding_entries_with_a_count_of_zero_are_not_matches(on, monkeypatch):
    password = "Padding-only-entry-5"
    _fake(monkeypatch, _range_body(password, count=0))
    assert asyncio.run(breach_check.is_breached(password)) is False


def test_the_threshold_can_be_raised(on, monkeypatch):
    monkeypatch.setenv("PASSWORD_BREACH_MIN_COUNT", "100")
    password = "Seen-a-few-times-7"
    _fake(monkeypatch, _range_body(password, count=40))
    assert asyncio.run(breach_check.is_breached(password)) is False
    _fake(monkeypatch, _range_body(password, count=400))
    assert asyncio.run(breach_check.is_breached(password)) is True


def test_it_is_off_unless_it_is_switched_on_and_then_asks_nobody(monkeypatch):
    monkeypatch.delenv("PASSWORD_BREACH_CHECK", raising=False)
    asked = _fake(monkeypatch, _range_body("anything-1x"))
    assert asyncio.run(breach_check.is_breached("anything-1x")) is None and asked == []


@pytest.mark.parametrize("error", [httpx.ConnectError("no route"), httpx.ReadTimeout("slow"), RuntimeError("boom")])
def test_when_the_service_cannot_be_reached_nobody_is_stopped(on, monkeypatch, error):
    _fake(monkeypatch, error=error)
    assert asyncio.run(breach_check.is_breached("Whatever-pass-12")) is None


def test_a_garbled_answer_is_not_a_reason_to_refuse(on, monkeypatch):
    _fake(monkeypatch, "<html>502 Bad Gateway</html>")
    assert asyncio.run(breach_check.is_breached("Whatever-pass-12")) is False


# -- wired into every place a password is chosen ---------------------------------------------------------------------------

def _call(method, path, **kwargs):
    async def go():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://testserver") as client:
            return await client.request(method, path, **kwargs)
    return asyncio.run(go())


def test_sign_up_refuses_a_breached_password_with_the_reason(on, monkeypatch):
    password = "Hunter2-but-longer-9"
    _fake(monkeypatch, _range_body(password))
    r = _call("POST", "/api/auth/register", json={"email": f"authtest_{uuid.uuid4().hex[:8]}@example.com", "password": password, "name": "x"})
    assert r.status_code == 400 and "data breaches" in r.json()["detail"], r.text


def test_sign_up_still_works_when_the_service_is_down(on, monkeypatch):
    _fake(monkeypatch, error=httpx.ConnectError("offline"))
    r = _call("POST", "/api/auth/register", json={"email": f"authtest_{uuid.uuid4().hex[:8]}@example.com", "password": "Fine-passphrase-31", "name": "x"})
    assert r.status_code == 200, r.text


def test_changing_the_password_and_using_a_reset_link_refuse_a_breached_password_too(on, monkeypatch):
    import support_db
    from support_users import PASSWORD, create_verified_user
    user = create_verified_user("authtest")
    password = "Leaked-in-2019-xq7"
    _fake(monkeypatch, _range_body(password))
    changed = _call("POST", "/api/auth/change-password", json={"current_password": PASSWORD, "new_password": password},
                    headers={"Authorization": f"Bearer {user['token']}"})
    assert changed.status_code == 400 and "data breaches" in changed.json()["detail"], changed.text
    link = support_db.issue_reset_token(user["email"])
    reset = _call("POST", "/api/auth/reset-password", json={"token": link, "password": password})
    assert reset.status_code == 400 and "data breaches" in reset.json()["detail"], reset.text
    _fake(monkeypatch, _range_body("someone-elses-password-3"))
    assert _call("POST", "/api/auth/reset-password", json={"token": link, "password": password}).status_code == 200, \
        "a refused password must not use up the link"
