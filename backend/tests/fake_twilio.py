"""A stand-in for Twilio's Messages API, for the scratch stack only. The server under test really posts its text messages here
(TWILIO_API_BASE points at it), so a test reads the code the way a phone would receive it. Nothing leaves the machine.

    POST /2010-04-01/Accounts/<sid>/Messages.json   (form: To, From, Body; basic auth)  -> 201, like Twilio
    GET  /_messages?to=+351912345678                -> JSON list of what was sent to that number, oldest first
    DELETE /_messages                               -> forget everything

Twilio's own test number +15005550001 is "not a valid phone number" (HTTP 400, code 21211); here too, so the failure path
of the server can be exercised. A recipient ending in 0000 plays a provider that is down (HTTP 503).
"""
import base64
import json
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

SID = "ACtest0000000000000000000000000000"
TOKEN = "scratch-twilio-token"
INVALID_NUMBER = "+15005550001"

_messages = []
_lock = threading.Lock()


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # silence
        pass

    def _send(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        form = {k: v[0] for k, v in parse_qs(self.rfile.read(length).decode()).items()}
        expected = "Basic " + base64.b64encode(f"{SID}:{TOKEN}".encode()).decode()
        if self.headers.get("Authorization") != expected:
            return self._send(401, {"code": 20003, "message": "Authenticate"})
        if not urlparse(self.path).path.endswith("/Messages.json"):
            return self._send(404, {"message": "not found"})
        to = form.get("To", "")
        if to == INVALID_NUMBER:
            return self._send(400, {"code": 21211, "message": f"The 'To' number {to} is not a valid phone number."})
        if to.endswith("0000"):
            return self._send(503, {"message": "provider down"})
        with _lock:
            _messages.append({"to": to, "from": form.get("From"), "body": form.get("Body", "")})
        self._send(201, {"sid": "SM" + uuid.uuid4().hex, "status": "queued"})

    def do_GET(self):
        url = urlparse(self.path)
        if url.path != "/_messages":
            return self._send(404, {})
        to = parse_qs(url.query).get("to", [None])[0]
        with _lock:
            self._send(200, [m for m in _messages if to is None or m["to"] == to])

    def do_DELETE(self):
        with _lock:
            _messages.clear()
        self._send(200, {})


def start():
    """Start on a free loopback port in a daemon thread. Returns (httpd, base_url)."""
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"
