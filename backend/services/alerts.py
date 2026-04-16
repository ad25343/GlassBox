"""Alert dispatching service — Slack webhook and email stub."""
from __future__ import annotations

import httpx

from backend.core.config import get_settings
from backend.core.logging import get_logger

logger = get_logger(__name__)


async def send_alert(
    title: str,
    message: str,
    severity: str = "warning",
) -> None:
    """Dispatch an alert via Slack and/or email (stub).

    Never raises — all exceptions are caught and logged so callers are not
    disrupted by alert delivery failures.
    """
    settings = get_settings()

    if settings.SLACK_WEBHOOK_URL:
        payload = {
            "text": f"*[GlassBox {severity.upper()}]* {title}\n{message}",
        }
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(settings.SLACK_WEBHOOK_URL, json=payload)
                resp.raise_for_status()
            logger.info(
                "slack_alert_sent",
                title=title,
                severity=severity,
                status_code=resp.status_code,
            )
        except Exception as exc:
            logger.error(
                "slack_alert_failed",
                title=title,
                severity=severity,
                error=str(exc),
            )

    if settings.ALERT_EMAIL:
        # Wire in SendGrid/SES here when real email delivery is needed.
        logger.info(
            "email_alert_stub",
            to=settings.ALERT_EMAIL,
            title=title,
            message=message,
        )
