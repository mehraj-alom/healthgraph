# MedGraph Engineering Audit

Status is based on source inspection on 2026-08-29. “Fixed” means changed in
this working tree; it does not claim validation against unavailable services.

| Severity | File(s) | Exact problem / why it fails | Recommended fix | Status |
|---|---|---|---|---|
| Critical | `frontend/src/screens/VitalsLogger/VitalsLoggerScreen.tsx` | The logger embedded fabricated UUIDs for glucose, pulse, a “full body” region, and a made-up symptom concept. The IDs fail unless a matching ad-hoc seed has run and conflate clinical metrics with anatomy. | Resolve real canonical concepts by terminology/code from the backend; submit only `DailyCheckInRequest`; do not create a body-state observation for generic vitals. | **Fixed** |
| Critical | `scripts/seed_medical_concepts.py` | The prior seed used placeholder UUIDs and created a fake full-body `BodyRegion`. It also did not seed aliases. | Idempotently seed a limited shared terminology/code vocabulary and aliases; let PostgreSQL allocate IDs. | **Fixed** (`services/ontology_seed.py`) |
| Critical | `app/api/v1/daily_logs.py`, `app/api/v1/timeline.py` | Manual vital events were stored, but Timeline only joined `LabResult`, so a saved manual value was invisible. Invalid concept IDs could result in a database error. | Validate active concepts before event creation; expose manual vital payloads and daily notes through Timeline. | **Fixed** |
| High | `frontend/src/context/AuthContext.tsx` | Firebase persistence existed, but the app also persisted Firebase ID and refresh tokens itself, creating a misleading parallel token store. Backend sync did not occur on every restored session/token state. | Firebase owns persistence and refresh; Axios asks the current Firebase user for an ID token; sync idempotently when Firebase token state changes. | **Fixed** |
| High | `core/security.py`, `app/api/dependencies.py` | Two Firebase verification paths returned different identities (UID vs canonical PostgreSQL patient UUID), risking inconsistent tenant boundaries. | Make `get_authenticated_patient_id` the only path. | **Fixed**; compatibility module now exports only the canonical dependency. |
| High | `app/main.py`, `app/api/v1/*.py` | Historical `/v1` versus `/api/v1` mismatch was the source of 404 reports. Current route declarations are consistently `/api/v1`; daily log and system logs no longer collide. | Maintain `/api/v1` uniformly and check OpenAPI in the service environment. | **Verified in source**; runtime OpenAPI blocked by missing local Python dependencies. |
| High | `docker-compose.yml` | The compose file starts API/Celery but no PostgreSQL, Redis, Qdrant, or Neo4j services. It relies on externally provisioned endpoints from `.env`, so a clean `docker compose up` is not end-to-end. | Either document/require managed service URLs or add explicitly configured development dependencies. | **Blocked / deployment decision** |
| High | migrations | No Alembic environment or migration history is present, while schema is created with `Base.metadata.create_all()`. Schema evolution (including the new daily-note payload table) is not reviewable/deployable as a migration. | Establish Alembic before production data schema changes; baseline the existing schema. | **Blocked / architecture work** |
| Medium | `frontend/src/screens/Dashboard/DashboardScreen.tsx` | A primitive mesh was labelled “Real-time 3D visualization”; empty body state was presented as “Normal.” | Render only the authoritative read model and show unavailable/empty state honestly until the model/registry contract is validated. | **Fixed** |
| Medium | `frontend/src/screens/Timeline/TimelineScreen.tsx` | Timeline had loading/empty UI but no error UI and did not render manual vital values. | Add error/retry state and manual payload rendering. | **Fixed** |
| Medium | `app/api/v1/body_state.py`, `services/ocr/extraction_mapper.py` | `/body-state/log` is valid but must be used only with a real anatomy registry structure ID. OCR currently falls back to `FULL_BODY` when no mapping is found; that is an unsafe fabricated mapping if the registry does not contain it. | Keep Vitals off this endpoint; replace OCR fallback with explicit unmapped/review handling after registry/asset validation. | **Open** |
| Medium | `frontend/src/assets/models/human_body.glb`, anatomy registry | A GLB file exists, but no code loads it and no verified registry-to-node inventory was found. | Validate asset node names against seeded `AnatomicalStructure` records, then implement a real renderer; do not fabricate mappings. | **Needs real asset/registry validation** |
| Medium | `app/api/v1/documents.py`, OCR workers | Upload persists a document and queues Celery, but no frontend Documents route exists. Successful OCR depends on Redis/Celery, OCR provider/model configuration, Qdrant, and Neo4j being reachable. | Add a Documents UI only after the worker pipeline is exercised with real credentials/services; expose document status safely. | **Blocked by external services/UI scope** |
| Medium | `app/api/v1/chat.py` | Chat correctly derives the patient ID server-side, but invokes LangGraph infrastructure at runtime. Checkpoint serialization warnings cannot be evaluated without the configured Postgres checkpoint service. | Run authenticated chat against the deployed stack and inspect worker/API logs; do not suppress serialization warnings blindly. | **Needs external service validation** |
| Low | `frontend/src/screens/{Dashboard,Timeline,VitalsLogger,Chat}` | Several screens used deprecated React Native `SafeAreaView`. | Use `react-native-safe-area-context`, already installed. | **Fixed** |
| Low | Three/EXGL warnings | Placeholder Canvas was the only active dashboard 3D renderer. No evidence was found for a validated GLB renderer. | Revisit `THREE.Clock`, `PCFSoftShadowMap`, and EXGL only with the real rendering implementation/device logs. | **Deferred; placeholder renderer removed** |

## Implemented API contracts

- `POST /api/v1/auth/sync` — Firebase ID token only; patient identity is resolved server-side.
- `GET /api/v1/ontology/manual-log-concepts` — authenticated source for manual logger concept IDs.
- `POST /api/v1/logs/daily-checkin` — canonical daily-log event writer. Supports wellbeing, sleep, nutrition, symptoms, vitals, pain, activities, medications, and an optional free-text daily note.
- `GET /api/v1/timeline` — includes manual vital payloads and daily notes in addition to lab/evidence data.

## Validation recorded

- Passed: `python3 -m compileall -q app core models schemas services scripts agents workers`
- Passed: `cd frontend && npx tsc --noEmit`
- Passed: `git diff --check`
- Blocked: importing `app.main` / inspecting live OpenAPI locally fails before app initialization because `langchain_core` is not installed in this workspace Python environment.
- Not run: authenticated HTTP checks, Docker logs, Android flow, database seed execution, OCR/Celery/Qdrant/Neo4j checks. They require the configured service stack and Firebase credentials, which were not inspected or changed.

## Required deployment follow-up

1. Run `python -m scripts.seed_medical_concepts` in the API environment (startup also runs the idempotent seed).
2. Add/execute a reviewed migration for `payload_patient_notes` before production deployment; do not rely on `create_all` for managed production schemas.
3. Verify `/openapi.json`, Firebase-authenticated requests, and service logs against the real Docker environment.
4. Validate the actual GLB node inventory and anatomy registry before enabling a 3D body UI.
