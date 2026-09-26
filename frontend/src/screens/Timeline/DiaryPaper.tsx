/**
 * DiaryPaper — scoped paper skeuomorphism for the health journal.
 *
 * Physical report sheets: paper surface, spine edge, stacked-page depth,
 * engraved headers. Used ONLY by the timeline journal; the app-wide guava
 * flat system is untouched. All content is caller-provided real data.
 */

import { memo, useEffect, useRef } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { DiaryDay, DiaryItemInput } from './diary';
import { stripSummary } from './diary';
import { FONT } from '@/theme/guava';

/** Fixed preview height: enables exact getItemLayout + scroll preservation. */
export const DIARY_PAGE_HEIGHT = 336;
/** Full page step including the inter-page gap (must match pageSlot). */
export const DIARY_PAGE_STEP = DIARY_PAGE_HEIGHT + 18;

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

interface PreviewProps {
  day: DiaryDay;
  patientName: string | null;
  onOpen: (dayKey: string) => void;
}

/** One journal page, laid out like the wireframe: date + report header,
 *  primary content box beside a narrow side box, and a full-width bottom
 *  box for the rest. Every box shows real day data — never filler. */
export const DiaryPagePreview = memo(function DiaryPagePreview({ day, patientName, onOpen }: PreviewProps) {
  const strip = stripSummary(day);
  const primary = day.primary;
  const secondary = day.secondary;
  return (
    <View style={styles.pageSlot}>
      {/* Stacked pages beneath. */}
      <View style={styles.pageUnder2} pointerEvents="none" />
      <View style={styles.pageUnder1} pointerEvents="none" />
      <Pressable
        onPress={() => onOpen(day.dayKey)}
        accessibilityRole="button"
        accessibilityLabel={`Open daily report for ${day.fullDate}, ${day.total} entries`}
        style={({ pressed }) => [styles.page, pressed && styles.pagePressed]}
      >
        <View style={styles.spine} />
        <View style={styles.pageBody}>
          <View style={styles.dateRow}>
            <Text style={styles.dateTitle}>{day.title}</Text>
            <Text style={styles.dateContext}>{day.context}</Text>
          </View>
          <View style={styles.reportHeadRow}>
            <Text style={styles.reportHead}>Daily Report</Text>
            <Text style={styles.reportDate}>{day.fullDate}</Text>
          </View>
          {patientName ? <Text style={styles.patient}>{patientName}</Text> : null}
          <View style={styles.rule} />
          <View style={styles.mainRow}>
            <View style={styles.primaryWell}>
              {primary ? (
                <>
                  <Text style={styles.primaryTitle} numberOfLines={1}>
                    {primary.icon ? `${primary.icon} ` : ''}{primary.title}
                  </Text>
                  {primary.detail ? (
                    <Text style={styles.primaryDetail} numberOfLines={2}>{primary.detail}</Text>
                  ) : null}
                  <Text style={styles.primaryTime}>{primary.time}</Text>
                </>
              ) : (
                <Text style={styles.primaryDetail}>No entries recorded.</Text>
              )}
            </View>
            <View style={styles.sideBox}>
              <Text style={styles.sideLabel}>ALSO</Text>
              {secondary ? (
                <>
                  <Text style={styles.sideIcon}>{secondary.icon || '◆'}</Text>
                  <Text style={styles.sideTitle} numberOfLines={2}>{secondary.title}</Text>
                  {secondary.detail ? (
                    <Text style={styles.sideDetail} numberOfLines={1}>{secondary.detail}</Text>
                  ) : null}
                </>
              ) : (
                <>
                  <Text style={styles.sideIcon}>▤</Text>
                  <Text style={styles.sideTitle} numberOfLines={2}>
                    {day.total} {day.total === 1 ? 'entry' : 'entries'}
                  </Text>
                </>
              )}
            </View>
          </View>
          <View style={styles.bottomBox}>
            <Text style={styles.bottomText} numberOfLines={1}>
              {strip.length > 0 ? strip.join('   ') : '—'}
            </Text>
            <Text style={styles.bottomTap}>tap to open ›</Text>
          </View>
        </View>
      </Pressable>
    </View>
  );
});

/**
 * TurningPage — top-to-bottom page-turn feel for the vertical journal.
 *
 * Each page tilts on the X axis with perspective as it travels: tipped back
 * while rising from below, flat at rest, tipping forward as it leaves past
 * the top. Transform-only (native driver, 60fps); layout size never
 * changes, so getItemLayout scroll math stays exact. Restrained ±9°.
 */
export function TurningPage({
  index,
  scrollY,
  topOffset = 0,
  children,
}: {
  index: number;
  scrollY: Animated.Value;
  /** List-header height above the first page (measured at runtime). */
  topOffset?: number;
  children: React.ReactNode;
}) {
  const y = topOffset === 0 ? scrollY : Animated.subtract(scrollY, topOffset);
  const inputRange = [(index - 1) * DIARY_PAGE_STEP, index * DIARY_PAGE_STEP, (index + 1) * DIARY_PAGE_STEP];
  const rotateX = y.interpolate({ inputRange, outputRange: ['9deg', '0deg', '-9deg'], extrapolate: 'clamp' });
  const scale = y.interpolate({ inputRange, outputRange: [0.965, 1, 0.985], extrapolate: 'clamp' });
  const opacity = y.interpolate({ inputRange, outputRange: [0.65, 1, 1], extrapolate: 'clamp' });
  return (
    <Animated.View style={{ transform: [{ perspective: 900 }, { rotateX }, { scale }], opacity }}>
      {children}
    </Animated.View>
  );
}

interface SheetProps {  visible: boolean;
  day: DiaryDay | null;
  days: DiaryDay[];
  patientName: string | null;
  /** Item key to ring-highlight + scroll to (AI evidence nav). */
  highlightKey: string | null;
  renderRow: (item: DiaryItemInput, highlighted: boolean) => React.ReactNode;
  onClose: () => void;
  onSelectDay: (dayKey: string) => void;
}

/**
 * The opened page: vertical ~2/3 report rising over the timeline, which
 * stays mounted behind. Adjacent-day ‹ › steps; dismiss returns to the
 * exact timeline position (the list is never unmounted or scrolled).
 */
export function DiaryReportSheet({
  visible,
  day,
  days,
  patientName,
  highlightKey,
  renderRow,
  onClose,
  onSelectDay,
}: SheetProps) {
  const scrollRef = useRef<ScrollView | null>(null);
  const rowY = useRef(new Map<string, number>());
  const index = day ? days.findIndex((d) => d.dayKey === day.dayKey) : -1;
  const prev = index > 0 ? days[index - 1] : null;
  const next = index >= 0 && index < days.length - 1 ? days[index + 1] : null;

  useEffect(() => {
    rowY.current.clear();
  }, [day?.dayKey, visible]);

  // After the rise animation, bring AI-highlighted evidence into view.
  useEffect(() => {
    if (!visible || !highlightKey) return;
    const t = setTimeout(() => {
      const y = rowY.current.get(highlightKey);
      if (y !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, y - 80), animated: true });
    }, 450);
    return () => clearTimeout(t);
  }, [visible, highlightKey, day?.dayKey]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetBackdrop}>
        <Pressable style={styles.sheetBackdropTap} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close report" />
        <View style={styles.sheet}>
          <View style={styles.sheetGrab} />
          {day ? (
            <>
              <View style={styles.sheetHead}>
                <Pressable
                  onPress={() => prev && onSelectDay(prev.dayKey)}
                  disabled={!prev}
                  accessibilityRole="button"
                  accessibilityLabel={prev ? `Previous day ${prev.fullDate}` : 'No earlier day'}
                  hitSlop={12}
                  style={styles.dayStep}
                >
                  <Text style={[styles.dayStepText, !prev && styles.dayStepDisabled]}>‹</Text>
                </Pressable>
                <View style={styles.sheetTitleWrap}>
                  <Text style={styles.sheetTitle}>Daily Report</Text>
                  <Text style={styles.sheetDate}>
                    {day.fullDate}
                    {patientName ? ` · ${patientName}` : ''}
                  </Text>
                </View>
                <Pressable
                  onPress={() => next && onSelectDay(next.dayKey)}
                  disabled={!next}
                  accessibilityRole="button"
                  accessibilityLabel={next ? `Next day ${next.fullDate}` : 'No later day'}
                  hitSlop={12}
                  style={styles.dayStep}
                >
                  <Text style={[styles.dayStepText, !next && styles.dayStepDisabled]}>›</Text>
                </Pressable>
              </View>
              <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close daily report" hitSlop={12} style={styles.sheetClose}>
                <Text style={styles.sheetCloseText}>Close ✕</Text>
              </Pressable>
              <ScrollView
                ref={scrollRef}
                contentContainerStyle={styles.sheetRows}
                showsVerticalScrollIndicator={false}
              >
                {day.items.map((item) => (
                  <View
                    key={item.key}
                    onLayout={(e) => rowY.current.set(item.key, e.nativeEvent.layout.y)}
                    style={highlightKey === item.key ? styles.highlightRow : undefined}
                  >
                    {renderRow(item, highlightKey === item.key)}
                  </View>
                ))}
              </ScrollView>
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  pageSlot: { height: DIARY_PAGE_HEIGHT, marginBottom: 18, paddingHorizontal: 20 },
  pageUnder2: {
    position: 'absolute', left: 26, right: 14, top: 8, bottom: 2,
    backgroundColor: PAPER.sheetEdge, borderRadius: 4,
  },
  pageUnder1: {
    position: 'absolute', left: 23, right: 17, top: 4, bottom: 6,
    backgroundColor: PAPER.sheet, borderRadius: 4,
    borderWidth: 1, borderColor: PAPER.sheetEdge,
  },
  page: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: PAPER.sheet,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: PAPER.sheetEdge,
    shadowColor: '#1a1408',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 5,
  },
  pagePressed: { opacity: 0.92, transform: [{ translateY: 1 }] },
  spine: { width: 10, backgroundColor: PAPER.spine, borderTopLeftRadius: 4, borderBottomLeftRadius: 4 },
  pageBody: { flex: 1, paddingHorizontal: 14, paddingVertical: 12, gap: 6 },
  dateRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  dateTitle: {
    fontFamily: FONT.semi, fontSize: 22, letterSpacing: 2, color: PAPER.ink,
    fontVariant: ['tabular-nums'],
  },
  dateContext: { fontFamily: FONT.semi, fontSize: 13, color: PAPER.muted },
  reportHeadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  reportHead: { fontFamily: FONT.semi, fontSize: 13, letterSpacing: 1.5, color: PAPER.ink },
  reportDate: { fontSize: 11, color: PAPER.muted },
  patient: { fontSize: 12, color: PAPER.muted },
  rule: { height: 1, backgroundColor: PAPER.rule },
  mainRow: { flexDirection: 'row', gap: 8, minHeight: 128 },
  primaryWell: {
    flex: 1,
    backgroundColor: PAPER.well, borderRadius: 3, paddingHorizontal: 10, paddingVertical: 8, gap: 2,
    borderLeftWidth: 3, borderLeftColor: PAPER.accent,
  },
  primaryTitle: { fontFamily: FONT.semi, fontSize: 15, color: PAPER.ink },
  primaryDetail: { fontSize: 12, lineHeight: 17, color: PAPER.muted },
  primaryTime: { fontSize: 11, color: PAPER.faint, fontVariant: ['tabular-nums'] },
  sideBox: {
    width: 96,
    backgroundColor: PAPER.well, borderRadius: 3, paddingHorizontal: 8, paddingVertical: 8, gap: 3,
    borderWidth: 1, borderColor: PAPER.rule, alignItems: 'center', justifyContent: 'center',
  },
  sideLabel: { fontFamily: FONT.semi, fontSize: 9, letterSpacing: 2, color: PAPER.faint },
  sideIcon: { fontSize: 22, color: PAPER.ink },
  sideTitle: { fontFamily: FONT.semi, fontSize: 11, lineHeight: 14, color: PAPER.ink, textAlign: 'center' },
  sideDetail: { fontSize: 10, color: PAPER.muted, textAlign: 'center', fontVariant: ['tabular-nums'] },
  bottomBox: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: PAPER.well, borderRadius: 3, paddingHorizontal: 10, paddingVertical: 9,
    borderWidth: 1, borderColor: PAPER.rule,
  },
  bottomText: { flex: 1, fontSize: 11, color: PAPER.muted },
  bottomTap: { fontFamily: FONT.semi, fontSize: 11, color: PAPER.accent },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#10140fdd' },
  sheetBackdropTap: { flex: 1 },
  sheet: {
    height: '67%',
    backgroundColor: PAPER.sheet,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    borderTopWidth: 3,
    borderTopColor: PAPER.spine,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 20,
  },
  sheetGrab: { alignSelf: 'center', width: 48, height: 4, borderRadius: 2, backgroundColor: PAPER.sheetEdge, marginBottom: 8 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dayStep: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dayStepText: { fontSize: 30, lineHeight: 32, color: PAPER.ink },
  dayStepDisabled: { color: PAPER.sheetEdge },
  sheetTitleWrap: { flex: 1, alignItems: 'center' },
  sheetTitle: { fontFamily: FONT.semi, fontSize: 17, letterSpacing: 1, color: PAPER.ink },
  sheetDate: { fontSize: 12, color: PAPER.muted },
  sheetClose: { alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 4 },
  sheetCloseText: { fontFamily: FONT.semi, fontSize: 13, color: PAPER.accent },
  sheetRows: { gap: 10, paddingBottom: 24 },
  highlightRow: {
    borderWidth: 2, borderColor: PAPER.highlight, borderRadius: 10, padding: 2,
    backgroundColor: '#f8ecc9',
  },
});
