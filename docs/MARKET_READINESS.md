# HealthGraph — Market Readiness: What Shipped vs What Rich Markets Demand

Date: 2026-10-15 · Branch: `rea` (pushed to `origin/rea`) · Audience: founder + reviewers
Scope: Germany-first EU launch, with US / UK / France / Nordics / Gulf expansion notes.
“Rich markets” here = high health-spend, high-regulation markets (DE, FR, UK, US,
CH, Nordics, Gulf states). Claims marked *(approx.)* are working estimates, not filings.

Related: `competitor-teardown.html` (per-engine teardown), `REVIEW_NOTES.txt`
(submission pack), `docs/compliance/PLAY_LAUNCH_READINESS.md` (blockers),
`docs/GAP_ANALYSIS.md` (this week's gap audit, local-only).

---

## 1. Executive summary

In this cycle HealthGraph closed its six most review-visible gaps: meditation,
data export, exercise distance, reviewer demo, FHIR import, and billing wiring —
plus every code-side Play launch one-liner. The app is **submittable** (tsc clean,
test suites green, honest fallbacks everywhere) but **not yet competitive** with
the incumbents of rich markets. The remaining work splits into three buckets:

| Bucket | Owner | Effort | Blocks revenue? |
|---|---|---|---|
| A. Paperwork (account, D-U-N-S, policy, Impressum, Data Safety, DPA) | You | days | YES — cannot list without it |
| B. Device proof (CI green, physical-device pass, AAB checks) | CI + device | days | YES — review risk |
| C. Market moat (ePA depth, DiGA decision, iOS, wearables, telehealth) | Engineering | quarters | NO — but caps ARPU/retention |

The single most important market fact: **rich markets are iPhone-heavy** *(DE ~40%+
iOS, US/UK majority iOS, Gulf overwhelmingly iOS)* and every competitor below
ships both platforms. Android-only is acceptable for a German test launch; it is
a growth ceiling everywhere else.

---

## 2. What was DONE (this cycle, on `rea`)

All items below are committed, pushed, type-checked (`tsc --noEmit` clean),
and unit-tested. “Verified” = node/pytest suites; “NOT verified” = no device run yet.

### 2.1 Meditation engine (closes a marketing-claim gap)
- Bell-timed sits (5/10/15/20), start/end chime over the shared generated asset,
  per-sit log (duration, timestamps, note), totals + 7-day strip, daily nudge
  (off by default), HealthAreas tile + engine catalog + onboarding goal/focus,
  DisciplineEngine day-union feed. Device-only SQLite (migration 22), glass/
  token/Card UI, German + English marketplace copy already in the web funnel.
- Verified: 21/21 new node tests (incl. real-SQLite round-trip). NOT verified: audio on device.

### 2.2 User CSV export (Art. 20 portability)
- One long-format CSV (`date,domain,metric,value,unit,note`) over 10 device
  domains, OS share sheet, temp file wiped after share, Settings entry beside
  Danger Zone. This is what Meditate/OpenTracks users expect; Barmer/AOK users
  get it via ePA.
- Verified: 11/11 new node tests. NOT verified: share sheet on device.

### 2.3 Exercise distance + pace (narrows the running-app gap)
- Health Connect Distance records summed per session (containment), `distance_km`
  through payload → types → Fitness math, pace as `m:ss/km`, manual km field in
  check-in, consent + disclosure updated. No location permission, no new SDK.
- Verified: 12/12 new node tests; full-suite comparison shows zero regressions
  (and two pre-existing suite breakages fixed along the way).
  NOT verified: live HC Distance read on device.

### 2.4 Reviewer demo sandbox (de-risks review itself)
- Fixed demo patient id, in-memory identity shadow (SecureStore untouched), six
  sync-engine no-upload guards, deterministic seed (7 logs / 2 meds / 4 doses /
  5 sits, reminders OFF, notes labeled sample), Onboarding “Try the demo”,
  global banner + wipe-on-exit. Reviewers need no account, no staging, no network.
- Verified: 10/10 new node tests. NOT verified: reviewer walkthrough on device.

### 2.5 FHIR Bundle import (first ePA-compatible surface)
- `.json` accepted end-to-end (picker → validator with BOM/whitespace-tolerant
  sniff → worker branch past OCR), pure stdlib parser (MedicationStatement/
  Request + lab/vital Observations, LOINC-preferred, narrative-blind, DoS-capped),
  projection through the clinical services with per-resource savepoints and
  dedupe, COMPLETED status, Qdrant-indexed import log. No schema change, no
  network, no OAuth.
- Verified: 13/13 pytest + `py_compile` clean. NOT verified: against a real
  ePA/IPS export file, no backend boot here.

### 2.6 Play Billing wiring (revenue path, inert until configured)
- Server truth (`patients.premium_tier/expires_at` + chained Alembic migration),
  `POST /billing/verify` against the Play Developer API (503 unconfigured,
  409 unpaid — never grants blind), tier in profile GET (pre-migration safe),
  client catalog + provider port (stub active), PricingScreen paid flow with
  never-trap fallbacks, server refresh in `premium.ts`.
- Verified: 9/9 node + pytest green. NOT verified: real purchase (needs Console
  products + store SDK + signed build).

### 2.7 Release one-liners + hygiene
- AI-generation disclosure in chat (EU AI Act), OFF/ODbL credit (About + barcode
  sheets), privacy/Impressum link rows (hidden until you publish the URLs),
  stray files deleted, `REVIEW_NOTES.txt` submission pack.
- tsc clean; pyflakes clean on touched backend modules.

---

## 3. Competitor map — rich markets only

| Competitor | Home market | Why it wins there | HealthGraph vs it today |
|---|---|---|---|
| TK-App / TK-Safe (ePA) | DE | Statutory insurer + ePA record + vaccinations + reminders | No ePA read; FHIR file import is a bridge, not parity |
| Barmer eCare + 7Mind + Teledoktor | DE | ePA + eRx + meds interaction + demo mode + video doctor | We match demo mode + reminders; missing eRx redeem, interaction check, video |
| AOK Mein Leben (ePA) | DE | ePA + digital package inserts (diGItal pilot) | Missing inserts + eRx |
| Doctolib | FR/DE/IT | Booking + video + messaging + family + 4.6★ | No booking/telehealth/messaging at all |
| Shop Apotheke (e-Rezept) | DE/NL | E-prescription redemption + delivery | Paper-Rx scan only |
| Apple Health / HealthKit | US/EU premium | OS-level passive data, 1000+ integrations, doctor sharing | Android-only; HC steps/sleep/exercise/weight only |
| Google Fit / Health Connect ecosystem | Global Android | Passive sensing backbone | Partial (4 record types, no routes/stages) |
| Fitbit (Google) | US/EU | Sleep stages, readiness, premium content | No stages, no readiness, no content library |
| Withings | FR/EU premium | Clinical-grade devices + RPM credibility | No device integrations |
| Garmin Connect | DACH/US sport | Serious-athlete depth | Logged sessions only |
| Flo / Clue | Global femtech | Predictions + education + 100M+ users | Basic device-only cycle log |
| Calm / Headspace | US/UK | Content libraries + B2B2C employer deals | Timer only, zero content |
| MyFitnessPal / Yazio (DE HQ) | US/DE | Barcode DB + recipes + plans | Photo + barcode + rings; no recipes/plans |
| 7Mind (DE) | DE | Bundled via Barmer 12-months-free | No meditation content |
| NHS App | UK | Records + prescriptions + booking in one state app | No UK integration story |
| OpenTracks / Meditate | Privacy niche | Local-first trust, F-Droid distribution | Privacy parity or better; narrower scope each |

Pattern: **incumbents bundle records + prescriptions + appointments + content**.
HealthGraph's differentiator (one cross-domain graph + RAG chat + privacy) is real
but invisible until the table-stakes rows above stop losing comparisons.

---

## 4. What rich markets specifically demand (and where we stand)

### 4.1 Germany (launch market) — the hardest checklist, highest trust payoff
- [x] German copy in funnel (`healthgraph_web` DE locale) + € pricing tiers
- [x] Impressum + privacy link *slots* (URLs still yours to publish)
- [x] EU AI Act chat disclosure; ODbL credit; no-analytics posture
- [ ] **ePA depth**: file import shipped; live ePA (gematik: smartcard/Konnektor/
  certification) is a company-level project, not a feature — plan as H2
- [ ] **DiGA decision** (BfArM digital-health-app listing, reimbursable by insurers):
  the single biggest German distribution unlock (doctor-prescribed apps). Requires
  evidence (RCT-grade studies), certified QM, and BSI-grade security proof. Decide:
  pursue (18–24 mo) or position as wellness (no medical claims — current posture ✓)
- [ ] USK/IARC age rating honest answers; 16+ positioning
- [ ] DPA (AV-Vertrag) with hoster; Art. 9 records; retention doctrine
- [ ] DiGital-style digital package inserts; interaction checker (AOK/Barmer parity)

### 4.2 France — Doctolib country
- Doctolib owns booking + teleconsultation mindshare; Withings owns device trust.
  Without booking/messaging/telehealth integrations HealthGraph is a second app,
  not a replacement. French (FR) localization missing — EN/DE only today.

### 4.3 UK — state-app + DTAC bar
- NHS App sets the “records + repeat prescriptions + booking” expectation; DTAC
  (Digital Technology Assessment Criteria) governs NHS procurement. Consumer path
  needs no DTAC, but any B2B2C/NHS claim does.

### 4.4 US — scale + HIPAA + employer channel
- HIPAA-compliant posture required for any provider/employer deal (BAA chain,
  audit controls beyond GDPR pack). Consumer wellness path viable without it.
- Calm/Headspace monetize via employers — our pricing (€11/18) is consumer-only;
  no B2B tier, no web dashboard for coaches/HR.

### 4.5 Nordics + Gulf — high spend, high iOS
- iOS dominance makes Android-only a near-total blocker. Localization (AR for
  Gulf), RTL layout, and local payment methods (beyond Play billing) apply.

### 4.6 Cross-market table stakes still missing (all rich markets)
1. **iOS app** — the growth ceiling. Shared KMP/domain work helps only if an iOS
   client is actually scheduled.
2. **Wearable integrations** — Fitbit / Garmin / Withings / Samsung Health APIs;
   sleep stages + resting HR/HRV trends (our sleep has no stages).
3. **Appointments + telehealth + secure doctor messaging** (partner APIs — never
   scraping, never third-party APKs).
4. **E-prescription awareness** (scan code, redemption state, pharmacy handoff).
5. **Content libraries** — meditation programs, recipes/meal plans (licensed, not scraped).
6. **Cycle depth** — symptom-linked predictions surfaced, education content.
7. **Family/caregiver paid seats** (Doctolib pattern; our FamilyWatch is a start).
8. **B2B2C**: employer dashboard, insurer pilots (Barmer-bundles-7Mind pattern),
   DiGA/DTAC tracks.
9. **Localization**: FR, AR (+RTL), ES/IT for Doctolib-overlap markets.
10. **Web companion**: clinician/caregiver dashboard + marketing site that converts
    (current `healthgraph_web/` has stale imports — repair or remove).

---

## 5. Ordered REMAINING list (do this next)

**P0 — before/with submission (this week):**
1. Publish privacy policy + Impressum → paste URLs into `legalLinks.ts` (one line each).
2. Play Console: org account, D-U-N-S, package `com.medgraph.app`, Data Safety
   (copy from readiness §4), Health-apps declaration, IARC, tester track, reviewer
   notes from `REVIEW_NOTES.txt`.
3. Backend deploy env (`ANDROID_PACKAGE_NAME`, Play service-account or billing
   stays inert) + `alembic upgrade head`.
4. CI green on merge (tsc + tests + preview APK), then EAS production AAB.
5. AAB manifest audit: expect CAMERA/RECORD_AUDIO moment-of-use; NO location,
   NO `SYSTEM_ALERT_WINDOW`.
6. Physical-device pass of the six new features (audio, share sheet, HC import,
   demo, JSON upload, pricing flow) — minimum one tester per flow.

**P1 — first quarter post-launch (retention + rating):**
7. eRx awareness + interaction checker + package inserts (DE parity).
8. Sleep stages / resting-HR trends via Health Connect where available.
9. Meditation content starter pack (licensed audio) + GPS-route import decision.
10. User-facing data download polish (CSV exists; add per-domain files on request).
11. Play Billing live: Console products + store SDK + test purchases.
12. Repair or remove `healthgraph_web/`.

**P2 — moat (quarters, sequenced with funding):**
13. ePA live connector investigation (gematik effort sizing).
14. DiGA go/no-go (defines the German business model).
15. iOS client commitment (defines every other rich market).
16. Wearable partner APIs (Withings/Garmin/Fitbit) + B2B2C pilots.
17. Booking/telehealth/messaging via partner APIs; FR localization.
18. HIPAA posture if/when US B2B starts.

---

## 6. Honest risks (do not delete)

- The six features passed tests + types but **never ran on a device** in this build.
  Highest runtime risk: MeditationScreen audio, Settings additions, App demo gate.
- Billing cannot take money until Console products + SDK + signed build exist;
  until then paid buttons intentionally fall back to Free.
- FHIR import was validated against synthetic Bundles, not a real ePA export.
- `tsc`/lint run in CI; a red CI blocks merge — that is working as intended.
- No legal text in this repo substitutes counsel: DiGA, HIPAA, DTAC, and medical-
  device (MDR/HWG) positioning need professional review before any claim changes.
