/**
 * doctorReportHtml.ts — pure doctor-report HTML builder (zero imports).
 *
 * The screen assembles patient data from device storage; this module turns
 * it into a printable HTML document. EVERY interpolated value passes
 * through esc() — medication names, notes, and dates are user data and
 * must never break markup or inject HTML. Node-testable.
 */

export interface ReportMed {
  name: string;
  detail: string | null;
  adherence: number | null;
  status: string;
}

export interface ReportObs {
  title: string;
  sub: string | null;
}

export interface ReportSleep {
  nights: number;
  avgMinutes: number | null;
}

export interface ReportWeight {
  startKg: number;
  endKg: number;
  changeKg: number;
}

export interface ReportInteraction {
  medicines: string;
  note: string;
}

export interface ReportInput {
  generatedAt: string;
  windowDays: number;
  patientName: string | null;
  meds: ReportMed[];
  interactions: ReportInteraction[];
  observations: ReportObs[];
  sleep: ReportSleep | null;
  weight: ReportWeight | null;
}

/** Escape text for HTML content AND attribute contexts. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function medRows(meds: ReportMed[]): string {
  if (meds.length === 0) {
    return `<tr><td colspan="3" class="muted">No active medications in this window.</td></tr>`;
  }
  return meds
    .map(
      (m) => `<tr><td><strong>${esc(m.name)}</strong>${
        m.detail ? `<br><span class="muted">${esc(m.detail)}</span>` : ''
      }</td><td>${m.adherence != null ? `${m.adherence}%` : '—'}</td><td>${esc(m.status)}</td></tr>`,
    )
    .join('');
}

function obsRows(obs: ReportObs[]): string {
  if (obs.length === 0) {
    return `<tr><td colspan="2" class="muted">No recorded observations in this window.</td></tr>`;
  }
  return obs
    .map(
      (o) => `<tr><td><strong>${esc(o.title)}</strong></td><td>${o.sub ? esc(o.sub) : '—'}</td></tr>`,
    )
    .join('');
}

/** Full printable document. Returns null when there is nothing to report. */
export function buildReportHtml(input: ReportInput): string | null {
  const hasContent =
    input.meds.length > 0 ||
    input.observations.length > 0 ||
    input.sleep != null ||
    input.weight != null;
  if (!hasContent) return null;

  const sleepLine =
    input.sleep == null
      ? 'No sleep logged in this window.'
      : input.sleep.avgMinutes != null
        ? `${input.sleep.nights} ${input.sleep.nights === 1 ? 'night' : 'nights'} logged · avg ${fmtMinutes(input.sleep.avgMinutes)}`
        : `${input.sleep.nights} ${input.sleep.nights === 1 ? 'night' : 'nights'} logged`;
  const weightLine =
    input.weight == null
      ? 'No weight entries in this window.'
      : (() => {
          const sign = input.weight.changeKg > 0 ? '+' : '';
          return `${input.weight.startKg} kg → ${input.weight.endKg} kg (${sign}${input.weight.changeKg} kg)`;
        })();

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #111; margin: 32px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 15px; margin: 24px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
.meta, .muted { color: #666; font-size: 12px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; color: #666; font-weight: 600; border-bottom: 1px solid #ccc; padding: 6px 8px 6px 0; }
td { border-bottom: 1px solid #eee; padding: 6px 8px 6px 0; vertical-align: top; }
p.line { font-size: 13px; }
.footer { margin-top: 28px; font-size: 11px; color: #888; }
</style></head><body>
<h1>Health summary</h1>
<div class="meta">Last ${input.windowDays} days · generated ${esc(input.generatedAt)}${input.patientName ? ` · ${esc(input.patientName)}` : ''}</div>
<h2>Medications</h2>
<table><tr><th>Medicine</th><th>Adherence</th><th>Status</th></tr>${medRows(input.meds)}</table>
${input.interactions.length > 0 ? `<h2>Possible interactions (for clinician review)</h2><table><tr><th>Combination</th><th>Note</th></tr>${input.interactions.map((x) => `<tr><td><strong>${esc(x.medicines)}</strong></td><td>${esc(x.note)}</td></tr>`).join('')}</table>` : ''}
<h2>Recorded observations</h2>
<table><tr><th>Finding</th><th>Detail</th></tr>${obsRows(input.observations)}</table>
<h2>Sleep</h2>
<p class="line">${esc(sleepLine)}</p>
<h2>Weight</h2>
<p class="line">${esc(weightLine)}</p>
<div class="footer">Patient-generated tracking data from the HealthGraph app. Estimates and logs — not a diagnosis. Generated on-device, never uploaded for this report.</div>
</body></html>`;
}

export interface CaregiverReportMed {
  name: string;
  /** Plain schedule line, e.g. "10 mg · once daily · morning". */
  schedule: string | null;
  /** Trailing-window adherence percent, null when unknown. */
  adherence: number | null;
  /** Plain supply line, e.g. "12 days left · 1 refill left". */
  supply: string | null;
}

export interface CaregiverReportInput {
  generatedAt: string;
  windowDays: number;
  patientName: string | null;
  meds: CaregiverReportMed[];
}

function caregiverRows(meds: CaregiverReportMed[]): string {
  if (meds.length === 0) {
    return `<tr><td colspan="3" class="muted">No active medications in this window.</td></tr>`;
  }
  return meds
    .map(
      (m) => `<tr><td><strong>${esc(m.name)}</strong>${
        m.schedule ? `<br><span class="muted">${esc(m.schedule)}</span>` : ''
      }</td><td>${m.adherence != null ? `${m.adherence}%` : 'Not recorded'}</td><td>${m.supply ? esc(m.supply) : 'Not recorded'}</td></tr>`,
    )
    .join('');
}

/**
 * Simplified shareable summary for a family member or caregiver: schedule,
 * adherence, and supply only — no observations, no interaction detail.
 * Returns null when there is nothing to report.
 */
export function buildCaregiverReportHtml(input: CaregiverReportInput): string | null {
  if (input.meds.length === 0) return null;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
body { font-family: -apple-system, Helvetica, Arial, sans-serif; color: #111; margin: 32px; }
h1 { font-size: 22px; margin: 0 0 4px; }
h2 { font-size: 15px; margin: 24px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
.meta, .muted { color: #666; font-size: 12px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; color: #666; font-weight: 600; border-bottom: 1px solid #ccc; padding: 6px 8px 6px 0; }
td { border-bottom: 1px solid #eee; padding: 6px 8px 6px 0; vertical-align: top; }
.footer { margin-top: 28px; font-size: 11px; color: #888; }
</style></head><body>
<h1>Medication summary for caregiver</h1>
<div class="meta">Last ${input.windowDays} days · generated ${esc(input.generatedAt)}${input.patientName ? ` · ${esc(input.patientName)}` : ''}</div>
<h2>Medicines</h2>
<table><tr><th>Medicine</th><th>Taken (last ${input.windowDays} days)</th><th>Supply</th></tr>${caregiverRows(input.meds)}</table>
<div class="footer">Patient-generated tracking data from the HealthGraph app. A wellness log — not medical advice. Share only with people you trust. Generated on-device, never uploaded for this report.</div>
</body></html>`;
}
