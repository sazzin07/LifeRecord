import os
import logging
import html
from typing import Optional

from dataclasses import dataclass
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

import httpx

logger = logging.getLogger("liferecord")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SMTP_HOST = os.environ.get("SMTP_HOST", "")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USERNAME = os.environ.get("SMTP_USERNAME", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_USE_TLS = os.environ.get("SMTP_USE_TLS", "true").lower() in ("true", "1", "yes")
SMTP_FROM_NAME = os.environ.get("SMTP_FROM_NAME", "Life Record")
SMTP_FROM_EMAIL = os.environ.get("SMTP_FROM_EMAIL", "")
FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:3000").rstrip("/")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _from_address() -> str:
    return f"{SMTP_FROM_NAME} <{SMTP_FROM_EMAIL or SMTP_USERNAME}>" if SMTP_FROM_NAME else (SMTP_FROM_EMAIL or SMTP_USERNAME)


async def _send_smtp(to_email: str, subject: str, html_body: str, text_body: str) -> bool:
    """Send email via aiosmtplib. Returns True on success, False on failure."""
    try:
        from aiosmtplib import send
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = _from_address()
        msg["To"] = to_email
        msg.attach(MIMEText(text_body, "plain"))
        msg.attach(MIMEText(html_body, "html"))

        await send(
            msg,
            hostname=SMTP_HOST,
            port=SMTP_PORT,
            username=SMTP_USERNAME or None,
            password=SMTP_PASSWORD or None,
            start_tls=SMTP_USE_TLS,
        )
        return True
    except Exception as exc:
        logger.error("Failed to send email to %s: %s", to_email, exc)
        return False


async def _fallback_log(to_email: str, subject: str, text_body: str) -> bool:
    """When SMTP is not configured, log the message so dev workflows still work."""
    logger.warning("SMTP is not configured. Email to %s would have been sent:", to_email)
    logger.warning("Subject: %s", subject)
    for line in text_body.splitlines():
        logger.warning("  %s", line)
    return True


# ---------------------------------------------------------------------------
# SendGrid (HTTPS API; no extra package needed)
# ---------------------------------------------------------------------------
def sendgrid_key() -> str:
    return os.environ.get("SENDGRID_API_KEY", "").strip()


def sendgrid_from() -> str:
    return os.environ.get("SENDGRID_FROM_EMAIL", "").strip() or SMTP_FROM_EMAIL


def sendgrid_host() -> str:
    return "https://api.eu.sendgrid.com" if os.environ.get("SENDGRID_EU", "").lower() in ("1", "true", "yes") else "https://api.sendgrid.com"


@dataclass
class Delivery:
    """Outcome of one send. `status` is sent, failed or not_configured; `detail` is safe to show to the user."""
    status: str
    detail: str = ""

    @property
    def ok(self) -> bool:
        return self.status == "sent"


def smtp_configured() -> bool:
    return bool(SMTP_HOST and (SMTP_USERNAME or SMTP_FROM_EMAIL))


def provider_name() -> Optional[str]:
    """The provider real emails would go through, or None when nothing is configured."""
    if sendgrid_key() and sendgrid_from():
        return "sendgrid"
    return "smtp" if smtp_configured() else None


def configuration_problem() -> Optional[str]:
    if provider_name():
        return None
    if sendgrid_key():
        return "Email is not fully set up: SENDGRID_FROM_EMAIL must be a sender address verified in SendGrid."
    return "Email is not set up. Add SENDGRID_API_KEY and SENDGRID_FROM_EMAIL to the server settings."


async def _send_sendgrid(to_email: str, subject: str, html_body: str, text_body: str,
                         custom_args: Optional[dict] = None) -> Delivery:
    payload = {
        "personalizations": [{"to": [{"email": to_email}]}],
        "from": {"email": sendgrid_from(), "name": SMTP_FROM_NAME or "Life Record"},
        "subject": subject,
        "content": [{"type": "text/plain", "value": text_body}, {"type": "text/html", "value": html_body}],
    }
    if custom_args:
        payload["custom_args"] = {k: str(v) for k, v in custom_args.items()}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20, connect=10)) as client:
            resp = await client.post(f"{sendgrid_host()}/v3/mail/send", json=payload,
                                     headers={"Authorization": f"Bearer {sendgrid_key()}", "Content-Type": "application/json"})
    except httpx.TimeoutException:
        return Delivery("failed", "The email service took too long to answer.")
    except httpx.HTTPError as exc:
        logger.warning("SendGrid transport problem: %s", type(exc).__name__)
        return Delivery("failed", "Could not reach the email service.")
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
        return Delivery("failed", "SendGrid rate limit reached. Try again later.")
    if resp.status_code >= 500:
        return Delivery("failed", "SendGrid is temporarily unavailable.")
    return Delivery("failed", f"SendGrid rejected the message: {message[:160]}" if message else "SendGrid rejected the message.")


async def deliver(to_email: str, subject: str, html_body: str, text_body: str, custom_args: Optional[dict] = None) -> Delivery:
    """Send one email and report what really happened. Unlike `send_email` it never treats a log line as a success."""
    provider = provider_name()
    if provider == "sendgrid":
        return await _send_sendgrid(to_email, subject, html_body, text_body, custom_args)
    if provider == "smtp":
        ok = await _send_smtp(to_email, subject, html_body, text_body)
        return Delivery("sent", "Sent by SMTP") if ok else Delivery("failed", "The mail server did not accept the message.")
    return Delivery("not_configured", configuration_problem() or "Email is not set up.")


async def send_email(to_email: str, subject: str, html_body: str, text_body: str) -> bool:
    """Send helper for account emails. Uses the configured provider; with none, logs for development."""
    if provider_name():
        return (await deliver(to_email, subject, html_body, text_body)).ok
    return await _fallback_log(to_email, subject, text_body)


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
    return await send_email(to_email, subject, html_body, text)


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
    return await send_email(to_email, subject, html_body, text)
