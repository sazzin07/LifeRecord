"""A software authenticator for tests: builds exactly what a browser sends back from navigator.credentials.create() and .get(),
signed with a real P-256 key, so the server's WebAuthn checks (challenge, origin, host, signature, counter) are exercised for real.

    key = SoftwareAuthenticator(rp_id="127.0.0.1", origin="http://127.0.0.1:8123")
    credential = key.create(options)      # options = what /auth/2fa/passkeys/options returned
    credential = key.get(options)         # options = what .../passkey/options returned
"""
import hashlib
import json
import os
import struct

import cbor2
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url


class SoftwareAuthenticator:
    def __init__(self, rp_id: str, origin: str, counter: int = 0, increments: bool = True):
        self.rp_id, self.origin = rp_id, origin
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.credential_id = os.urandom(32)
        self.counter = counter
        self.increments = increments  # False plays a synced passkey, which reports 0 forever

    def _cose_key(self) -> bytes:
        numbers = self.key.public_key().public_numbers()
        return cbor2.dumps({1: 2, 3: -7, -1: 1, -2: numbers.x.to_bytes(32, "big"), -3: numbers.y.to_bytes(32, "big")})

    def _client_data(self, kind: str, challenge: str, origin=None) -> bytes:
        return json.dumps({"type": kind, "challenge": challenge, "origin": origin or self.origin, "crossOrigin": False}).encode()

    def _rp_hash(self, rp_id=None) -> bytes:
        return hashlib.sha256((rp_id or self.rp_id).encode()).digest()

    @property
    def id(self) -> str:
        return bytes_to_base64url(self.credential_id)

    def create(self, options: dict, origin=None, rp_id=None) -> dict:
        client_data = self._client_data("webauthn.create", options["challenge"], origin)
        attested = b"\x00" * 16 + struct.pack(">H", len(self.credential_id)) + self.credential_id + self._cose_key()
        auth_data = self._rp_hash(rp_id) + bytes([0x45 | 0x08 | 0x10]) + struct.pack(">I", self.counter) + attested  # UP|UV|AT|BE|BS
        attestation = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})
        return {"id": self.id, "rawId": self.id, "type": "public-key", "authenticatorAttachment": "platform",
                "response": {"clientDataJSON": bytes_to_base64url(client_data), "attestationObject": bytes_to_base64url(attestation),
                             "transports": ["internal", "hybrid"]},
                "clientExtensionResults": {}}

    def get(self, options: dict, origin=None, rp_id=None, counter=None) -> dict:
        if counter is not None:
            self.counter = counter
        elif self.increments:
            self.counter += 1
        client_data = self._client_data("webauthn.get", options["challenge"], origin)
        auth_data = self._rp_hash(rp_id) + bytes([0x05 | 0x18]) + struct.pack(">I", self.counter)  # UP|UV|BE|BS
        signature = self.key.sign(auth_data + hashlib.sha256(client_data).digest(), ec.ECDSA(hashes.SHA256()))
        return {"id": self.id, "rawId": self.id, "type": "public-key", "authenticatorAttachment": "platform",
                "response": {"clientDataJSON": bytes_to_base64url(client_data), "authenticatorData": bytes_to_base64url(auth_data),
                             "signature": bytes_to_base64url(signature), "userHandle": None},
                "clientExtensionResults": {}}
