"""Passkeys and security keys as a second step at sign-in, driven end to end against the real server with a software authenticator
that signs like a browser's would (tests/support_webauthn.py).

What is checked: they register and sign in; they are bound to this site's host and origin; every ceremony works once; a cloned
authenticator is noticed but a synced passkey (counter 0) is fine; one person's passkey does nothing for another; changing the
protection needs a proof; and removing the last method turns the second step off cleanly.
"""
import threading

import totp
from support_two_factor import (ORIGIN, RP_ID, add_passkey, add_totp, flags, forget_used_steps, get, login_challenge, new_key, passkey_login_answer,
                                passkey_proof, post, sign_in_with_passkey, sql, step)
from support_users import PASSWORD, create_verified_user


def _user():
    return create_verified_user("authtest")


# -- registering ------------------------------------------------------------------------------------------------------------

def test_registering_needs_the_password_and_offers_the_site_not_a_guess():
    user = _user()
    assert post("/auth/2fa/passkeys/options", {"password": "Not-my-password-1"}, token=user["token"], origin=ORIGIN).status_code == 400
    ok = post("/auth/2fa/passkeys/options", {"password": PASSWORD}, token=user["token"], origin=ORIGIN)
    assert ok.status_code == 200
    options = ok.json()["options"]
    assert options["rp"]["id"] == RP_ID and options["challenge"] and options["excludeCredentials"] == []
    assert options["user"]["name"] == user["email"] and user["id"] not in options["user"]["id"], "the handle is opaque, not the user id"
    assert post("/auth/2fa/passkeys/options", {"password": PASSWORD}, origin=ORIGIN).status_code in (401, 403), "needs a session"


def test_the_first_passkey_turns_the_second_step_on_and_hands_over_recovery_codes_once():
    user = _user()
    key, codes = add_passkey(user, name="Laptop")
    assert len(codes) == 8
    status = get("/auth/2fa", user["token"]).json()
    assert status["enabled"] is True and status["methods"] == ["passkey"] and status["recovery_codes_left"] == 8
    assert [p["name"] for p in status["passkeys"]] == ["Laptop"]
    assert "public_key" not in status["passkeys"][0] and "credential_id" not in status["passkeys"][0]
    # a second passkey adds a method but makes no new recovery codes (the person already holds them)
    opts = post("/auth/2fa/passkeys/options", {"password": PASSWORD, **passkey_proof(user, key)}, token=user["token"], origin=ORIGIN).json()
    done = post("/auth/2fa/passkeys", {"challenge_id": opts["challenge_id"], "credential": new_key().create(opts["options"]), "name": ""},
                token=user["token"], origin=ORIGIN)
    assert done.status_code == 200 and done.json()["recovery_codes"] == []
    assert done.json()["passkey"]["name"] == "Passkey 2", "unnamed passkeys get a name"
    assert flags(user["token"]) == {"enabled": True, "recovery_codes_left": 8}


def test_adding_a_passkey_while_two_step_is_on_needs_a_proof():
    user = _user()
    key, _ = add_passkey(user)
    assert post("/auth/2fa/passkeys/options", {"password": PASSWORD}, token=user["token"], origin=ORIGIN).status_code == 400
    assert post("/auth/2fa/passkeys/options", {"password": PASSWORD, "code": "123456"}, token=user["token"], origin=ORIGIN).status_code == 400
    assert post("/auth/2fa/passkeys/options", {"password": PASSWORD, **passkey_proof(user, key)}, token=user["token"], origin=ORIGIN).status_code == 200


def test_an_origin_the_server_does_not_trust_gets_no_options():
    user = _user()
    bad = post("/auth/2fa/passkeys/options", {"password": PASSWORD}, token=user["token"], origin="https://evil.example.org")
    assert bad.status_code == 400 and "address" in bad.json()["detail"]


def test_a_registration_made_for_another_site_or_origin_is_refused_and_stores_nothing():
    user = _user()
    for kwargs in ({"origin": "https://evil.example.org"}, {"rp_id": "evil.example.org"}):
        opts = post("/auth/2fa/passkeys/options", {"password": PASSWORD}, token=user["token"], origin=ORIGIN).json()
        done = post("/auth/2fa/passkeys", {"challenge_id": opts["challenge_id"], "credential": new_key().create(opts["options"], **kwargs), "name": "x"},
                    token=user["token"], origin=ORIGIN)
        assert done.status_code == 400, kwargs
    assert get("/auth/2fa", user["token"]).json()["passkeys"] == []


def test_a_registration_challenge_works_once_and_only_for_the_person_it_was_made_for():
    a, b = _user(), _user()
    opts = post("/auth/2fa/passkeys/options", {"password": PASSWORD}, token=a["token"], origin=ORIGIN).json()
    key = new_key()
    credential = key.create(opts["options"])
    body = {"challenge_id": opts["challenge_id"], "credential": credential, "name": "x"}
    assert post("/auth/2fa/passkeys", body, token=b["token"], origin=ORIGIN).status_code == 400
    opts = post("/auth/2fa/passkeys/options", {"password": PASSWORD}, token=a["token"], origin=ORIGIN).json()
    body = {"challenge_id": opts["challenge_id"], "credential": key.create(opts["options"]), "name": "a"}
    assert post("/auth/2fa/passkeys", body, token=a["token"], origin=ORIGIN).status_code == 200
    assert post("/auth/2fa/passkeys", body, token=a["token"], origin=ORIGIN).status_code == 400, "a challenge is spent by its first use"


def test_the_same_authenticator_cannot_be_registered_for_two_accounts_and_the_browser_is_told_to_skip_known_keys():
    a, b = _user(), _user()
    key, _ = add_passkey(a)
    opts = post("/auth/2fa/passkeys/options", {"password": PASSWORD}, token=b["token"], origin=ORIGIN).json()
    assert post("/auth/2fa/passkeys", {"challenge_id": opts["challenge_id"], "credential": key.create(opts["options"]), "name": "x"},
                token=b["token"], origin=ORIGIN).status_code == 400
    again = post("/auth/2fa/passkeys/options", {"password": PASSWORD, **passkey_proof(a, key)}, token=a["token"], origin=ORIGIN).json()
    assert len(again["options"]["excludeCredentials"]) == 1


# -- signing in ---------------------------------------------------------------------------------------------------------------

def test_a_correct_password_then_the_passkey_signs_in_and_the_password_alone_does_not():
    user = _user()
    key, _ = add_passkey(user)
    first = login_challenge(user)
    assert first["methods"] == ["passkey"] and "token" not in first
    signed = sign_in_with_passkey(user, key)
    assert signed.status_code == 200, signed.text
    assert get("/auth/me", signed.json()["token"]).status_code == 200
    assert post("/auth/login/totp", {"challenge": first["challenge"], "code": "123456"}).status_code == 401


def test_a_passkey_presented_from_another_origin_or_for_another_host_is_refused():
    user = _user()
    key, _ = add_passkey(user)
    challenge = login_challenge(user)["challenge"]
    for kwargs in ({"origin": "https://evil.example.org"}, {"rp_id": "evil.example.org"}):
        assert post("/auth/login/passkey", passkey_login_answer(challenge, key, **kwargs), origin=ORIGIN).status_code == 401, kwargs


def test_an_answer_cannot_be_replayed():
    user = _user()
    key, _ = add_passkey(user)
    answer = passkey_login_answer(login_challenge(user)["challenge"], key)
    assert post("/auth/login/passkey", answer, origin=ORIGIN).status_code == 200
    assert post("/auth/login/passkey", answer, origin=ORIGIN).status_code == 401, "a captured answer is worthless afterwards"


def test_a_challenge_made_for_signing_in_cannot_stand_in_for_a_proof():
    user = _user()
    key, _ = add_passkey(user)
    challenge = login_challenge(user)["challenge"]
    login_opts = post("/auth/login/passkey/options", {"challenge": challenge}, origin=ORIGIN).json()
    token = sign_in_with_passkey(user, key).json()["token"]
    borrowed = {"passkey": {"challenge_id": login_opts["challenge_id"], "credential": key.get(login_opts["options"])}}
    assert post("/auth/2fa/recovery-codes", {"password": PASSWORD, **borrowed}, token=token).status_code == 400


def test_simultaneous_answers_with_the_same_challenge_let_only_one_in():
    user = _user()
    key, _ = add_passkey(user)
    answer = passkey_login_answer(login_challenge(user)["challenge"], key)
    results = []
    threads = [threading.Thread(target=lambda: results.append(post("/auth/login/passkey", answer, origin=ORIGIN).status_code)) for _ in range(6)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(results) == [200, 401, 401, 401, 401, 401], results


def test_a_counter_that_goes_backwards_means_a_clone_but_a_synced_passkey_at_zero_is_fine():
    user = _user()
    key, _ = add_passkey(user, new_key(counter=0))
    assert sign_in_with_passkey(user, key).status_code == 200      # counter 1
    assert sign_in_with_passkey(user, key).status_code == 200      # counter 2
    assert sign_in_with_passkey(user, key, counter=1).status_code == 401, "an authenticator that goes back in time is a copy"
    synced_user = _user()
    synced, _ = add_passkey(synced_user, new_key(increments=False))
    for _ in range(3):
        assert sign_in_with_passkey(synced_user, synced).status_code == 200


def test_someone_elses_passkey_does_nothing_for_me():
    a, b = _user(), _user()
    add_passkey(a)
    b_key, _ = add_passkey(b)
    assert post("/auth/login/passkey", passkey_login_answer(login_challenge(a)["challenge"], b_key), origin=ORIGIN).status_code == 401
    assert post("/auth/login/passkey/options", {"challenge": "junk"}, origin=ORIGIN).status_code == 401


def test_wrong_passkey_answers_are_counted_like_wrong_codes():
    user = _user()
    add_passkey(user)
    challenge = login_challenge(user)["challenge"]
    statuses = [post("/auth/login/passkey", {"challenge": challenge, "challenge_id": "nope", "credential": {"id": "x"}},
                     origin=ORIGIN, ip=f"10.8.{n}.1").status_code for n in range(14)]
    assert statuses[:5] == [401] * 5 and 429 in statuses, statuses


# -- managing -------------------------------------------------------------------------------------------------------------------

def test_removing_a_passkey_needs_the_password_and_a_proof_and_the_last_one_turns_it_all_off():
    user = _user()
    key, _ = add_passkey(user, name="Phone")
    second = new_key()
    opts = post("/auth/2fa/passkeys/options", {"password": PASSWORD, **passkey_proof(user, key)}, token=user["token"], origin=ORIGIN).json()
    assert post("/auth/2fa/passkeys", {"challenge_id": opts["challenge_id"], "credential": second.create(opts["options"]), "name": "Key"},
                token=user["token"], origin=ORIGIN).status_code == 200
    first_id = [p["id"] for p in get("/auth/2fa", user["token"]).json()["passkeys"] if p["name"] == "Phone"][0]
    assert post(f"/auth/2fa/passkeys/{first_id}/remove", {"password": PASSWORD}, token=user["token"]).status_code == 400, "no proof"
    assert post(f"/auth/2fa/passkeys/{first_id}/remove", {"password": "Not-my-password-1", **passkey_proof(user, key)}, token=user["token"]).status_code == 400
    assert post(f"/auth/2fa/passkeys/{first_id}/remove", {"password": PASSWORD, **passkey_proof(user, key)}, token=user["token"]).status_code == 200
    status = get("/auth/2fa", user["token"]).json()
    assert [p["name"] for p in status["passkeys"]] == ["Key"] and status["enabled"] is True and status["recovery_codes_left"] == 8
    last_id = status["passkeys"][0]["id"]
    assert post(f"/auth/2fa/passkeys/{last_id}/remove", {"password": PASSWORD, **passkey_proof(user, second)}, token=user["token"]).status_code == 200
    assert flags(user["token"]) == {"enabled": False, "recovery_codes_left": 0}, "no method left: the recovery codes go with it"
    assert post("/auth/login", {"email": user["email"], "password": PASSWORD}).json().get("requires_totp") is None


def test_nobody_can_remove_or_rename_another_persons_passkey():
    a, b = _user(), _user()
    add_passkey(a)
    key_b, _ = add_passkey(b)
    a_id = get("/auth/2fa", a["token"]).json()["passkeys"][0]["id"]
    assert post(f"/auth/2fa/passkeys/{a_id}/remove", {"password": PASSWORD, **passkey_proof(b, key_b)}, token=b["token"]).status_code == 404
    assert post(f"/auth/2fa/passkeys/{a_id}/rename", {"name": "mine now"}, token=b["token"]).status_code == 404
    assert get("/auth/2fa", a["token"]).json()["passkeys"][0]["name"] != "mine now"


def test_a_passkey_can_be_renamed():
    user = _user()
    add_passkey(user)
    pid = get("/auth/2fa", user["token"]).json()["passkeys"][0]["id"]
    assert post(f"/auth/2fa/passkeys/{pid}/rename", {"name": "  Work laptop "}, token=user["token"]).status_code == 200
    assert get("/auth/2fa", user["token"]).json()["passkeys"][0]["name"] == "Work laptop"


def test_only_ten_passkeys_per_account():
    user = _user()
    key, _ = add_passkey(user)
    for n in range(9):
        ip = f"10.7.{n}.1"
        opts = post("/auth/2fa/passkeys/options", {"password": PASSWORD, **passkey_proof(user, key, ip)}, token=user["token"], origin=ORIGIN, ip=ip).json()
        assert post("/auth/2fa/passkeys", {"challenge_id": opts["challenge_id"], "credential": new_key().create(opts["options"]), "name": f"k{n}"},
                    token=user["token"], origin=ORIGIN, ip=ip).status_code == 200
    refused = post("/auth/2fa/passkeys/options", {"password": PASSWORD, **passkey_proof(user, key, "10.7.99.1")}, token=user["token"], origin=ORIGIN, ip="10.7.99.1")
    assert refused.status_code == 400 and "10" in refused.json()["detail"]


def test_passkeys_sit_beside_the_authenticator_app_and_either_signs_in():
    user = _user()
    secret, codes = add_totp(user)
    forget_used_steps(user)
    opts = post("/auth/2fa/passkeys/options", {"password": PASSWORD, "code": totp.code_at(secret, step())}, token=user["token"], origin=ORIGIN)
    assert opts.status_code == 200, opts.text
    key = new_key()
    done = post("/auth/2fa/passkeys", {"challenge_id": opts.json()["challenge_id"], "credential": key.create(opts.json()["options"]), "name": "Key"},
                token=user["token"], origin=ORIGIN)
    assert done.status_code == 200 and done.json()["recovery_codes"] == []
    assert login_challenge(user)["methods"] == ["passkey", "totp"]
    assert sign_in_with_passkey(user, key).status_code == 200
    forget_used_steps(user)
    challenge = login_challenge(user)["challenge"]
    assert post("/auth/login/totp", {"challenge": challenge, "code": totp.code_at(secret, step())}).status_code == 200
    assert post("/auth/login/totp", {"challenge": challenge, "code": codes[0]}).status_code == 200, "recovery codes work whichever method is on"
    assert sql("SELECT COUNT(*) FROM webauthn_credentials WHERE user_id=%s", (user["id"],))[0][0] == 1
