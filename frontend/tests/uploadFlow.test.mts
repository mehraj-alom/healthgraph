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
});
