/**
 * paperTheme — the journal paper palette, dependency-free on purpose.
 *
 * Lives in its own module (no imports) so both DiaryPaper and
 * ReportDocumentView can use it at module scope (StyleSheet.create) without
 * forming an import cycle. A DiaryPaper ↔ ReportDocumentView cycle once
 * crashed the app at load with "Cannot read property 'muted' of undefined"
 * because Metro evaluated one side with partial exports.
 */

export const PAPER = {
  sheet: '#f6f1e4',
  sheetEdge: '#e4dcc8',
  spine: '#d8cfae',
  ink: '#2b2620',
  muted: '#6f675a',
  faint: '#a39a86',
  rule: '#ddd3bd',
  well: '#efe8d6',
  accent: '#0b5c40',
  highlight: '#b98a1d',
} as const;
