"""Minimal SMTP email sender (Gmail App Password by default — see
config.SMTP_*). No queue/retry: callers wrap this in try/except and treat a
failure as non-fatal, the same way services/telegram.py is used.
"""
import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr

from ..config import settings

logger = logging.getLogger("email_client")


def send_email(to_emails: list[str], subject: str, html_body: str) -> int:
    """Sends one email addressed to all `to_emails` (visible to each other,
    like a normal group email — fine for internal project notifications).
    Returns the number of recipients the message was accepted for (0 if
    SMTP isn't configured, the recipient list is empty, or sending failed).
    """
    recipients = [e.strip() for e in (to_emails or []) if e and e.strip()]
    if not recipients:
        return 0
    if not settings.is_smtp_enabled:
        logger.info("SMTP not configured — skipping email '%s' to %s", subject, recipients)
        return 0

    from_email = settings.SMTP_FROM_EMAIL or settings.SMTP_USER
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = formataddr((settings.SMTP_FROM_NAME, from_email))
    msg["To"] = ", ".join(recipients)
    msg.attach(MIMEText(html_body, "html", "utf-8"))

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=15) as server:
            server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(from_email, recipients, msg.as_string())
        return len(recipients)
    except Exception as e:
        logger.error("Failed to send email '%s' to %s: %s", subject, recipients, e)
        return 0
