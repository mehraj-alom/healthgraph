"""Compatibility import for the single canonical authentication dependency.

New endpoints must depend on ``get_authenticated_patient_id`` directly from
``app.api.dependencies``.  This module deliberately does not expose a second
Firebase-token verification path.
"""

from app.api.dependencies import get_authenticated_patient_id

__all__ = ["get_authenticated_patient_id"]
