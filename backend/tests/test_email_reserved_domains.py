"""Mail is never sent to reserved test domains (RFC 2606 / 6761): no real mailbox exists there, and every attempt
bounces and hurts the sender's reputation. In-process; no server or network needed."""
import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import email_service  # noqa: E402


@pytest.mark.parametrize("addr", [
    "authtest_1@example.com", "a@EXAMPLE.org", "b@example.net", "c@sub.example.com",
    "d@foo.test", "e@x.example", "f@y.invalid", "g@localhost", "h@z.localhost",
])
def test_reserved(addr):
    assert email_service.is_reserved_address(addr)


@pytest.mark.parametrize("addr", ["someone@gmail.com", "me@example-shop.com", "x@notexample.com", "y@testing.io"])
def test_not_reserved(addr):
    assert not email_service.is_reserved_address(addr)


def test_deliver_skips_reserved_without_calling_the_provider(monkeypatch):
    monkeypatch.setenv("SENDGRID_API_KEY", "SG.fake")
    monkeypatch.setenv("SENDGRID_FROM_EMAIL", "sender@gmail.com")

    async def boom(*a, **k):
        raise AssertionError("provider must not be called")

    monkeypatch.setattr(email_service, "_send_sendgrid", boom)
    out = asyncio.run(email_service.deliver("authtest_1@example.com", "s", "<p>h</p>", "t"))
    assert out.status == "failed" and "reserved" in out.detail
