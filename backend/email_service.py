import os
import logging
import html
from typing import Optional

from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

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


async def send_email(to_email: str, subject: str, html_body: str, text_body: str) -> bool:
    """Public send helper. Uses SMTP if configured, otherwise logs for development."""
    if SMTP_HOST and (SMTP_USERNAME or SMTP_FROM_EMAIL):
        return await _send_smtp(to_email, subject, html_body, text_body)
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
