"""
Phase 0 / Increment 4 backend security regression tests.

Verifies the two Increment 4 authorization fixes:

1. APISecurityLogs* — the pipeline log endpoints now require Firebase
   authentication (they previously exposed operational logs publicly).

2. ProvenanceDocumentOwnership — the provenance endpoint re-verifies that
   the evidence-linked document belongs to the authenticated patient
   (defense in depth on top of event ownership).

Pure tests, no database or external services required.
"""

import uuid

import pytest

from app.api.dependencies import get_authenticated_patient_id
from app.api.v1 import logs as logs_module
from app.api.v1.provenance import get_event_provenance
from models.events import ClinicalEvent, Document, EvidenceLink
from schemas.events import ProvenanceResponse


def _route_dependencies(route):
    """Collect the callables the route resolves, transitively."""
    resolved = []
    pending = [route.dependant]
    while pending:
        dep = pending.pop()
        if dep.call is not None:
            resolved.append(dep.call)
        pending.extend(dep.dependencies)
    return resolved


class TestLogsRouterRequiresAuth:
    @pytest.mark.parametrize(
        "suffix",
        ["/recent", "/stream"],
    )
    def test_endpoint_requires_auth(self, suffix):
        routes = [
            r for r in logs_module.router.routes if r.path.endswith(suffix)
        ]
        assert routes, f"expected a route ending in {suffix}"
        assert get_authenticated_patient_id in _route_dependencies(routes[0])


class FakeQuery:
    """Minimal query-builder stand-in that records the filter conditions."""

    def __init__(self, db, entities):
        self._db = db
        self._entities = entities

    def join(self, target, onclause):
        self._db.join_target = target
        return self

    def filter(self, *conditions):
        self._db.filters = conditions
        return self

    def first(self):
        return self._db.result


class FakeDB:
    def __init__(self, event, result):
        self.event = event
        self.result = result
        self.filters = None
        self.join_target = None

    def scalar(self, stmt):
        return self.event

    def query(self, *entities):
        return FakeQuery(self, entities)


class TestProvenanceDocumentOwnership:
    def _owned_setup(self):
        patient_id = uuid.uuid4()
        event_id = uuid.uuid4()
        document_id = uuid.uuid4()
        event = ClinicalEvent(event_id=event_id, patient_id=patient_id)
        evidence = EvidenceLink(
            document_id=document_id,
            extracted_text="Evidence text",
            bounding_box=[0.1, 0.2, 0.3, 0.4],
        )
        document = Document(document_id=document_id, storage_url="/docs/x")
        return patient_id, event_id, event, evidence, document

    def test_document_ownership_is_enforced_on_join(self):
        patient_id, event_id, event, evidence, document = self._owned_setup()
        db = FakeDB(event, (evidence, document))

        get_event_provenance(event_id=event_id, db=db, patient_id=patient_id)

        comparisons = [
            (getattr(c.left, "key", None), getattr(c.right, "value", None))
            for c in (db.filters or [])
            if hasattr(c, "left") and hasattr(c, "right")
        ]
        assert (Document.patient_id.key, patient_id) in comparisons

    def test_success_returns_provenance_response(self):
        patient_id, event_id, event, evidence, document = self._owned_setup()
        db = FakeDB(event, (evidence, document))

        result = get_event_provenance(
            event_id=event_id, db=db, patient_id=patient_id
        )

        assert isinstance(result, ProvenanceResponse)
        assert result.document_id == document.document_id
        assert result.storage_url == document.storage_url
        assert result.extracted_text == "Evidence text"

    def test_other_patient_document_returns_404(self):
        patient_id, event_id, event, evidence, document = self._owned_setup()
        # Another patient owns the document the event links to.
        document.patient_id = uuid.uuid4()
        # The handler's join filter excludes it, so first() returns nothing.
        db = FakeDB(event, None)

        with pytest.raises(Exception) as excinfo:
            get_event_provenance(
                event_id=event_id, db=db, patient_id=patient_id
            )
        assert excinfo.value.status_code == 404

    def test_event_not_owned_returns_404(self):
        patient_id = uuid.uuid4()
        db = FakeDB(None, None)
        with pytest.raises(Exception) as excinfo:
            get_event_provenance(
                event_id=uuid.uuid4(), db=db, patient_id=patient_id
            )
        assert excinfo.value.status_code == 404