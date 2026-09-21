"""P8.1 extraction-contract tests (no DB / Neo4j / network / LLM).

Covers P8.1-R: ADE schema validation, positive/negative finding,
symptom, anatomy (organ-vs-region), measurement gate, date distinction,
provider metadata preservation, source evidence (page envelope),
normalization status, uppercase de-identification (report1-derived
text), Qdrant retrieval filters + isolation, chunk idempotency,
sinus/HEART-chest/junk-LAB_RESULT regressions, and the document-event
retirement service.
"""
import uuid

import pytest

from models.clinical_assertion import classify_assertion
from models.events import EventType, SourceType
from services.ocr import extraction_mapper as em


class TestAdeSchema:
    def test_hint_fields_present_and_optional(self):
        from services.ocr.extraction_schema import EXTRACTION_SCHEMA

        doc_props = EXTRACTION_SCHEMA["properties"]["document"]["properties"]
        assert "encounters" in doc_props
        enc_props = doc_props["encounters"]["items"]["properties"]
        assert {"encounter_date", "encounter_type", "facility", "reason"} <= set(enc_props)
        res_props = doc_props["sections"]["items"]["properties"]["results"]["items"]["properties"]
        for hint in ("finding_type", "anatomical_site", "polarity_hint", "is_negated"):
            assert hint in res_props
        # Core lab shape untouched (backward compatible for ADE).
        for core in ("test_name", "result", "unit", "reference_range", "flag",
                     "page_number", "source_text", "confidence"):
            assert core in res_props

    def test_no_graph_topology_in_schema(self):
        import json

        from services.ocr.extraction_schema import EXTRACTION_SCHEMA

        blob = json.dumps(EXTRACTION_SCHEMA).lower()
        for forbidden in ("neo4j", "relationship", "causal", ":has_", "topology"):
            assert forbidden not in blob


class TestMeasurementGate:
    def test_numeric_with_unit_is_measurement(self):
        assert em._is_measurement_result({"test_name": "Hb", "result": "13.5", "unit": "g/dL"}) is True

    def test_flag_alone_is_measurement(self):
        assert em._is_measurement_result({"test_name": "X", "result": "Detected", "flag": "A"}) is True

    def test_junk_text_rejected(self):
        # P8-live junk LAB_RESULT string.
        assert em._is_measurement_result(
            {"test_name": "Report", "result": "Imp- Adv-Clinical Correlation"}
        ) is False

    def test_number_buried_in_prose_rejected(self):
        # P8.1-live: "RMS maximus 32 digital electro-encephalograph…"
        # must not pass on the buried "32".
        assert em._is_measurement_result(
            {"test_name": "EEG method", "result": "RMS maximus 32 digital electro-encephalograph"}
        ) is False

    def test_leading_number_passes(self):
        assert em._is_measurement_result({"test_name": "X", "result": "927"}) is True
        assert em._is_measurement_result({"test_name": "X", "result": ">200"}) is True

    def test_missing_result_rejected(self):
        assert em._is_measurement_result({"test_name": "Report"}) is False


class TestClassifyResultEntry:
    def test_junk_becomes_imaging_finding(self):
        etype, as_lab, stype = em._classify_result_entry(
            {"test_name": "Report", "result": "Imp- Adv-Clinical Correlation"}
        )
        assert etype == EventType.IMAGING_RESULT
        assert as_lab is False
        assert stype == SourceType.IMAGING_REPORT

    def test_lab_stays_lab(self):
        etype, as_lab, _ = em._classify_result_entry(
            {"test_name": "Hb", "result": "13.5", "unit": "g/dL"}
        )
        assert (etype, as_lab) == (EventType.LAB_RESULT, True)

    def test_hints_honored(self):
        assert em._classify_result_entry(
            {"test_name": "X", "result": "Headache", "finding_type": "symptom"}
        )[0] == EventType.SYMPTOM
        assert em._classify_result_entry(
            {"test_name": "X", "result": "Pneumonia", "finding_type": "diagnosis"}
        )[0] == EventType.DIAGNOSIS

    def test_hint_never_forces_lab_without_evidence(self):
        # Even an explicit measurement hint without measurement evidence
        # downgrades to a finding — never LAB/Measurement rows.
        etype, as_lab, _ = em._classify_result_entry(
            {"test_name": "X", "result": "see comment", "finding_type": "measurement"}
        )
        assert (etype, as_lab) == (EventType.IMAGING_RESULT, False)


class TestConditionGate:
    def test_negated_diagnosis_creates_no_condition(self):
        assertion = classify_assertion("No evidence of intracranial hemorrhage, mass effect or midline shift.")
        assert em._should_create_condition(EventType.DIAGNOSIS, "No evidence of intracranial hemorrhage", assertion) is False

    def test_radiology_negation_verbs_creates_no_condition(self):
        # report1.pdf: "The lung fields do not show any active lesion."
        assertion = classify_assertion("The lung fields do not show any active lesion.")
        assert assertion.polarity.value == "negative"
        assert em._should_create_condition(EventType.DIAGNOSIS, "The lung fields do not show any active lesion.", assertion) is False

    def test_normal_copula_is_negative(self):
        # report1.pdf: "Cardiac silhouette is normal."
        assertion = classify_assertion("Cardiac silhouette is normal.")
        assert assertion.polarity.value == "negative"

    def test_positive_diagnosis_creates_condition(self):
        assertion = classify_assertion("Mild mucosal thickening of bilateral maxillary sinuses.")
        assert em._should_create_condition(EventType.DIAGNOSIS, "Mild mucosal thickening", assertion) is True

    def test_family_history_creates_no_condition(self):
        assertion = classify_assertion("Father had diabetes.")
        assert em._should_create_condition(EventType.DIAGNOSIS, "diabetes", assertion) is False

    def test_non_diagnosis_never_creates_condition(self):
        assertion = classify_assertion("Headache")
        assert em._should_create_condition(EventType.SYMPTOM, "Headache", assertion) is False


class TestNormalStudyStatement:
    def test_normal_study_phrases(self):
        assert em._is_normal_study_statement("Normal chest X-ray findings.") is True
        assert em._is_normal_study_statement("Normal awake record.") is True
        assert em._is_normal_study_statement("Within normal limits") is True
        assert em._is_normal_study_statement("Unremarkable") is True

    def test_real_diagnoses_untouched(self):
        assert em._is_normal_study_statement("Normal pressure hydrocephalus") is False
        assert em._is_normal_study_statement("Mild mucosal thickening") is False
        assert em._is_normal_study_statement("Headache") is False
        assert em._is_normal_study_statement(None) is False
        assert em._is_normal_study_statement("") is False


class TestAnatomySplit:
    def test_organ_matches_display_only(self):
        assert em._match_structure_term(em._ORGAN_TERMS, "PA VIEW OF CHEST") is None
        assert em._match_structure_term(em._ORGAN_TERMS, "CT SCAN OF THE HEAD") is None
        assert em._match_structure_term(em._ORGAN_TERMS, "Cardiac MRI") == "HEART"
        assert em._match_structure_term(em._ORGAN_TERMS, "left lung nodule") == "LEFT_LUNG"

    def test_chest_xray_snippet_maps_chest_not_heart(self):
        # P8-live regression: "cardiac silhouette" is not an organ hit
        # (organ matching excludes snippets); region matching still fires.
        display = "PA VIEW OF CHEST"
        snippet = "- Cardiac silhouette is normal.- Costophrenic angles are normal"
        assert em._match_structure_term(em._ORGAN_TERMS, display) is None
        assert em._match_structure_term(em._REGION_TERMS, f"{display} {snippet}") == "CHEST"

    def test_sinus_has_no_false_organ(self):
        # No SINUS structure exists (no new ontology per P8.1); the text
        # must not false-positive to any organ — FULL_BODY fallback stays.
        text = "MILD MUCOSAL THICKENING IN BILATERAL MAXILLARY AND ETHMOID SINUSES"
        assert em._match_structure_term(em._ORGAN_TERMS, text) is None
        assert em._match_structure_term(em._REGION_TERMS, text) is None


class TestDates:
    def test_authorised_date_wins(self):
        doc = {"authorisation": {"authorised_date": "2026-08-03"},
               "specimens": [{"collection_date": "2026-08-01"}]}
        assert str(em._document_date(doc)) == "2026-08-03"

    def test_specimen_fallback(self):
        doc = {"specimens": [{"collection_date": "2026-08-01"}]}
        assert str(em._document_date(doc)) == "2026-08-01"

    def test_encounter_fallback(self):
        doc = {"encounters": [{"encounter_date": "2026-08-03", "facility": "Valley Hospital"}]}
        assert str(em._document_date(doc)) == "2026-08-03"

    def test_garbage_yields_none_never_invented(self):
        assert em._document_date({}) is None
        assert em._document_date({"authorisation": {"authorised_date": "sometime"}}) is None


class TestPageEnvelope:
    def test_page_preserved(self):
        assert em._page_envelope(2) == {"page": 2}
        assert em._page_envelope("3") == {"page": 3}

    def test_none_never_fabricated(self):
        assert em._page_envelope(None) is None
        assert em._page_envelope("n/a") is None


class TestProviderMetadata:
    def test_known_person_names_collects_only_person_fields(self):
        from workers.ingestion_tasks import _known_person_names

        class _Patient:
            full_name = "Test Patient"

        class _FakeQuery:
            def filter(self, *a):
                return self

            def first(self):
                return _Patient()

        class _FakeDB:
            def query(self, *a):
                return _FakeQuery()

        extraction = {"document": {
            "patient": {"name": "Test Patient"},
            "requester": {"name": "Dr. P Saha", "organisation": "Valley Hospital"},
            "laboratory": {"name": "Valley Hospital"},
            "authorisation": {"reported_by": "Dr. Pradeep Hatimota", "verified_by": "Dr. X"},
            "sections": [{"section_title": "Findings"}],
        }}
        names = _known_person_names(_FakeDB(), uuid.uuid4(), extraction)
        assert "Test Patient" in names
        assert "Dr. P Saha" in names
        assert "Dr. Pradeep Hatimota" in names
        # Facility/org/section strings are NOT person identifiers.
        assert "Valley Hospital" not in names
        assert "Findings" not in names


class TestKnownNameVariants:
    def test_full_plus_tokens(self):
        from services.deidentification.deidentifier import DeIdentificationService

        variants = DeIdentificationService.known_name_variants(["MEHRAJ ALOM TAPADER"])
        assert variants[0] == "MEHRAJ ALOM TAPADER"
        assert {"MEHRAJ", "ALOM", "TAPADER"} <= set(variants)

    def test_initials_excluded(self):
        from services.deidentification.deidentifier import DeIdentificationService

        variants = DeIdentificationService.known_name_variants(["Dr. P Saha"])
        assert "P" not in variants
        assert "Saha" in variants

    def test_case_insensitive_dedupe_and_cap(self):
        from services.deidentification.deidentifier import DeIdentificationService

        variants = DeIdentificationService.known_name_variants(["Anna Bell", "anna bell", "Anna"])
        lowered = [v.lower() for v in variants]
        assert len(lowered) == len(set(lowered))
        many = DeIdentificationService.known_name_variants([f"Name{i} Person{i}" for i in range(100)])
        assert len(many) <= DeIdentificationService._MAX_KNOWN_VARIANTS


class TestDeIdentification:
    @pytest.fixture()
    def service(self):
        pytest.importorskip("presidio_analyzer")
        try:
            from services.deidentification.deidentifier import DeIdentificationService
            return DeIdentificationService(b"p8-1-test-secret")
        except Exception as e:  # pragma: no cover - model missing in CI
            pytest.skip(f"deid engine unavailable: {e}")

    # report1.pdf-derived table layout (P8-live miss shape).
    TABLE_HTML = (
        "<tr><td>Patient Name</td><td>MEHRAJ ALOM TAPADER</td>"
        "<td>Study Date</td><td>03-Aug-2026</td></tr>\n"
        "<tr><td>Finding</td><td>MILD MUCOSAL THICKENING</td></tr>\n"
        "<p>No evidence of intracranial hemorrhage.</p>"
    )

    def test_known_name_redacted_despite_analyzer_miss(self, service):
        # Force the P8-live mechanism: analyzer sees nothing.
        service.analyzer.analyze = lambda **kwargs: []
        result = service.deidentify(self.TABLE_HTML, extra_names=["MEHRAJ ALOM TAPADER"])
        assert "MEHRAJ" not in result.text
        assert "TAPADER" not in result.text
        assert result.validation_passed is True

    def test_clinical_terminology_preserved(self, service):
        result = service.deidentify(self.TABLE_HTML, extra_names=["MEHRAJ ALOM TAPADER"])
        assert "MUCOSAL THICKENING" in result.text
        assert "hemorrhage" in result.text

    def test_validator_catches_unredacted_known_name(self):
        from services.deidentification.validator import LeakageValidator

        res = LeakageValidator().validate("Patient MEHRAJ ALOM TAPADER", extra_names=["MEHRAJ ALOM TAPADER"])
        assert res.passed is False
        # Error strings must not carry identifier values (workers log them).
        assert "MEHRAJ" not in " ".join(res.errors)

    def test_validator_passes_clean_text(self):
        from services.deidentification.validator import LeakageValidator

        res = LeakageValidator().validate("No evidence of hemorrhage.", extra_names=["MEHRAJ ALOM TAPADER"])
        assert res.passed is True


class _FakeHits:
    def __init__(self, hits):
        self._hits = hits

    @property
    def points(self):
        return self._hits


class _FakeHit:
    def __init__(self, pid, doc, idx, text, score=0.9):
        self.id = f"{doc}:{idx}"
        self.score = score
        self.payload = {"patient_id": pid, "document_id": doc, "chunk_index": idx, "text": text}


class _FakeQdrant:
    def __init__(self, hits):
        self.hits = hits
        self.seen_filters = []
        self.seen_limits = []

    def query_points(self, collection_name, query, query_filter, limit, with_payload):
        self.seen_filters.append(query_filter)
        self.seen_limits.append(limit)
        return _FakeHits(self.hits)


def _must_keys(query_filter):
    return [c.key for c in query_filter.must]


class TestQdrantSearch:
    def _search(self, hits, **kwargs):
        from services.vectorization.vector_indexing import search_evidence_chunks

        client = _FakeQdrant(hits)
        out = search_evidence_chunks(
            client=client, collection_name="c", query_vector=[0.1, 0.2],
            patient_id="pat-1", **kwargs,
        )
        return out, client

    def test_patient_filter_mandatory_and_citation_envelope(self):
        hit = _FakeHit("pat-1", "doc-1", 0, "No evidence of hemorrhage.")
        out, client = self._search([hit])
        assert "patient_id" in _must_keys(client.seen_filters[0])
        assert out[0]["node_id"] == "document:doc-1"
        assert out[0]["quote"] == "No evidence of hemorrhage."
        assert out[0]["evidence_level"] == "SOURCE_FACT"

    def test_document_scope_adds_filter(self):
        out, client = self._search([], document_id="doc-9")
        assert out == []
        keys = _must_keys(client.seen_filters[0])
        assert keys == ["patient_id", "document_id"]

    def test_allow_list_empty_short_circuits(self):
        from services.vectorization.vector_indexing import search_evidence_chunks

        client = _FakeQdrant([_FakeHit("pat-1", "doc-1", 0, "x")])
        out = search_evidence_chunks(
            client=client, collection_name="c", query_vector=[0.1],
            patient_id="pat-1", allowed_document_ids=set(), limit=10,
        )
        assert out == []
        assert client.seen_filters == []

    def test_limit_bounded(self):
        _, client = self._search([], limit=500)
        assert client.seen_limits == [50]


class TestRetrieveEvidence:
    def _run(self, monkeypatch, hits, embed=None, live_ids=None):
        import asyncio

        import services.vectorization.vector_indexing as vi

        async def fake_embed(texts):
            return [[0.1, 0.2] for _ in texts]

        client = _FakeQdrant(hits)
        monkeypatch.setattr(vi, "vector_db", type("V", (), {"client": client, "collection_name": "c"})())
        monkeypatch.setattr(vi, "live_document_ids", lambda db, pid: live_ids if live_ids is not None else {"doc-1"})

        async def _go():
            return await vi.retrieve_evidence(
                object(), uuid.uuid4(), "headache",
                embed_fn=embed or fake_embed,
            )

        return asyncio.run(_go()), client

    def test_hits_returned(self, monkeypatch):
        out, _ = self._run(monkeypatch, [_FakeHit("p", "doc-1", 0, "Headache noted.")])
        assert isinstance(out, list) and out[0]["document_id"] == "doc-1"

    def test_embedding_failure_degrades(self, monkeypatch):
        async def boom(texts):
            raise RuntimeError("down")

        out, _ = self._run(monkeypatch, [], embed=boom)
        assert "temporarily unavailable" in out["message"]

    def test_empty_query_rejected(self, monkeypatch):
        import asyncio

        import services.vectorization.vector_indexing as vi

        async def _go():
            return await vi.retrieve_evidence(object(), uuid.uuid4(), "  ")

        out = asyncio.run(_go())
        assert "INVALID_QUERY" in out["error"]

    def test_all_docs_deleted_yields_no_data(self, monkeypatch):
        out, client = self._run(
            monkeypatch, [_FakeHit("p", "doc-9", 0, "stale")], live_ids=set()
        )
        assert "message" in out and client.seen_filters == []


class TestChunkIdempotency:
    def test_deterministic_ids(self):
        from services.vectorization.vector_indexing import chunk_point_id

        doc = "44b4a80e-d147-4026-9b25-dac2d1987f5e"
        assert chunk_point_id(doc, 0) == chunk_point_id(doc, 0)
        assert chunk_point_id(doc, 0) != chunk_point_id(doc, 1)
        assert chunk_point_id(doc, 0) != chunk_point_id("other-doc", 0)

    def test_reindex_converges_no_duplicates(self):
        import asyncio

        import services.vectorization.vector_indexing as vi

        class _FakeEmbed:
            async def generate_embeddings(self, texts):
                return [[float(len(t))] * 4 for t in texts]

        class _FakeClient:
            def __init__(self):
                self.store = {}
                self.deletes = 0

            def delete(self, collection_name, points_selector):
                self.deletes += 1

            def upsert(self, collection_name, points):
                for p in points:
                    self.store[p.id] = p

        svc = vi.VectorIndexingService.__new__(vi.VectorIndexingService)
        svc.client = _FakeClient()
        svc.collection_name = "c"
        svc.embedding_service = _FakeEmbed()
        from services.vectorization.chunker import MarkdownChunker
        svc.chunker = MarkdownChunker()

        pid, did = uuid.uuid4(), uuid.uuid4()
        md = "# Report\n\nFinding one paragraph here.\n\nFinding two paragraph here."

        async def _go():
            n1 = await svc.index_markdown_file(pid, did, md)
            n2 = await svc.index_markdown_file(pid, did, md)
            return n1, n2

        n1, n2 = asyncio.run(_go())
        assert n1 == n2 == len(svc.client.store)
        assert svc.client.deletes == 2


class _FakeQuery:
    def __init__(self, first=None, all_rows=None):
        self._first = first
        self._rows = list(all_rows) if all_rows is not None else ([first] if first is not None else [])
        self.deleted = 0

    def filter(self, *args):
        # Honor simple `Model.attr == value` comparisons so tests can
        # stage patient/event-scoped rows like the real queries do.
        # (SQLAlchemy wraps the value in a BindParameter — unwrap it.)
        for cond in args:
            left = getattr(cond, "left", None)
            right = getattr(cond, "right", None)
            key = getattr(left, "key", None)
            if key is None:
                continue
            # BindParameter carries .value (and a generated .key);
            # real columns carry .table — those can't be evaluated here.
            if hasattr(right, "table"):
                continue
            value = getattr(right, "value", right)
            if value is None:
                continue
            self._rows = [r for r in self._rows if getattr(r, key, None) == value]
        return self

    def order_by(self, *args):
        return self

    def first(self):
        return self._rows[0] if self._rows else None

    def all(self):
        return list(self._rows)

    def delete(self, synchronize_session=False):
        self.deleted += 1
        return 1


class _FakeDB:
    def __init__(self, event=None, obs=None, cond=None, meas=None):
        self._rows = {
            "ClinicalEvent": event,
            "AnatomicalObservation": obs if isinstance(obs, list) else ([obs] if obs is not None else []),
            "ConditionOccurrence": cond,
            "Measurement": meas,
        }
        self.added = []
        self.flushed = False
        self.deleted_rows = []
        self._queries = []

    def query(self, model):
        self._queries.append(model.__name__)
        name = model.__name__
        if name == "AnatomicalObservation":
            return _FakeQuery(all_rows=self._rows[name])
        if name == "EvidenceLink":
            return _FakeQuery()
        if name == "PatientBodyStateSnapshot":
            return _FakeQuery(all_rows=self._rows.get(name, []))
        row = self._rows.get(name)
        return _FakeQuery(all_rows=[row] if row is not None else [])

    def delete(self, row):
        self.deleted_rows.append(row)

    def add(self, row):
        self.added.append(row)

    def flush(self):
        self.flushed = True


class _FakeRow:
    """Attribute bag standing in for ORM rows in filter-aware fakes."""

    def __init__(self, **attrs):
        for key, value in attrs.items():
            setattr(self, key, value)


class TestRetireDocumentEvent:
    def _svc(self):
        from services.clinical import corrections
        return corrections

    def _db(self, pid, eid, event=True, obs=(), cond=None, meas=None, snaps=()):
        db = _FakeDB(
            event=_FakeRow(event_id=eid, patient_id=pid) if event else None,
            obs=list(obs),
            cond=cond,
            meas=meas,
        )
        db._rows["PatientBodyStateSnapshot"] = list(snaps)
        return db

    def test_missing_event_raises_lookup(self):
        with pytest.raises(LookupError):
            self._svc().retire_document_event(_FakeDB(event=None), uuid.uuid4(), uuid.uuid4())

    def test_dependents_raise_conflict(self):
        for dep in ("cond", "meas"):
            pid, eid = uuid.uuid4(), uuid.uuid4()
            row = _FakeRow(source_event_id=eid)
            kwargs = {"event": True, "obs": [], "cond": None, "meas": None}
            kwargs[dep] = row
            db = self._db(pid, eid, **kwargs)
            with pytest.raises(Exception) as exc:
                self._svc().retire_document_event(db, pid, eid)
            assert "dependents" in str(exc.value)

    def test_manual_observation_blocks_but_auto_observation_retires(self):
        from models.outbox import OutboxEventType

        pid, eid = uuid.uuid4(), uuid.uuid4()
        manual = _FakeRow(observation_id=uuid.uuid4(), event_id=eid, source_id="something-else")
        db = self._db(pid, eid, obs=[manual])
        with pytest.raises(Exception) as exc:
            self._svc().retire_document_event(db, pid, eid)
        assert "anatomical_observations" in str(exc.value)

        auto = _FakeRow(
            observation_id=uuid.uuid4(), event_id=eid, source_id=str(eid),
            structure_id="HEAD", clinical_summary="s", visual_status="N",
            visual_severity_score=0.0, trend="S", recorded_at=1, ingested_at=1,
        )
        db = self._db(pid, eid, obs=[auto])
        out = self._svc().retire_document_event(db, pid, eid, reason="t")
        assert out["retired_nodes"] == ["TimelineEvent", "Observation"]
        assert db.flushed is True
        retired = [r for r in db.added if getattr(r, "event_type", None) == OutboxEventType.GRAPH_NODE_RETIRED]
        assert sorted(r.payload["node_label"] for r in retired) == ["Observation", "TimelineEvent"]
        assert auto in db.deleted_rows

    def test_snapshot_repointed_to_surviving_observation(self):
        pid, eid = uuid.uuid4(), uuid.uuid4()
        doomed_id, kept_id = uuid.uuid4(), uuid.uuid4()

        def _obs(oid, auto=True):
            return _FakeRow(
                observation_id=oid, event_id=eid,
                source_id=str(eid) if auto else "other-event",
                structure_id="HEAD", clinical_summary=f"summary-{oid}",
                visual_status="NORMAL", visual_severity_score=0.0, trend="STABLE",
                recorded_at=2 if oid == kept_id else 1,
                ingested_at=2 if oid == kept_id else 1,
            )

        # Survivor belongs to another event: not deleted, but eligible as
        # the snapshot's new pointer (same patient + structure).
        kept = _obs(kept_id, auto=False)
        kept.event_id = uuid.uuid4()
        kept.patient_id = pid
        snap = _FakeRow(
            patient_id=pid, latest_observation_id=doomed_id, latest_summary="old",
            visual_status="X", visual_severity_score=9.0, trend="Y",
            observation_recorded_at=0, observation_ingested_at=0,
        )
        db = self._db(pid, eid, obs=[_obs(doomed_id), kept], snaps=[snap])
        out = self._svc().retire_document_event(db, pid, eid, reason="t")
        assert out["retired_nodes"] == ["TimelineEvent", "Observation"]
        assert snap.latest_observation_id == kept_id
        assert snap.latest_summary == f"summary-{kept_id}"

    def test_snapshot_dropped_when_nothing_remains(self):
        pid, eid = uuid.uuid4(), uuid.uuid4()
        doomed_id = uuid.uuid4()
        doomed = _FakeRow(
            observation_id=doomed_id, event_id=eid, source_id=str(eid), structure_id="HEAD",
        )
        snap = _FakeRow(patient_id=pid, latest_observation_id=doomed_id)
        db = self._db(pid, eid, obs=[doomed], snaps=[snap])
        self._svc().retire_document_event(db, pid, eid, reason="t")
        assert snap in db.deleted_rows
