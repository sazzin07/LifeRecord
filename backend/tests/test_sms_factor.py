"""Text-message codes as a second step at sign-in.

The scratch server really posts its messages (over HTTP, with Twilio's request shape and basic auth) to tests/fake_twilio.py, so
each test reads the code the way a phone would receive it. Checked: numbers are read the way people write them and kept encrypted
and masked; a code works once, expires, and gets five tries; sending is spaced and capped (a flood is money); a provider that
fails leaves nothing half-done; and the method sits correctly beside the others.
"""
import asyncio
import hashlib
import logging
import threading

import pytest

import fake_twilio
import sms_service
from support_two_factor import (add_sms, add_totp, flags, get, last_code, let_resend_through, login_challenge, new_phone, post, sql, texts_to)
from support_users import PASSWORD, create_verified_user


def _user():
    return create_verified_user("authtest")


# -- reading numbers and talking to the provider (in this process, against the stand-in) ----------------------------------------

@pytest.mark.parametrize("typed,expected", [
    ("+351 912 345 678", "+351912345678"), ("+351-912-345-678", "+351912345678"), ("00351 912 345 678", "+351912345678"),
    ("+1 (415) 555-0132", "+14155550132"), (" +44 20 7946 0958 ", "+442079460958"),
])
def test_numbers_are_read_the_way_people_write_them(typed, expected):
    assert sms_service.normalise_phone(typed) == expected


@pytest.mark.parametrize("typed", ["", "912345678", "+", "+0123456789", "+351 91", "+3519123456789012345", "+351 abc 123 456", "351912345678", None])
def test_a_number_without_a_country_code_or_with_junk_is_not_guessed_at(typed):
    assert sms_service.normalise_phone(typed) is None


def test_the_hint_shows_only_the_last_three_digits():
    assert sms_service.hint_for("+351912345678") == "+•• ••• ••• 678"


@pytest.fixture
def provider(monkeypatch):
    stand_in, base = fake_twilio.start()
    for name, value in {"SMS_PROVIDER": "twilio", "TWILIO_ACCOUNT_SID": fake_twilio.SID, "TWILIO_AUTH_TOKEN": fake_twilio.TOKEN,
                        "TWILIO_FROM": "+15005550006", "TWILIO_API_BASE": base}.items():
        monkeypatch.setenv(name, value)
    yield base
    stand_in.shutdown()


def test_a_message_goes_out_in_twilios_shape_and_failures_are_told_in_words_without_the_number(provider, monkeypatch, caplog):
    phone = new_phone()
    asyncio.run(sms_service.send(phone, "123456 is your code"))
    assert texts_to_base(provider, phone) == [{"to": phone, "from": "+15005550006", "body": "123456 is your code"}]
    caplog.set_level(logging.DEBUG)
    with pytest.raises(sms_service.SmsError) as bad:
        asyncio.run(sms_service.send(fake_twilio.INVALID_NUMBER, "x"))
    assert str(bad.value) == sms_service.BAD_NUMBER
    down = "+35191234" + "0000"
    with pytest.raises(sms_service.SmsError) as unavailable:
        asyncio.run(sms_service.send(down, "x"))
    assert str(unavailable.value) == sms_service.SEND_FAILED
    monkeypatch.setenv("TWILIO_API_BASE", "http://127.0.0.1:9")
    with pytest.raises(sms_service.SmsError) as unreachable:
        asyncio.run(sms_service.send(phone, "x"))
    assert str(unreachable.value) == sms_service.SEND_FAILED
    monkeypatch.setenv("TWILIO_AUTH_TOKEN", "wrong")
    monkeypatch.setenv("TWILIO_API_BASE", provider)
    with pytest.raises(sms_service.SmsError):
        asyncio.run(sms_service.send(phone, "x"))
    assert phone[-8:] not in caplog.text and fake_twilio.INVALID_NUMBER[-8:] not in caplog.text, "a phone number is never logged"


def texts_to_base(base, phone):
    import requests
    return requests.get(f"{base}/_messages", params={"to": phone}, timeout=10).json()


def test_it_is_unavailable_without_a_provider(monkeypatch):
    monkeypatch.setenv("SMS_PROVIDER", "")
    assert sms_service.available() is False
    monkeypatch.setenv("SMS_PROVIDER", "twilio")
    for missing in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"):
        monkeypatch.setenv("TWILIO_ACCOUNT_SID", "AC1")
        monkeypatch.setenv("TWILIO_AUTH_TOKEN", "t")
        monkeypatch.setenv("TWILIO_FROM", "+1")
        monkeypatch.setenv(missing, "")
        assert sms_service.available() is False


# -- setting it up --------------------------------------------------------------------------------------------------------------

def test_setting_up_needs_the_password_and_a_usable_number():
    user = _user()
    phone = new_phone()
    assert post("/auth/2fa/sms/start", {"password": "Not-my-password-1", "phone": phone}, token=user["token"]).status_code == 400
    for junk in ("912345678", "hello", "+12"):
        r = post("/auth/2fa/sms/start", {"password": PASSWORD, "phone": junk}, token=user["token"])
        assert r.status_code == 400 and "country code" in r.json()["detail"], junk
    assert texts_to(phone) == []
    assert post("/auth/2fa/sms/start", {"password": PASSWORD, "phone": phone}).status_code in (401, 403)


def test_the_code_arrives_by_text_and_confirms_it_with_recovery_codes_and_the_number_stays_masked_and_encrypted():
    user = _user()
    phone = new_phone()
    started = post("/auth/2fa/sms/start", {"password": PASSWORD, "phone": phone}, token=user["token"])
    assert started.status_code == 200 and started.json()["hint"] == sms_service.hint_for(phone) and started.json()["resend_in"] == 60
    assert phone not in started.text
    assert flags(user["token"]) == {"enabled": False, "recovery_codes_left": 0}, "not on until a code from the phone is typed in"
    assert post("/auth/2fa/sms/confirm", {"code": "000000" if last_code(phone) != "000000" else "000001"}, token=user["token"]).status_code == 400
    done = post("/auth/2fa/sms/confirm", {"code": last_code(phone)}, token=user["token"])
    assert done.status_code == 200 and len(done.json()["recovery_codes"]) == 8
    status = get("/auth/2fa", user["token"])
    assert status.json()["methods"] == ["sms"] and status.json()["sms"] == {"enabled": True, "hint": sms_service.hint_for(phone), "available": True}
    assert phone not in status.text and phone[1:] not in status.text
    stored = sql("SELECT phone_enc, phone_hint FROM sms_factors WHERE user_id=%s", (user["id"],))[0]
    assert phone[4:] not in stored[0], "the number is not stored in the clear"
    assert "(" not in "".join(r[0] for r in sql("SELECT code_hash FROM sms_codes WHERE user_id=%s", (user["id"],))), "no code is kept after it is spent"
    assert post("/auth/2fa/sms/confirm", {"code": "123456"}, token=user["token"]).status_code == 400


def test_the_message_names_the_app_and_says_when_it_expires_and_not_to_share_it():
    user = _user()
    phone = new_phone()
    post("/auth/2fa/sms/start", {"password": PASSWORD, "phone": phone}, token=user["token"])
    body = texts_to(phone)[0]["body"]
    assert "Life Record" in body and "5 minutes" in body and "Never share" in body and last_code(phone) in body


def test_a_number_the_provider_refuses_is_said_so_and_nothing_is_left_half_set_up():
    user = _user()
    bad = post("/auth/2fa/sms/start", {"password": PASSWORD, "phone": fake_twilio.INVALID_NUMBER}, token=user["token"])
    assert bad.status_code == 400 and "country code" in bad.json()["detail"]
    down = post("/auth/2fa/sms/start", {"password": PASSWORD, "phone": "+35191234" + "0000"}, token=user["token"])
    assert down.status_code == 503 and "could not be sent" in down.json()["detail"]
    assert sql("SELECT COUNT(*) FROM sms_factors WHERE user_id=%s", (user["id"],))[0][0] == 0
    assert sql("SELECT COUNT(*) FROM sms_codes WHERE user_id=%s", (user["id"],))[0][0] == 0, "a code that was never sent is not kept"
    assert post("/auth/2fa/sms/start", {"password": PASSWORD, "phone": new_phone()}, token=user["token"]).status_code == 200, "and the person can simply try again"


def test_a_code_works_once_expires_and_gets_five_tries():
    user = _user()
    phone = new_phone()
    post("/auth/2fa/sms/start", {"password": PASSWORD, "phone": phone}, token=user["token"])
    right = last_code(phone)
    wrong = "000000" if right != "000000" else "000001"
    for _ in range(5):
        assert post("/auth/2fa/sms/confirm", {"code": wrong}, token=user["token"]).status_code == 400
    assert post("/auth/2fa/sms/confirm", {"code": right}, token=user["token"]).status_code == 400, "five wrong tries use the code up, even the right one"
    let_resend_through(user)
    assert post("/auth/2fa/sms/resend", {}, token=user["token"]).status_code == 200
    fresh = last_code(phone)
    sql("UPDATE sms_codes SET expires_ms = expires_ms - 600000 WHERE user_id=%s", (user["id"],))
    assert post("/auth/2fa/sms/confirm", {"code": fresh}, token=user["token"]).status_code == 400, "five minutes is all a code lives"
    let_resend_through(user)
    assert post("/auth/2fa/sms/resend", {}, token=user["token"]).status_code == 200
    assert post("/auth/2fa/sms/confirm", {"code": last_code(phone)}, token=user["token"]).status_code == 200


def test_sending_is_spaced_a_new_code_replaces_the_old_and_an_hour_allows_five():
    user = _user()
    phone = new_phone()
    post("/auth/2fa/sms/start", {"password": PASSWORD, "phone": phone}, token=user["token"])
    first = last_code(phone)
    soon = post("/auth/2fa/sms/resend", {}, token=user["token"])
    assert soon.status_code == 429 and "seconds" in soon.json()["detail"] and int(soon.headers["Retry-After"]) > 0
    assert len(texts_to(phone)) == 1, "a refused resend sends nothing"
    for _ in range(4):
        let_resend_through(user)
        assert post("/auth/2fa/sms/resend", {}, token=user["token"]).status_code == 200
    let_resend_through(user)
    over = post("/auth/2fa/sms/resend", {}, token=user["token"])
    assert over.status_code == 429 and "Too many text messages" in over.json()["detail"], "the sixth message inside an hour is refused"
    assert len(texts_to(phone)) == 5
    newest = last_code(phone)
    if newest != first:  # (a new code could, one time in a million, equal the old one)
        assert post("/auth/2fa/sms/confirm", {"code": first}, token=user["token"]).status_code == 400, "the earlier code stopped working"
    assert post("/auth/2fa/sms/confirm", {"code": newest}, token=user["token"]).status_code == 200


def test_the_whole_server_has_a_cap_too():
    user = _user()
    bucket = hashlib.sha256(b"global-sms-send").hexdigest()
    now = int(__import__("time").time() * 1000)
    conn = __import__("support_db").connect()
    try:
        with conn.cursor() as cur:
            cur.executemany("INSERT INTO rate_limit_events (bucket, at_ms) VALUES (%s, %s)", [(bucket, now)] * 1005)
        conn.commit()
        refused = post("/auth/2fa/sms/start", {"password": PASSWORD, "phone": new_phone()}, token=user["token"])
        assert refused.status_code == 503 and "Too many text messages" in refused.json()["detail"]
    finally:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM rate_limit_events WHERE bucket=%s", (bucket,))
        conn.commit()
        conn.close()
    assert post("/auth/2fa/sms/start", {"password": PASSWORD, "phone": new_phone()}, token=user["token"]).status_code == 200


# -- signing in -----------------------------------------------------------------------------------------------------------------

def test_password_then_a_texted_code_signs_in_and_the_code_works_once():
    user = _user()
    phone, _ = add_sms(user)
    first = login_challenge(user)
    assert first["methods"] == ["sms"] and first["sms_hint"] == sms_service.hint_for(phone) and "token" not in first and phone not in str(first)
    sent = post("/auth/login/sms/send", {"challenge": first["challenge"]})
    assert sent.status_code == 200 and sent.json()["resend_in"] == 60
    code = last_code(phone)
    assert post("/auth/login/sms", {"challenge": first["challenge"], "code": "000000" if code != "000000" else "000001"}).status_code == 401
    signed = post("/auth/login/sms", {"challenge": first["challenge"], "code": code})
    assert signed.status_code == 200 and get("/auth/me", signed.json()["token"]).status_code == 200
    assert post("/auth/login/sms", {"challenge": first["challenge"], "code": code}).status_code == 401, "the code was spent"


def test_the_authenticator_endpoint_does_not_accept_a_texted_code_and_nobody_else_can_use_it():
    a, b = _user(), _user()
    phone_a, _ = add_sms(a)
    phone_b, _ = add_sms(b)
    challenge_a = login_challenge(a)["challenge"]
    post("/auth/login/sms/send", {"challenge": challenge_a})
    code_a = last_code(phone_a)
    assert post("/auth/login/totp", {"challenge": challenge_a, "code": code_a}).status_code == 401
    challenge_b = login_challenge(b)["challenge"]
    assert post("/auth/login/sms", {"challenge": challenge_b, "code": code_a}).status_code == 401, "A's code means nothing for B"
    assert post("/auth/login/sms", {"challenge": challenge_a, "code": code_a}).status_code == 200
    assert post("/auth/login/sms/send", {"challenge": "junk"}).status_code == 401


def test_two_requests_with_the_same_right_code_let_only_one_in():
    user = _user()
    phone, _ = add_sms(user)
    challenge = login_challenge(user)["challenge"]
    post("/auth/login/sms/send", {"challenge": challenge})
    code = last_code(phone)
    results = []
    threads = [threading.Thread(target=lambda: results.append(post("/auth/login/sms", {"challenge": challenge, "code": code}).status_code)) for _ in range(5)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(results) == [200, 401, 401, 401, 401], results


def test_guessing_texted_codes_is_limited_per_account():
    user = _user()
    add_sms(user)
    challenge = login_challenge(user)["challenge"]
    post("/auth/login/sms/send", {"challenge": challenge})
    statuses = [post("/auth/login/sms", {"challenge": challenge, "code": f"{n:06d}"}, ip=f"10.6.{n}.1").status_code for n in range(14)]
    assert statuses[:5] == [401] * 5 and 429 in statuses, statuses


# -- beside the other methods and changing it -------------------------------------------------------------------------------------

def test_with_two_step_on_text_messages_can_only_be_added_with_a_proof_and_then_stand_beside_the_app():
    import totp
    from support_two_factor import forget_used_steps, step
    user = _user()
    secret, codes = add_totp(user)
    phone = new_phone()
    assert post("/auth/2fa/sms/start", {"password": PASSWORD, "phone": phone}, token=user["token"]).status_code == 400
    assert texts_to(phone) == []
    forget_used_steps(user)
    assert post("/auth/2fa/sms/start", {"password": PASSWORD, "phone": phone, "code": totp.code_at(secret, step())}, token=user["token"]).status_code == 200
    done = post("/auth/2fa/sms/confirm", {"code": last_code(phone)}, token=user["token"])
    assert done.status_code == 200 and done.json()["recovery_codes"] == []
    assert login_challenge(user)["methods"] == ["totp", "sms"]


def test_removing_text_messages_needs_the_password_and_a_proof_which_a_texted_code_can_be_and_the_last_method_turns_it_off():
    user = _user()
    phone, _ = add_sms(user)
    assert post("/auth/2fa/sms/remove", {"password": PASSWORD}, token=user["token"]).status_code == 400, "no proof"
    let_resend_through(user)
    sent = post("/auth/2fa/proof/sms-send", {}, token=user["token"])
    assert sent.status_code == 200 and sent.json()["hint"] == sms_service.hint_for(phone)
    code = last_code(phone)
    assert post("/auth/2fa/sms/remove", {"password": "Not-my-password-1", "code": code}, token=user["token"]).status_code == 400
    assert flags(user["token"])["enabled"] is True
    assert post("/auth/2fa/sms/remove", {"password": PASSWORD, "code": code}, token=user["token"]).status_code == 200
    assert flags(user["token"]) == {"enabled": False, "recovery_codes_left": 0}
    assert sql("SELECT COUNT(*) FROM sms_factors WHERE user_id=%s", (user["id"],))[0][0] == 0
    assert post("/auth/login", {"email": user["email"], "password": PASSWORD}).json().get("requires_totp") is None


def test_no_text_can_be_asked_for_by_someone_without_it_set_up():
    user = _user()
    assert post("/auth/2fa/proof/sms-send", {}, token=user["token"]).status_code == 400
    assert post("/auth/2fa/sms/resend", {}, token=user["token"]).status_code == 400
    assert post("/auth/2fa/sms/remove", {"password": PASSWORD}, token=user["token"]).status_code == 400


def test_a_second_number_cannot_be_started_while_one_is_confirmed():
    user = _user()
    _, recovery = add_sms(user)
    phone2 = new_phone()
    r = post("/auth/2fa/sms/start", {"password": PASSWORD, "phone": phone2, "code": recovery[0]}, token=user["token"])
    assert r.status_code == 400 and "already on" in r.json()["detail"]
    assert texts_to(phone2) == []


# -- Twilio Verify: the provider makes, sends and checks the code ---------------------------------------------------------------

def test_verify_mode_sends_and_checks_through_the_provider(provider, monkeypatch):
    import sms_codes
    monkeypatch.setenv("TWILIO_VERIFY_SERVICE_SID", "VA" + "1" * 32)
    monkeypatch.delenv("TWILIO_FROM", raising=False)
    assert sms_service.verify_mode() and sms_service.available()
    phone = new_phone()
    asyncio.run(sms_service.start_verification(phone))
    code = texts_to_base(provider, phone)[-1]["body"].split()[-1]
    assert asyncio.run(sms_service.check_verification(phone, "000000")) is False
    assert asyncio.run(sms_service.check_verification(phone, code)) is True
    assert asyncio.run(sms_service.check_verification(phone, code)) is False, "a code works once"
    with pytest.raises(sms_service.SmsError) as bad:
        asyncio.run(sms_service.start_verification(fake_twilio.INVALID_NUMBER))
    assert str(bad.value) == sms_service.BAD_NUMBER
    assert sms_codes.RESEND_GAP_SECONDS == 60
