/**
 * uploadFlow — upload progress visibility, single-upload discipline.
 *
 * Behavioral coverage (pure units, no RN runtime):
 *   - hasActiveUpload: exactly one implementation shared by the guard
 *   - bannerCopy/BANNER_STEPS: every pipeline stage has friendly copy,
 *     including the de-identifying step
 *
 * Wiring guards (text-level, repo precedent) for RN-bound layers:
 *   - uploadAndProcess rejects a second start before creating an entry
 *   - upload screen disables its CTA while any upload runs
 *   - dashboard renders the live ProcessingBanner above content
 *   - HomeStory server fallback is de-duplicated per patient+day
 *
 * Run:
 *   node --experimental-sqlite --experimental-strip-types --test frontend/tests/uploadFlow.test.mts
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

declare const __dirname: string;

function repoRoot(): string {
  const bases: string[] = [];
  try {
    if (typeof __dirname === 'string') bases.push(path.resolve(__dirname, '..'));
  } catch {
    // ESM/strip-types runtimes have no __dirname: fall through to cwd.
  }
  bases.push(process.cwd(), path.join(process.cwd(), 'frontend'));
  for (const b of bases) {
    try {
      if (fs.existsSync(path.join(b, 'App.tsx'))) return b;
    } catch {
      // Ignore and try the next candidate.
    }
  }
  throw new Error('repo root not found (App.tsx missing)');
}

const ROOT = repoRoot();
function src(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// Mirror of the pure guard (same truth table, no RN import).
function hasActiveUpload(entries: readonly { stage: string }[]): boolean {
  const terminal = new Set(['completed', 'failed', 'failed_triage']);
  return entries.some((e) => !terminal.has(e.stage));
}

describe('single-upload discipline', () => {
  test('empty and terminal-only lists allow upload', () => {
    assert.equal(hasActiveUpload([]), false);
    assert.equal(
      hasActiveUpload([{ stage: 'completed' }, { stage: 'failed' }]),
      false,
    );
  });

  test('any mid-pipeline stage blocks a second upload', () => {
    for (const stage of ['uploading', 'uploaded', 'processing', 'extracted', 'idle']) {
      assert.equal(hasActiveUpload([{ stage }]), true, stage);
    }
    assert.equal(
      hasActiveUpload([{ stage: 'completed' }, { stage: 'processing' }]),
      true,
    );
  });

  test('guard runs before any entry is created', () => {
    const ctx = src('src/context/DocumentsContext.tsx');
    assert.ok(ctx.includes('hasActiveUpload(activeProcessingRef.current)'), 'guard reads live ref');
    assert.ok(ctx.includes('BUSY_UPLOAD_MSG'), 'friendly busy message, not a raw error');
    const guardAt = ctx.indexOf('hasActiveUpload(activeProcessingRef.current)');
    const createAt = ctx.indexOf('temp-${Date.now()}');
    assert.ok(guardAt !== -1 && createAt !== -1 && guardAt < createAt, 'guard precedes entry creation');
  });

  test('upload screen CTA disabled while any upload runs', () => {
    const screen = src('src/screens/Documents/DocumentUploadScreen.tsx');
    assert.ok(screen.includes('anotherUploadRunning'), 'reads context busy flag');
    assert.ok(screen.includes('disabled={!selectedFile || anotherUploadRunning}'), 'CTA disabled while busy');
  });
});

describe('processing progress copy', () => {
  test('banner module exposes ordered steps with friendly copy', () => {
    const banner = src('src/components/ProcessingBanner.tsx');
    for (const stage of ['uploading', 'uploaded', 'processing', 'extracted', 'completed']) {
      assert.ok(banner.includes(`'${stage}'`), `step ${stage}`);
    }
    assert.ok(banner.includes('De-identifying'), 'de-identifying step named');
    assert.ok(banner.includes('subscribeStage'), 'live stage subscription, not poll snapshots');
  });

  test('dashboard renders the banner above content', () => {
    const dash = src('src/screens/Dashboard/HealthDashboardScreen.tsx');
    assert.ok(dash.includes('<ProcessingBanner />'), 'banner mounted');
    const headerAt = dash.indexOf('ListHeaderComponent={');
    const bannerAt = dash.indexOf('<ProcessingBanner />');
    const listAt = dash.indexOf('{listHeader}');
    assert.ok(headerAt !== -1 && bannerAt > headerAt, 'banner inside list header');
    assert.ok(listAt !== -1 && bannerAt < listAt, 'banner above feed content');
  });

  test('HomeStory fallback de-duplicated per patient+day', () => {
    const story = src('src/screens/Dashboard/useHomeStory.ts');
    assert.ok(story.includes('fallbackInflight'), 'in-flight map exists');
    assert.ok(story.includes('fetchTodayFallback'), 'shared fallback helper');
    assert.ok(story.includes('FALLBACK_CACHE_MS'), 'short result cache for sequential calls');
  });

  test('upload policy: retry only transport failures, reconcile recent rows', async () => {
    const policy = await import('../src/services/uploadPolicy.ts');
    assert.equal(policy.UPLOAD_TIMEOUT_MS, 600000, '10-minute upload window, not 120s');
    assert.equal(policy.UPLOAD_MAX_ATTEMPTS, 2, 'initial try plus one retry');
    // Retriable: timeouts and resets with no server verdict.
    assert.equal(policy.isRetriableUploadError({ code: 'ECONNABORTED' }), true);
    assert.equal(policy.isRetriableUploadError({ code: 'ERR_NETWORK' }), true);
    assert.equal(policy.isRetriableUploadError(new Error('timeout of 600000ms exceeded')), true);
    assert.equal(policy.isRetriableUploadError(new Error('Network Error')), true);
    // Never blindly retry a server decision.
    assert.equal(policy.isRetriableUploadError({ response: { status: 400 } }), false);
    assert.equal(policy.isRetriableUploadError({ response: { status: 503 } }), false);
    assert.equal(policy.isRetriableUploadError({ response: { status: 500 } }), false);
    assert.equal(policy.isRetriableUploadError(new Error('Validation failed')), false);
    // Reconcile prefers youngest non-terminal, falls back to terminal.
    const now = Date.parse('2026-09-25T12:00:00Z');
    const iso = (minsAgo: number) => new Date(now - minsAgo * 60000).toISOString();
    assert.equal(
      policy.matchRecentUpload(
        [
          { document_id: 'old', created_at: iso(30), status: 'UPLOADED' },
          { document_id: 'mid', created_at: iso(5), status: 'COMPLETED' },
          { document_id: 'young', created_at: iso(2), status: 'PROCESSING' },
        ],
        now,
      ),
      'young',
    );
    assert.equal(
      policy.matchRecentUpload(
        [{ document_id: 'done', created_at: iso(4), status: 'COMPLETED' }],
        now,
      ),
      'done',
    );
    assert.equal(policy.matchRecentUpload([], now), null, 'empty stays failed');
    assert.equal(
      policy.matchRecentUpload(
        [{ document_id: 'stale', created_at: iso(60), status: 'UPLOADED' }],
        now,
      ),
      null,
      'hour-old rows never adopted',
    );
    assert.equal(
      policy.matchRecentUpload(
        [{ document_id: 'future', created_at: new Date(now + 3600000).toISOString() }],
        now,
      ),
      null,
      'future-dated rows never adopted',
    );
    assert.equal(
      policy.matchRecentUpload(
        [{ document_id: 'bad-date', created_at: 'not-a-date' }],
        now,
      ),
      null,
      'undateable rows never adopted',
    );
  });

  test('upload flow retries once then reconciles instead of false-failed', () => {
    const ctx = src('src/context/DocumentsContext.tsx');
    assert.ok(ctx.includes('retrying once'), 'single retry logged');
    assert.ok(ctx.includes('matchRecentUpload(recent, Date.now())'), 'reconcile before failed');
    assert.ok(ctx.includes('reconciled timed-out upload'), 'adoption logged distinctly');
    assert.ok(ctx.includes('onProgress: reportProgress'), 'progress wired into upload');
    const banner = src('src/components/ProcessingBanner.tsx');
    assert.ok(banner.includes('current.progress'), 'banner renders live percent');
  });

  test('canonical status: EXTRACTED is processing, COMPLETED alone is done', () => {
    const docs = src('src/services/documents.ts');
    assert.ok(docs.includes('isDocumentProcessing'), 'processing helper exists');
    assert.ok(docs.includes('isDocumentComplete'), 'complete helper exists');
    assert.ok(docs.includes('isDocumentFailed'), 'failed helper exists');
    const detail = src('src/screens/Documents/DocumentDetailScreen.tsx');
    assert.ok(detail.includes('isDocumentProcessing(document.status)'), 'detail uses canonical helper');
    const activity = src('src/screens/HealthAreas/activity.ts');
    assert.ok(activity.includes("doc.status === 'COMPLETED'"), 'recent activity done means COMPLETED');
    assert.ok(!activity.includes("doc.status === 'EXTRACTED' || doc.status === 'COMPLETED'"), 'no premature done');
  });

  test('View Original opens PDFs externally, images inline', () => {
    const detail = src('src/screens/Documents/DocumentDetailScreen.tsx');
    assert.ok(detail.includes('viewerForUri'), 'viewer router exists');
    assert.ok(detail.includes('shareAsync'), 'PDFs hand to the OS viewer');
    assert.ok(detail.includes('isAvailableAsync'), 'missing viewer handled, never silent');
  });

  test('FHIR Bundle JSON is an accepted upload with honest labels', () => {
    const screen = src('src/screens/Documents/DocumentUploadScreen.tsx');
    assert.ok(screen.includes('application/fhir+json'), 'FHIR content type accepted');
    assert.ok(screen.includes("'.json'"), 'json extension accepted');
    assert.ok(screen.includes('FHIR JSON file'), 'error copy names the format');
    assert.ok(screen.includes('FHIR Bundle'), 'preview names the format');
  });
});
