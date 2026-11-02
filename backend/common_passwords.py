"""The words every password-guessing attack tries first, for `security_utils.password_problem`.

Not a breach database (that needs a download this project does not make); the short list that matters most: the most common
passwords and the words people build them from. A password is compared by its STEM: lower case, look-alike characters undone
(@ -> a, 0 -> o, 3 -> e, $ -> s, 1 -> i or l, ...), then digits and symbols removed. So "P@ssw0rd2024!" is "password", while
"Welcome-back-5" is "welcomeback", which is not on the list.
"""
import re

COMMON_STEMS = frozenset("""
password pass passwd passw0rd pwd secret letmein letmein welcome admin administrator root login user guest master
qwerty qwertyuiop qwertyui asdfgh asdfghjkl asdf zxcvbn zxcvbnm zaq azerty qazwsx
abc abcd abcde abcdef abcdefg abcdefgh iloveyou ilove loveyou love lovely sunshine princess dragon monkey shadow superman batman
spiderman football baseball basketball soccer hockey golf tennis jordan michael jennifer jessica ashley daniel thomas
charlie buster hunter tigger ginger summer winter spring autumn flower cookie cheese banana chocolate cherry orange purple
trustno starwars whatever freedom computer internet changeme default test testing temp temporary demo sample example
michelle nicole hannah maggie harley ranger jordan killer pepper joshua matrix mustang corvette ferrari porsche mercedes
liferecord life record lifemanager myspace facebook google apple samsung iphone android windows linux
hello hello123 helloworld hellothere goodmorning goodnight welcome1 mypassword mypass secret123 passw0rds
football1 baseball1 master1 monkey1 dragon1 sunshine1 princess1 qwerty1 starwars1 batman1
""".split())

_SYMBOLS = str.maketrans({"@": "a", "$": "s"})                                 # always read as letters
_DIGITS = str.maketrans({"4": "a", "0": "o", "3": "e", "5": "s", "7": "t"})      # only when the digits stand in for letters


def stems(password: str) -> set:
    """The letters-only forms a password could be read as: digits and other symbols simply dropped ("iloveyou1" -> "iloveyou",
    "abc12345" -> "abc"), and with digits read as letters ("passw0rd" -> "password"; 1 can stand for i or for l)."""
    base = password.lower().translate(_SYMBOLS)
    readings = {base, base.translate(_DIGITS).replace("1", "i"), base.translate(_DIGITS).replace("1", "l")}
    return {re.sub(r"[^a-z]", "", reading) for reading in readings}


def is_common(password: str) -> bool:
    return any(stem in COMMON_STEMS for stem in stems(password))
