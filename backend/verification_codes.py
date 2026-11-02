"""How an emailed verification code is kept: as a keyed fingerprint, never as the code itself.

The six-digit code is the only secret a person types in from an email. Stored as typed, anyone who can read the users table
(a backup, a leaked dump, an over-curious query) holds working codes for every account that has not confirmed its address
yet. Stored as an HMAC of the code under the server's signing secret and the user's id, a copy of the table is useless: the
codes cannot be recovered or checked without the secret, and a fingerprint cannot be moved to another account.

Kept free of configuration on purpose (the secret is passed in) so test tools that plant a known code can use it too.
The fingerprint is cut to 10 hex characters (40 bits) to fit the existing `users.verification_code` column; a wrong code
matches the right one's fingerprint with probability 2^-40.
"""
import hashlib
import hmac

FINGERPRINT_LENGTH = 10


def fingerprint(secret: str, user_id: str, code: str) -> str:
    mac = hmac.new(secret.encode(), f"verify:{user_id}:{code}".encode(), hashlib.sha256).hexdigest()
    return mac[:FINGERPRINT_LENGTH]


def matches(stored: str, secret: str, user_id: str, code: str) -> bool:
    """Constant-time comparison of what is stored with the fingerprint of what was typed."""
    return bool(stored) and hmac.compare_digest(stored, fingerprint(secret, user_id, code))
