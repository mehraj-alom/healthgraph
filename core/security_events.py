"""Minimal security/operational event logging.

Only safe metadata is ever emitted — event category, request id, endpoint,
HTTP status, and a user/patient UUID. NEVER log request bodies, document
contents, chat contents, passwords, JWTs, Firebase/Redis credentials,
database URLs, or filesystem paths.

Used by rate limiting, auth gates, upload rejection, and the production
error handler so operators can trace abuse without the payloads.
"""

from typing import Optional

from logger import logger


def log_security_event(
    category: str,
    *,
    request_id: Optional[str] = None,
    endpoint: Optional[str] = None,
    status: Optional[int] = None,
    patient_id: Optional[str] = None,
    message: str = "",
    level: int = 30,  # logging.WARNING default; override with logging.ERROR
) -> None:
    """Emit a single sanitized security/operational event line."""
    logger.log(
        level,
        "security_event=%s request_id=%s endpoint=%s status=%s patient=%s msg=%s",
        category,
        request_id or "-",
        endpoint or "-",
        status if status is not None else "-",
        patient_id or "-",
        message,
    )