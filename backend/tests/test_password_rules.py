"""A password that passes "8 characters, a letter and a digit" can still be one of the first things anyone tries.

The rule is applied wherever a password is chosen (sign-up, reset, change). It looks at a normalised stem: lower case, the
usual look-alike swaps undone (@ for a, 0 for o, ...), digits and symbols dropped, so "P@ssw0rd2024!" is "password". It is not
a breach database (there is no network); it is the short list of words that every guessing attack starts with, plus the
person's own address, which is the next thing tried.
"""
import uuid

import pytest
import requests

import support_db
from support_auth import BASE_URL
from support_users import PASSWORD, create_verified_user

from security_utils import password_problem

TOO_EASY = "too easy to guess"


@pytest.mark.parametrize("password", [
    "Password1", "password123", "Passw0rd!", "P@ssw0rd", "Qwerty123", "qwertyuiop1", "iloveyou1", "Welcome1", "Admin1234",
    "abc12345", "Letmein123", "Monkey123", "Dragon2024", "LifeRecord1", "Football99", "Sunshine1", "PASSWORD99", "Pa$$word1",
])
def test_the_first_things_every_guessing_attack_tries_are_refused(password):
    assert password_problem(password) is not None and TOO_EASY in password_problem(password), password


@pytest.mark.parametrize("password", [
    PASSWORD, "Welcome-back-5", "correct-horse-battery-7", "Mallory123", "Owner12345", "Wrong-pass-1", "Set-by-owner-7", "k9#Vq2!mZx",
    "My dog is called Biscuit 3",
])
def test_ordinary_passwords_and_passphrases_are_not_caught_by_accident(password):
    assert password_problem(password) is None, password


def test_the_persons_own_address_is_not_a_password():
    assert TOO_EASY in password_problem("johnsmith2024", email="johnsmith@example.com")
    assert TOO_EASY in password_problem("Xjohnsmith9", email="Johnsmith@example.com")
    assert password_problem("johnsmith2024") is None, "without the address the rule has nothing to compare with"
    assert password_problem("Joe1abcd", email="joe@example.com") is None, "three letters of an address are too short to mean anything"


def test_the_length_and_strength_rules_still_come_first_and_keep_their_own_words():
    assert "at least 8" in password_problem("Ab1")
    assert "72 bytes" in password_problem("Aa1" + "x" * 70)


def test_sign_up_change_and_reset_all_refuse_a_common_password_with_the_reason():
    r = requests.post(f"{BASE_URL}/api/auth/register", json={"email": f"authtest_{uuid.uuid4().hex[:8]}@example.com", "password": "Password123", "name": "x"}, timeout=30)
    assert r.status_code == 400 and TOO_EASY in r.json()["detail"], r.text

    user = create_verified_user("authtest")
    r = requests.post(f"{BASE_URL}/api/auth/change-password", json={"current_password": PASSWORD, "new_password": "Qwerty123"},
                      headers={"Authorization": f"Bearer {user['token']}"}, timeout=30)
    assert r.status_code == 400 and TOO_EASY in r.json()["detail"], r.text

    local = user["email"].split("@")[0]  # authtest_<hex>: the address itself
    r = requests.post(f"{BASE_URL}/api/auth/change-password", json={"current_password": PASSWORD, "new_password": f"{local}9"},
                      headers={"Authorization": f"Bearer {user['token']}"}, timeout=30)
    assert r.status_code == 400 and TOO_EASY in r.json()["detail"], r.text

    link = support_db.issue_reset_token(user["email"])
    r = requests.post(f"{BASE_URL}/api/auth/reset-password", json={"token": link, "password": "Letmein123"}, timeout=30)
    assert r.status_code == 400 and TOO_EASY in r.json()["detail"], r.text
    assert requests.post(f"{BASE_URL}/api/auth/reset-password", json={"token": link, "password": "Fine-pass-9"}, timeout=30).status_code == 200, \
        "a refused password must not use up the link"
