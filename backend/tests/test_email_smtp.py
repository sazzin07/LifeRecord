"""Account emails through SendGrid's SMTP relay: provider choice, message shape, error handling, retries, events."""
import asyncio
import hashlib
import sys
from pathlib import Path

import aiosmtplib
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import email_service as es  # noqa: E402
from support_auth import OWNER_EMAIL  # noqa: E402

KEY = "SG.test-key-not-real"


@pytest.fixture
def smtp(monkeypatch):
    """SendGrid relay settings, a recording fake for aiosmtplib.send, and no waiting between retries."""
    monkeypatch.setenv("EMAIL_PROVIDER", "smtp")
    monkeypatch.delenv("SENDGRID_API_KEY", raising=False)
    monkeypatch.setattr(es, "SMTP_HOST", "smtp.sendgrid.net")
    monkeypatch.setattr(es, "SMTP_PORT", 587)
    monkeypatch.setattr(es, "SMTP_USERNAME", "apikey")
    monkeypatch.setattr(es, "SMTP_PASSWORD", KEY)
    monkeypatch.setattr(es, "SMTP_USE_TLS", True)
    monkeypatch.setattr(es, "SMTP_FROM_NAME", "Life Record")
    monkeypatch.setattr(es, "SMTP_FROM_EMAIL", "sender@gmail.com")
    monkeypatch.setattr(es, "RETRY_DELAYS", (0, 0))
    monkeypatch.setattr(es, "record_event", _no_event)
    calls = []

    async def ok(msg, **kw):
        calls.append((msg, kw))

    monkeypatch.setattr(aiosmtplib, "send", ok)
    return calls


async def _no_event(*a, **k):
    return None


def run(coro):
    return asyncio.run(coro)


def test_smtp_is_chosen_when_asked_even_if_a_sendgrid_api_key_exists(smtp, monkeypatch):
    monkeypatch.setenv("SENDGRID_API_KEY", KEY)
    monkeypatch.setenv("SENDGRID_FROM_EMAIL", "sender@gmail.com")
    assert es.provider_name() == "smtp"
    monkeypatch.setenv("EMAIL_PROVIDER", "")
    assert es.provider_name() == "sendgrid"  # unchanged behaviour when nothing is forced


def test_smtp_needs_a_host_and_a_sender_address(smtp, monkeypatch):
    monkeypatch.setattr(es, "SMTP_FROM_EMAIL", "")
    monkeypatch.delenv("SENDGRID_FROM_EMAIL", raising=False)
    assert es.provider_name() is None  # the SMTP user name "apikey" is not an address and is never used as one
    assert "SMTP" in es.configuration_problem()


def test_message_goes_through_the_relay_with_the_right_login_and_headers(smtp):
    out = run(es.deliver(OWNER_EMAIL, "Subject here", "<p>hi</p>", "hi"))
    assert out.ok, out
    (msg, kw), = smtp
    assert kw["hostname"] == "smtp.sendgrid.net" and kw["port"] == 587
    assert kw["username"] == "apikey" and kw["password"] == KEY and kw["start_tls"] is True
    assert msg["To"] == OWNER_EMAIL and msg["Subject"] == "Subject here"
    assert msg["From"] == "Life Record <sender@gmail.com>"
    assert msg["Message-ID"] and msg["Date"]
    kinds = [p.get_content_type() for p in msg.get_payload()]
    assert kinds == ["text/plain", "text/html"]
    # no link/open tracking: a rewritten reset link would send the token through SendGrid's redirect
    api = msg["X-SMTPAPI"]
    assert '"clicktrack"' in api and '"opentrack"' in api and '"enable": 0' in api


def test_sender_falls_back_to_sendgrid_from_email(smtp, monkeypatch):
    monkeypatch.setattr(es, "SMTP_FROM_EMAIL", "")
    monkeypatch.setenv("SENDGRID_FROM_EMAIL", "other@gmail.com")
    run(es.deliver(OWNER_EMAIL, "s", "<p>h</p>", "t"))
    assert smtp[0][0]["From"] == "Life Record <other@gmail.com>"


def test_wrong_api_key_is_a_clear_message_and_is_not_retried(smtp, monkeypatch):
    n = []

    async def deny(msg, **kw):
        n.append(1)
        raise aiosmtplib.SMTPAuthenticationError(535, f"Authentication failed for {KEY}")

    monkeypatch.setattr(aiosmtplib, "send", deny)
    out = run(es.deliver(OWNER_EMAIL, "s", "<p>h</p>", "t"))
    assert out.status == "failed" and "login" in out.detail.lower() and "API key" in out.detail
    assert KEY not in out.detail and len(n) == 1


def test_unverified_sender_is_explained_and_not_retried(smtp, monkeypatch):
    n = []

    async def refuse(msg, **kw):
        n.append(1)
        raise aiosmtplib.SMTPSenderRefused(550, "The from address does not match a verified Sender Identity", "sender@gmail.com")

    monkeypatch.setattr(aiosmtplib, "send", refuse)
    out = run(es.deliver(OWNER_EMAIL, "s", "<p>h</p>", "t"))
    assert out.status == "failed" and "verified" in out.detail and "Sender Authentication" in out.detail
    assert len(n) == 1


def test_a_refused_recipient_is_a_failure_without_retry(smtp, monkeypatch):
    n = []

    async def refuse(msg, **kw):
        n.append(1)
        raise aiosmtplib.SMTPRecipientsRefused([aiosmtplib.SMTPRecipientRefused(550, "no such user", OWNER_EMAIL)])

    monkeypatch.setattr(aiosmtplib, "send", refuse)
    out = run(es.deliver(OWNER_EMAIL, "s", "<p>h</p>", "t"))
    assert out.status == "failed" and "address" in out.detail.lower() and len(n) == 1


def test_temporary_trouble_is_retried_then_succeeds(smtp, monkeypatch):
    attempts = []

    async def flaky(msg, **kw):
        attempts.append(1)
        if len(attempts) < 3:
            raise aiosmtplib.SMTPServerDisconnected("connection lost")

    monkeypatch.setattr(aiosmtplib, "send", flaky)
    out = run(es.deliver_with_retry(OWNER_EMAIL, "s", "<p>h</p>", "t"))
    assert out.ok and len(attempts) == 3


def test_temporary_4xx_replies_are_retried_and_give_up_after_three_tries(smtp, monkeypatch):
    attempts = []

    async def busy(msg, **kw):
        attempts.append(1)
        raise aiosmtplib.SMTPResponseException(451, "try again later")

    monkeypatch.setattr(aiosmtplib, "send", busy)
    out = run(es.deliver_with_retry(OWNER_EMAIL, "s", "<p>h</p>", "t"))
    assert out.status == "failed" and "temporarily" in out.detail.lower() and len(attempts) == 3


def test_timeouts_are_retried(smtp, monkeypatch):
    attempts = []

    async def slow(msg, **kw):
        attempts.append(1)
        raise asyncio.TimeoutError()

    monkeypatch.setattr(aiosmtplib, "send", slow)
    out = run(es.deliver_with_retry(OWNER_EMAIL, "s", "<p>h</p>", "t"))
    assert out.status == "failed" and len(attempts) == 3


def test_reserved_test_domains_never_reach_the_relay(smtp):
    out = run(es.deliver("authtest_1@example.com", "s", "<p>h</p>", "t"))
    assert out.status == "failed" and "reserved" in out.detail and smtp == []


def test_without_a_provider_nothing_is_sent_and_codes_are_not_logged(monkeypatch, caplog):
    monkeypatch.setenv("EMAIL_PROVIDER", "")
    monkeypatch.delenv("SENDGRID_API_KEY", raising=False)
    monkeypatch.setattr(es, "SMTP_HOST", "")
    monkeypatch.delenv("EMAIL_LOG_BODIES", raising=False)
    monkeypatch.setattr(es, "record_event", _no_event)
    with caplog.at_level("DEBUG", logger="liferecord"):
        ok = run(es.send_verification_code("someone@gmail.com", "482913", "Sam"))
    assert ok is False
    assert "482913" not in caplog.text and "someone@gmail.com" not in caplog.text


def test_verification_email_content(smtp):
    run(es.send_verification_code(OWNER_EMAIL, "123456", "Sam <b>x</b>"))
    msg = smtp[0][0]
    html_part = msg.get_payload()[1].get_payload(decode=True).decode()
    text_part = msg.get_payload()[0].get_payload(decode=True).decode()
    assert "123456" in html_part and "123456" in text_part
    assert "<b>x</b>" not in html_part and "&lt;b&gt;" in html_part  # the name is escaped


def test_password_reset_link_is_intact(smtp, monkeypatch):
    monkeypatch.setattr(es, "FRONTEND_URL", "https://app.example.org")
    run(es.send_password_reset(OWNER_EMAIL, "abc.def_ghi-123", "Sam"))
    text_part = smtp[0][0].get_payload()[0].get_payload(decode=True).decode()
    assert "https://app.example.org/reset-password?token=abc.def_ghi-123" in text_part


def test_security_notice_says_what_happened_and_what_to_do(smtp):
    run(es.send_security_notice(OWNER_EMAIL, "Sam", "password_changed"))
    msg = smtp[0][0]
    assert "password" in msg["Subject"].lower()
    body = msg.get_payload()[0].get_payload(decode=True).decode()
    assert "not you" in body.lower() and "reset" in body.lower()


def test_events_hold_a_hash_and_a_domain_not_the_address():
    from database import AsyncSessionLocal
    from sqlalchemy import select
    from models import EmailEvent

    addr = "someone.private@gmail.com"

    async def go():
        await es.record_event("verification", addr, es.Delivery("sent", "Sent by SMTP"), attempts=2, provider="smtp")
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(select(EmailEvent).where(EmailEvent.recipient_hash == hashlib.sha256(addr.encode()).hexdigest()))).scalars().all()
            for r in rows:
                await db.delete(r)
            await db.commit()
            return rows

    rows = run(go())
    assert rows and rows[0].recipient_domain == "gmail.com" and rows[0].status == "sent" and rows[0].attempts == 2
    assert addr not in (rows[0].detail or "") and "someone.private" not in str(rows[0].__dict__)
