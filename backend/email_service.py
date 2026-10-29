import asyncio
import hashlib
import json
import os
import logging
import html
from email.utils import formatdate, make_msgid
from typing import Optional

from dataclasses import dataclass
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timezone

import httpx

logger = logging.getLogger("liferecord")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
# SendGrid's SMTP relay: SMTP_HOST=smtp.sendgrid.net, SMTP_PORT=587, SMTP_USERNAME=apikey (literally),
# SMTP_PASSWORD=<a SendGrid API key with Mail Send>, SMTP_FROM_EMAIL=<a sender verified in SendGrid>.
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USERNAME = os.environ.get("SMTP_USERNAME", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_USE_TLS = os.environ.get("SMTP_USE_TLS", "true").lower() in ("true", "1", "yes")
SMTP_FROM_NAME = os.environ.get("SMTP_FROM_NAME", "Life Record")
SMTP_FROM_EMAIL = os.environ.get("SMTP_FROM_EMAIL", "")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000").rstrip("/")
SMTP_TIMEOUT = 20
RETRY_DELAYS = (1.0, 3.0)  # waits before the 2nd and 3rd try of a send that failed for a temporary reason


@dataclass
class Delivery:
    """Outcome of one send. `status` is sent, failed or not_configured; `detail` is safe to show to the user.
    `retryable` marks a failure that is worth trying again (network trouble, 4xx replies)."""
    status: str
    detail: str = ""
    retryable: bool = False
    attempts: int = 1

    @property
    def ok(self) -> bool:
        return self.status == "sent"


# ---------------------------------------------------------------------------
# Provider selection
# ---------------------------------------------------------------------------
def sendgrid_key() -> str:
    return os.environ.get("SENDGRID_API_KEY", "").strip()


def sendgrid_from() -> str:
    return os.environ.get("SENDGRID_FROM_EMAIL", "").strip() or SMTP_FROM_EMAIL


def sendgrid_host() -> str:
    return "https://api.eu.sendgrid.com" if os.environ.get("SENDGRID_EU", "").lower() in ("1", "true", "yes") else "https://api.sendgrid.com"


def smtp_from() -> str:
    """Envelope/visible sender for SMTP. Never the SMTP user name: for SendGrid that is the word 'apikey'."""
    return SMTP_FROM_EMAIL or os.environ.get("SENDGRID_FROM_EMAIL", "").strip()


def smtp_configured() -> bool:
    return bool(SMTP_HOST and smtp_from())


def provider_name() -> Optional[str]:
    """The provider real emails would go through, or None when nothing is configured.
    EMAIL_PROVIDER=smtp|sendgrid forces one; otherwise the SendGrid HTTP API is preferred when its key is set."""
    forced = os.environ.get("EMAIL_PROVIDER", "").strip().lower()
    if forced == "smtp":
        return "smtp" if smtp_configured() else None
    if forced == "sendgrid":
        return "sendgrid" if (sendgrid_key() and sendgrid_from()) else None
    if sendgrid_key() and sendgrid_from():
        return "sendgrid"
    return "smtp" if smtp_configured() else None


def configuration_problem() -> Optional[str]:
    if provider_name():
        return None
    forced = os.environ.get("EMAIL_PROVIDER", "").strip().lower()
    if forced == "smtp" or (not sendgrid_key() and SMTP_HOST):
        return "Email is not set up. SMTP needs SMTP_HOST and a sender address (SMTP_FROM_EMAIL) verified with the provider."
    if sendgrid_key():
        return "Email is not fully set up: SENDGRID_FROM_EMAIL must be a sender address verified in SendGrid."
    return "Email is not set up. Add the SMTP settings (or SENDGRID_API_KEY and SENDGRID_FROM_EMAIL) to the server settings."


# RFC 2606 / 6761 names: no real mailbox can exist there, so sending only produces bounces (which hurt the
# sender's reputation). The test suites register accounts on these domains.
_RESERVED_DOMAINS = ("example.com", "example.net", "example.org")
_RESERVED_SUFFIXES = (".test", ".example", ".invalid", ".localhost")


def is_reserved_address(addr: str) -> bool:
    domain = (addr or "").rsplit("@", 1)[-1].strip().lower().rstrip(".")
    return (domain == "localhost" or domain.endswith(_RESERVED_SUFFIXES)
            or any(domain == d or domain.endswith("." + d) for d in _RESERVED_DOMAINS))


# ---------------------------------------------------------------------------
# Sending: SMTP
# ---------------------------------------------------------------------------
def _from_header() -> str:
    addr = smtp_from()
    return f"{SMTP_FROM_NAME} <{addr}>" if SMTP_FROM_NAME else addr


def _smtp_api_header(category: str) -> str:
    """SendGrid's SMTP API header: no click/open tracking (a tracked reset link would pass the token through
    SendGrid's redirect) and a category so the activity feed can tell the emails apart."""
    return json.dumps({"category": [category],
                       "filters": {"clicktrack": {"settings": {"enable": 0}}, "opentrack": {"settings": {"enable": 0}}}})


async def _send_smtp(to_email: str, subject: str, html_body: str, text_body: str, category: str = "account") -> Delivery:
    import aiosmtplib
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = _from_header()
    msg["To"] = to_email
    msg["Date"] = formatdate(localtime=False)
    msg["Message-ID"] = make_msgid(domain=(smtp_from().rsplit("@", 1)[-1] or "localhost"))
    msg["X-SMTPAPI"] = _smtp_api_header(category)
    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))
    try:
        await aiosmtplib.send(
            msg, hostname=SMTP_HOST, port=SMTP_PORT, username=SMTP_USERNAME or None, password=SMTP_PASSWORD or None,
            start_tls=SMTP_USE_TLS, timeout=SMTP_TIMEOUT,
        )
        return Delivery("sent", "Sent by SMTP")
    except aiosmtplib.SMTPAuthenticationError:
        logger.warning("SMTP login rejected by %s", SMTP_HOST)
        return Delivery("failed", "The mail server rejected the SMTP login. Check that SMTP_PASSWORD is a valid SendGrid API key "
                                  "with Mail Send permission and that SMTP_USERNAME is apikey.")
    except aiosmtplib.SMTPSenderRefused:
        logger.warning("SMTP sender refused: %s", smtp_from())
        return Delivery("failed", f"The mail server refused the sender address. In SendGrid, open Settings > Sender Authentication "
                                  f"and make sure {smtp_from()} is a verified sender.")
    except (aiosmtplib.SMTPRecipientsRefused, aiosmtplib.SMTPRecipientRefused):
        return Delivery("failed", "The mail server refused the recipient address.")
    except (aiosmtplib.SMTPServerDisconnected, aiosmtplib.SMTPConnectError, aiosmtplib.SMTPTimeoutError, asyncio.TimeoutError, OSError) as exc:
        logger.warning("SMTP transport problem: %s", type(exc).__name__)
        return Delivery("failed", "The mail server is temporarily unavailable.", retryable=True)
    except aiosmtplib.SMTPResponseException as exc:
        logger.warning("SMTP server answered %s", exc.code)
        if 400 <= exc.code < 500:
            return Delivery("failed", "The mail server is temporarily unavailable.", retryable=True)
        return Delivery("failed", f"The mail server did not accept the message (code {exc.code}).")
    except aiosmtplib.SMTPException as exc:
        logger.warning("SMTP problem: %s", type(exc).__name__)
        return Delivery("failed", "The mail server did not accept the message.")


# ---------------------------------------------------------------------------
# Sending: SendGrid HTTP API (used when EMAIL_PROVIDER is not forced to smtp and an API key is set)
# ---------------------------------------------------------------------------
async def _send_sendgrid(to_email: str, subject: str, html_body: str, text_body: str,
                         custom_args: Optional[dict] = None, category: str = "account") -> Delivery:
    payload = {
        "personalizations": [{"to": [{"email": to_email}]}],
        "from": {"email": sendgrid_from(), "name": SMTP_FROM_NAME or "Life Record"},
        "subject": subject,
        "content": [{"type": "text/plain", "value": text_body}, {"type": "text/html", "value": html_body}],
        "categories": [category],
        "tracking_settings": {"click_tracking": {"enable": False, "enable_text": False}, "open_tracking": {"enable": False}},
    }
    if custom_args:
        payload["custom_args"] = {k: str(v) for k, v in custom_args.items()}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20, connect=10)) as client:
            resp = await client.post(f"{sendgrid_host()}/v3/mail/send", json=payload,
                                     headers={"Authorization": f"Bearer {sendgrid_key()}", "Content-Type": "application/json"})
    except httpx.TimeoutException:
        return Delivery("failed", "The email service took too long to answer.", retryable=True)
    except httpx.HTTPError as exc:
        logger.warning("SendGrid transport problem: %s", type(exc).__name__)
        return Delivery("failed", "Could not reach the email service.", retryable=True)
    if resp.status_code in (200, 201, 202):
        return Delivery("sent", "Accepted by SendGrid")
    try:
        message = (resp.json().get("errors") or [{}])[0].get("message", "")
    except ValueError:
        message = ""
    if sendgrid_key():
        message = message.replace(sendgrid_key(), "[redacted]")
    logger.warning("SendGrid rejected a message: status=%s", resp.status_code)
    if resp.status_code == 401:
        return Delivery("failed", "SendGrid rejected the API key.")
    if resp.status_code == 403:
        return Delivery("failed", "SendGrid refused the message: the sender address is not verified, or the key lacks Mail Send permission.")
    if resp.status_code == 429:
        return Delivery("failed", "SendGrid rate limit reached. Try again later.", retryable=True)
    if resp.status_code >= 500:
        return Delivery("failed", "SendGrid is temporarily unavailable.", retryable=True)
    return Delivery("failed", f"SendGrid rejected the message: {message[:160]}" if message else "SendGrid rejected the message.")


# ---------------------------------------------------------------------------
# Delivery entry points
# ---------------------------------------------------------------------------
async def deliver(to_email: str, subject: str, html_body: str, text_body: str, custom_args: Optional[dict] = None,
                  category: str = "account") -> Delivery:
    """Send one email and report what really happened. Unlike `send_email` it never treats a log line as a success."""
    provider = provider_name()
    if provider and is_reserved_address(to_email):
        logger.info("Not sending email to a reserved test domain (%s)", to_email.rsplit("@", 1)[-1])
        return Delivery("failed", "Not sent: the address is on a reserved test domain.")
    if provider == "sendgrid":
        return await _send_sendgrid(to_email, subject, html_body, text_body, custom_args, category)
    if provider == "smtp":
        return await _send_smtp(to_email, subject, html_body, text_body, category)
    return Delivery("not_configured", configuration_problem() or "Email is not set up.")


async def deliver_with_retry(to_email: str, subject: str, html_body: str, text_body: str,
                             custom_args: Optional[dict] = None, category: str = "account") -> Delivery:
    """`deliver`, trying again (up to 3 times in all) when the failure looks temporary."""
    delivery = await deliver(to_email, subject, html_body, text_body, custom_args, category)
    delivery.attempts = 1
    for delay in RETRY_DELAYS:
        if delivery.ok or not delivery.retryable:
            break
        await asyncio.sleep(delay)
        attempts = delivery.attempts + 1
        delivery = await deliver(to_email, subject, html_body, text_body, custom_args, category)
        delivery.attempts = attempts
    return delivery



async def record_event(purpose: str, to_email: str, delivery: Delivery, attempts: int = 1, provider: Optional[str] = None) -> None:
    """Remember how an account email went (hash + domain of the recipient, never the address). Never raises."""
    try:
        from database import AsyncSessionLocal
        from models import EmailEvent
        status = "skipped" if is_reserved_address(to_email) and delivery.status == "failed" else delivery.status
        async with AsyncSessionLocal() as db:
            db.add(EmailEvent(
                purpose=purpose, recipient_hash=hashlib.sha256(to_email.encode()).hexdigest(),
                recipient_domain=(to_email.rsplit("@", 1)[-1] or "")[:255], provider=provider or provider_name() or "",
                status=status, attempts=attempts, detail=(delivery.detail or "")[:255],
                created_at=datetime.now(timezone.utc).isoformat()))
            await db.commit()
    except Exception as exc:  # the log must never break sending
        logger.warning("Could not record email event: %s", type(exc).__name__)


async def send_account_email(purpose: str, to_email: str, subject: str, html_body: str, text_body: str) -> Delivery:
    """Send an account email with retries and record the outcome. Safe to run in a background task."""
    delivery = await deliver_with_retry(to_email, subject, html_body, text_body, category=purpose)
    if not delivery.ok:
        logger.warning("Account email '%s' to a %s address was not sent: %s", purpose, to_email.rsplit("@", 1)[-1], delivery.detail)
    await record_event(purpose, to_email, delivery, attempts=delivery.attempts)
    return delivery


async def send_email(to_email: str, subject: str, html_body: str, text_body: str, purpose: str = "account") -> bool:
    """Send helper for account emails; True only when the provider accepted the message."""
    if provider_name():
        return (await send_account_email(purpose, to_email, subject, html_body, text_body)).ok
    # No provider: say so, but never write the message (it holds codes and reset links) to the log unless asked to.
    logger.warning("Email '%s' was not sent: %s", purpose, configuration_problem())
    if os.environ.get("EMAIL_LOG_BODIES", "").lower() in ("1", "true", "yes"):
        logger.warning("To: %s\nSubject: %s\n%s", to_email, subject, text_body)
    await record_event(purpose, to_email, Delivery("not_configured", configuration_problem() or ""), provider="")
    return False


# ---------------------------------------------------------------------------
# Templated emails
# ---------------------------------------------------------------------------
async def send_verification_code(to_email: str, code: str, name: Optional[str] = None) -> bool:
    subject = "Your Life Record verification code"
    display_name = html.escape(name or to_email)
    safe_code = html.escape(code)
    html_body = f"""\
<html>
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #111827;">
    <div style="max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #059669;">Verify your Life Record account</h2>
        <p>Hi {display_name},</p>
        <p>Use the code below to verify your email address. It expires in 15 minutes.</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 4px; padding: 16px; background: #ecfdf5; border-radius: 8px; text-align: center; color: #047857; margin: 24px 0;">
            {safe_code}
        </div>
        <p style="color: #6b7280; font-size: 14px;">If you did not create an account, you can safely ignore this email.</p>
    </div>
</body>
</html>
"""
    text = f"""\
Hi {name or to_email},

Your Life Record verification code is: {code}

This code expires in 15 minutes. If you did not create an account, you can safely ignore this email.
"""
    return await send_email(to_email, subject, html_body, text, purpose="verification")


async def send_password_reset(to_email: str, token: str, name: Optional[str] = None) -> bool:
    subject = "Reset your Life Record password"
    display_name = html.escape(name or to_email)
    # Encode the token so it is safe to embed in a URL/query string
    from urllib.parse import quote
    safe_token = quote(token, safe="")
    reset_url = f"{FRONTEND_URL}/reset-password?token={safe_token}"
    html_body = f"""\
<html>
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #111827;">
    <div style="max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #059669;">Reset your password</h2>
        <p>Hi {display_name},</p>
        <p>Click the button below to reset your Life Record password. This link expires in 30 minutes and can only be used once.</p>
        <a href="{reset_url}" style="display: inline-block; padding: 12px 24px; background: #059669; color: #ffffff; text-decoration: none; border-radius: 8px; margin: 16px 0;">Reset password</a>
        <p style="word-break: break-all; color: #6b7280; font-size: 14px;">Or copy and paste this link:<br>{reset_url}</p>
        <p style="color: #6b7280; font-size: 14px;">If you did not request a password reset, you can safely ignore this email.</p>
    </div>
</body>
</html>
"""
    text = f"""\
Hi {name or to_email},

Reset your Life Record password by opening this link in your browser:

{reset_url}

This link expires in 30 minutes and can only be used once. If you did not request a password reset, you can safely ignore this email.
"""
    return await send_email(to_email, subject, html_body, text, purpose="password_reset")


_NOTICES = {
    "password_changed": ("Your Life Record password was changed", "The password for your Life Record account was just changed, and every other device was signed out."),
    "password_reset": ("Your Life Record password was reset", "The password for your Life Record account was just reset with an emailed link, and every device was signed out."),
    "signed_out_everywhere": ("You were signed out of Life Record everywhere", "Every device signed in to your Life Record account was just signed out."),
}


async def send_security_notice(to_email: str, name: Optional[str], event: str) -> bool:
    """Tell the account owner about a sensitive change, so a takeover does not go unnoticed."""
    subject, what = _NOTICES[event]
    display_name = html.escape(name or to_email)
    reset_url = f"{FRONTEND_URL}/forgot-password"
    html_body = f"""\
<html>
<body style="font-family: system-ui, sans-serif; line-height: 1.5; color: #111827;">
    <div style="max-width: 480px; margin: 0 auto; padding: 32px;">
        <h2 style="color: #059669;">{html.escape(subject)}</h2>
        <p>Hi {display_name},</p>
        <p>{html.escape(what)}</p>
        <p>If this was you, nothing more is needed.</p>
        <p><strong>If this was not you</strong>, reset your password right away: <a href="{reset_url}">{reset_url}</a>.</p>
    </div>
</body>
</html>
"""
    text = f"""\
Hi {name or to_email},

{what}

If this was you, nothing more is needed.
If this was not you, reset your password right away: {reset_url}
"""
    return await send_email(to_email, subject, html_body, text, purpose="security_notice")
