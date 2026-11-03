"""How the three second-step methods (authenticator app, passkeys, text messages) behave as ONE protection: recovery codes that work
whichever method is on, proofs of any kind for any change, a password reset that still asks for the second step, the owner's way
out, and what happens to all of it when the account is deleted."""
import requests

import owner_admin
import support_db
from support_auth import BASE_URL
from support_two_factor import (ORIGIN, add_passkey, add_sms, add_totp, flags, forget_used_steps, get, last_code, let_resend_through, login_challenge, new_key,
                                new_phone, passkey_proof, post, sql)
from support_users import PASSWORD, create_verified_user

PHRASE = "DELETE MY ACCOUNT"


def _user():
    return create_verified_user("authtest")


def _owner_main(*args):
    return owner_admin.main(list(args))


def test_a_recovery_code_signs_in_whichever_method_is_on_and_works_once():
    for turn_on in (lambda u: add_passkey(u)[1], lambda u: add_sms(u)[1]):
        user = _user()
        codes = turn_on(user)
        first = login_challenge(user)["challenge"]
        assert post("/auth/login/totp", {"challenge": first, "code": codes[0]}).status_code == 200
        assert post("/auth/login/totp", {"challenge": first, "code": codes[0]}).status_code == 401, "each works once"
        assert post("/auth/login/totp", {"challenge": first, "code": "aaaaa-bbbbb"}).status_code == 401
        assert flags(user["token"]) == {"enabled": True, "recovery_codes_left": 7}


def test_new_recovery_codes_need_a_proof_and_the_old_ones_stop_working():
    user = _user()
    key, old = add_passkey(user)
    assert post("/auth/2fa/recovery-codes", {"password": PASSWORD}, token=user["token"]).status_code == 400
    assert post("/auth/2fa/recovery-codes", {"password": PASSWORD, "code": "aaaaa-bbbbb"}, token=user["token"]).status_code == 400
    fresh = post("/auth/2fa/recovery-codes", {"password": PASSWORD, **passkey_proof(user, key)}, token=user["token"])
    assert fresh.status_code == 200 and len(fresh.json()["recovery_codes"]) == 8
    challenge = login_challenge(user)["challenge"]
    assert post("/auth/login/totp", {"challenge": challenge, "code": old[0]}).status_code == 401
    assert post("/auth/login/totp", {"challenge": challenge, "code": fresh.json()["recovery_codes"][0]}).status_code == 200


def test_any_kind_of_proof_opens_a_change_and_a_proof_is_not_a_password():
    user = _user()
    secret, recovery = add_totp(user)
    phone = new_phone()
    forget_used_steps(user)
    assert post("/auth/2fa/sms/start", {"password": PASSWORD, "phone": phone, "code": recovery[0]}, token=user["token"]).status_code == 200, "a recovery code is a proof"
    assert post("/auth/2fa/sms/confirm", {"code": last_code(phone)}, token=user["token"]).status_code == 200
    let_resend_through(user)
    key = new_key()
    assert post("/auth/2fa/proof/sms-send", {}, token=user["token"]).status_code == 200
    opts = post("/auth/2fa/passkeys/options", {"password": PASSWORD, "code": last_code(phone)}, token=user["token"], origin=ORIGIN)
    assert opts.status_code == 200, "a texted code is a proof"
    assert post("/auth/2fa/passkeys", {"challenge_id": opts.json()["challenge_id"], "credential": key.create(opts.json()["options"]), "name": "k"},
                token=user["token"], origin=ORIGIN).status_code == 200
    assert login_challenge(user)["methods"] == ["passkey", "totp", "sms"]
    assert post("/auth/2fa/disable", {"password": "Not-my-password-1", **passkey_proof(user, key)}, token=user["token"]).status_code == 400
    assert get("/auth/2fa", user["token"]).json()["enabled"] is True
    assert post("/auth/2fa/disable", {"password": PASSWORD, **passkey_proof(user, key)}, token=user["token"]).status_code == 200, "a passkey is a proof"
    assert flags(user["token"]) == {"enabled": False, "recovery_codes_left": 0}
    for table in ("totp_credentials", "webauthn_credentials", "sms_factors", "sms_codes", "totp_recovery_codes"):
        assert sql(f"SELECT COUNT(*) FROM {table} WHERE user_id=%s", (user["id"],))[0][0] == 0, table


def test_a_stolen_session_with_the_password_cannot_add_a_method_of_its_own():
    user = _user()
    add_totp(user)
    for code in ("", "123456", "aaaaa-bbbbb"):
        body = {"password": PASSWORD, **({"code": code} if code else {})}
        opts = post("/auth/2fa/passkeys/options", body, token=user["token"], origin=ORIGIN)
        assert opts.status_code == 400, code
    assert post("/auth/2fa/sms/start", {"password": PASSWORD, "phone": new_phone()}, token=user["token"]).status_code == 400
    assert get("/auth/2fa", user["token"]).json()["methods"] == ["totp"]


def test_guessing_proofs_from_a_session_is_limited_per_account():
    user = _user()
    add_totp(user)
    statuses = [post("/auth/2fa/recovery-codes", {"password": PASSWORD, "code": f"{n:06d}"}, token=user["token"], ip=f"10.5.{n}.1").status_code
                for n in range(14)]
    assert 429 in statuses and statuses[:3] == [400] * 3, statuses


def test_a_reset_link_still_asks_for_the_second_step_whichever_method_it_is():
    for turn_on in (lambda u: add_passkey(u), lambda u: add_sms(u)):
        user = _user()
        turn_on(user)
        link = support_db.issue_reset_token(user["email"])
        answer = post("/auth/reset-password", {"token": link, "password": "Brand-new-pass-4"})
        assert answer.status_code == 200 and answer.json().get("requires_totp") is True and "token" not in answer.json()
        assert answer.json()["methods"] in (["passkey"], ["sms"]) and answer.json()["message"]


def test_the_owners_command_line_way_out_removes_every_method():
    with_passkey, with_app, with_phone = _user(), _user(), _user()
    add_passkey(with_passkey)
    add_totp(with_app)
    add_sms(with_phone)
    for u in (with_passkey, with_app, with_phone):
        assert flags(u["token"])["enabled"] is True
        assert _owner_main("disable-2fa", u["email"]) == 0
        assert flags(u["token"]) == {"enabled": False, "recovery_codes_left": 0}
        for table in ("webauthn_credentials", "totp_credentials", "sms_factors", "totp_recovery_codes"):
            assert sql(f"SELECT COUNT(*) FROM {table} WHERE user_id=%s", (u["id"],))[0][0] == 0, table


def test_deleting_the_account_takes_every_second_step_row_with_it():
    user = _user()
    key, _ = add_passkey(user)
    phone = new_phone()
    assert post("/auth/2fa/sms/start", {"password": PASSWORD, "phone": phone, **passkey_proof(user, key)}, token=user["token"]).status_code == 200
    assert post("/auth/2fa/sms/confirm", {"code": last_code(phone)}, token=user["token"]).status_code == 200
    gone = requests.delete(f"{BASE_URL}/api/account", json={"password": PASSWORD, "confirm": PHRASE},
                           headers={"Authorization": f"Bearer {user['token']}"}, timeout=60)
    assert gone.status_code == 200, gone.text
    for table in ("webauthn_credentials", "webauthn_challenges", "sms_factors", "sms_codes", "totp_recovery_codes"):
        assert sql(f"SELECT COUNT(*) FROM {table} WHERE user_id=%s", (user["id"],))[0][0] == 0, table


def test_the_export_never_includes_second_step_secrets():
    user = _user()
    key, _ = add_passkey(user)
    phone = new_phone()
    assert post("/auth/2fa/sms/start", {"password": PASSWORD, "phone": phone, **passkey_proof(user, key)}, token=user["token"]).status_code == 200
    assert post("/auth/2fa/sms/confirm", {"code": last_code(phone)}, token=user["token"]).status_code == 200
    export = requests.get(f"{BASE_URL}/api/account/export", headers={"Authorization": f"Bearer {user['token']}"}, timeout=60)
    assert export.status_code == 200
    text = export.text
    for table in ("webauthn_credentials", "sms_factors", "sms_codes", "totp_recovery_codes", "webauthn_challenges", "phone_enc"):
        assert table not in text, table
    assert phone not in text and phone[4:] not in text
