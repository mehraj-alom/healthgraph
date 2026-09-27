# Play Launch Readiness — HealthGraph (Android, Germany)

Target: Google Play Console, Germany storefront. Apple findings are out of
scope (no iOS build). Produced with the `app-store-compliance` playbook
(mjmirza/app-store-compliance): automated guard + manual verification of
every finding against this repo. Scanner claims without repo evidence are
marked FALSE POSITIVE — the document states what is true, not what a
regex feared.

Status legend: DONE (true in repo) · DOC (paperwork/console, no code) ·
TODO (needs work) · N/A (not applicable, with reason).

## 1. Guard verdict, triaged

| # | Finding | Verdict | Action |
|---|---------|---------|--------|
| 1 | GOOGLE-ORG-REGISTRATION (health → org + D-U-N-S) | REAL, BLOCKER | DOC: publish from an organization Play account with matching D-U-N-S before submission |
| 2 | Play package-name registration (developer verification) | REAL, BLOCKER | DOC: register `com.medgraph.app` in Play Console; complete developer verification |
| 3 | GOOGLE-MISSING-PRIVACY-POLICY (no policy URL in sources) | REAL, BLOCKER | DOC: publish privacy policy, set URL in listing + link in-app (ProfileSheet PRIVACY_COPY has copy but no URL) |
| 4 | GOOGLE-DATASAFETY-MISMATCH | REAL, BLOCKER | DOC: file the Data Safety form from §4 below; no analytics SDK exists, declare truthfully |
| 5 | GOOGLE-12-TESTER-RULE (new personal accounts) | REAL if personal account | DOC: 12 testers × 14 days closed test, or use an established/organization account |
| 6 | Demo/test credentials for review | GAP | DOC: provide a working demo account + keep staging backend up through review |
| 7 | RUNTIME-PERMISSIONS rationale | DONE | Camera/Notifications rationale screens exist; denials handled (FoodScan, PPG, reminders) |
| 8 | OVERLAY-TAPJACKING (SYSTEM_ALERT_WINDOW merged) | TODO-VERIFY | No source declares it; likely merged from a library manifest. Verify via manifest-merger report in a release build; if unused, strip with a `tools:node="remove"` config-plugin entry |
| 9 | R8 minify/shrink | TODO-VERIFY | Release uses `enableMinifyInReleaseBuilds` flag (default off); confirm mapping/R8 in the GHA-built AAB before submit (playbook deadline Feb 2027 — verify now anyway) |
| 10 | EU AI Act transparency (AI chat) | GAP | 1-LINE FIX + DOC: "Answers are AI-generated" disclosure in chat UI; no high-risk use, wellness-only |
| 11 | OFF attribution (ODbL) | GAP | 1-LINE: "Data: © Open Food Facts contributors" in About + keep result-sheet source note |
| 12 | Impressum (§ 5 DDG) | GAP | DOC: legal notice screen/section before German listing goes live |
| 13 | DPA with hoster / GDPR Art. 9 pack | GAP | DOC: AV-Vertrag, privacy policy naming health data, retention doc (§5) |
| 14 | Data export (Art. 20 portability) | GAP | No export feature exists (deletion does). DOCide: build CSV export or document why deletion-only suffices for now |
| 15 | GOOGLE-PLAY-BILLING / DONATION-LINK | FALSE POSITIVE | premium.ts is an isolated stub ("no billing backend yet", locked Free tier); no payment/donation SDK or link in the app |
| 16 | APPLE-GAMBLING-BRAZIL-LICENSE | FALSE POSITIVE | Keyword match, no gambling product; Apple-only in any case |
| 17 | BOTH-UNSAFE-DEEPLINK | FALSE POSITIVE | No custom scheme in app.json; no deep-link surface |
| 18 | WEB-LOCAL-STORAGE / WEB-TRACKING | N/A | No web build shipped; nothing in localStorage |
| 19 | RESTORE-CREDENTIALS (2027) | NOTE | Play technical-quality requirement from April 2027 — backlog, not launch-blocking |
| 20 | Age gate / USK | DOC | No age gate in signup; answer the Play IARC questionnaire honestly (health + AI chat); consider 16+ positioning for Germany |

## 2. Health-data inventory (what the privacy policy + Data Safety form must say)

PostgreSQL (server, per-patient isolation everywhere): patients,
clinical_events, lab_results, measurements, medication_events,
medications, medication_taken_events, medication_versions, documents +
document_blobs (bytes), food_scans + food_entries, ppg_measurements,
visits, condition_occurrences, patient_statements, conversation_threads
(chat history), patient_daily_summaries, patient_health_summaries,
daily_health_entries, providers, facilities, evidence_links,
raw_extraction, audit_events, idempotency_keys, consent_receipts,
data_subject_requests, graph_sync_outbox. Reference only:
anatomical_structures, body_regions, medical_concepts, medical_aliases.

SQLite (device, per-patient, SQLCipher): daily_logs, daily_log_events,
medications, medication_taken_events, ppg_measurements,
rppg_measurements, food_scan_items (incl. barcode digits),
documents (metadata), observations, cycle_entries, substance_entries,
scan_sessions, onboarding_state, profile_cache, hydration_state,
trends/daily_metrics caches, sync_queue, reminder_instances.

Neo4j Aura (graph projection, patient-scoped MERGE): Patient, Visit/Day,
Measurement incl. PPGMeasurement(method), NutritionIntake, FoodScan,
Medication + taken events, Condition, Statement, Observation,
Document/Report anchors.

Qdrant (embeddings for retrieval; vectors only, text stays in Postgres).

Never stored: meal/document photo bytes (hashed in transit only),
camera frames/video (PPG/rPPG scalars only), microphone audio (voice
turns transcribed in RAM, never written), raw PPG streams.

## 3. Third-party data flows (Data Safety truth table)

| SDK / service | Data sent | Identifiers | Why |
|---|---|---|---|
| Firebase Auth | email, auth tokens | Firebase UID | sign-in only |
| Backend API (own VPS) | all health tables above | Firebase UID → patient_id | the product itself |
| Open Food Facts (via backend proxy) | barcode digits only | server IP only, never the user | packaged nutrients |
| USDA (server-side) | dish label text | server IP only | generic-dish nutrients |
| AICREDITS/OpenAI-compatible VLM (server-side) | meal photo (single request) | server IP only | dish detection |
| Neo4j Aura / Qdrant (server-side) | graph nodes / vectors | internal patient_id | correlations, chat context |
| Pakeet sidecar (localhost-only) | voice turn audio (RAM only) | none persisted | transcription |
| expo-asset CDN (own VPS /assets) | none (downloads only) | none | anatomy GLB, RPPG model |
| Analytics / ads / crashlytics | NONE — no such SDK in package.json | — | declare "no analytics" truthfully |

Photos/audio/frames never leave the device except the single VLM meal
photo and the single voice-turn upload, both over TLS to our own backend.

## 4. Play Data Safety draft (verify at filing time)

- Health and fitness data (vitals, meds, meals, sleep, symptoms, docs):
  collected, required for features, stored on device + account, NOT
  shared with third parties, NOT sold. Deletion: in-app Settings →
  Delete account (verified in code).
- Personal info (email): collected for sign-in, not shared, deletable.
- Photos (meal scan): processed per-request, never stored.
- Microphone (voice turns): processed per-request, never stored.
- Data encrypted in transit (TLS) and at rest (SQLCipher device,
  Postgres at rest, TLS to Aura/Qdrant).
- No analytics, no ads, no data sale, no profiling for third parties.

## 5. Permissions (manifest truth)

app.json declares only POST_NOTIFICATIONS + SCHEDULE_EXACT_ALARM.
CAMERA arrives via the PPG/RPPG config plugins + expo-camera defaults,
requested at moment-of-use with rationale screens and Settings fallback.
No location, microphone (voice turns use expo-audio recording — declare
microphone at filing: foreground voice-turn recording only), contacts,
or storage permissions.

## 6. Pre-submit order (do in this sequence)

1. Org Play account + D-U-N-S; register package; complete developer verification.
2. Privacy policy live; URL in listing + in-app link; ODbL credit line; Impressum.
3. Data Safety form from §4; Health-apps declaration; honest IARC answers.
4. Demo account + staging uptime through review; closed test if required.
5. One-line AI disclosure in chat; verify overlay-permission source; confirm R8 in the AAB.
6. DPA signed; GDPR pack (§5 of prior report); keep HWG/MDR wellness posture (no dosing/diagnosis claims — especially around BE/diabetes features).

Method note: guard says BLOCKED on 4 criticals; #1–#2 above are two of
them (US-billing/Apple-CTC criticals don't apply). The remaining two
are jurisdiction informational entries, not repo defects.
