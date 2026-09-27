/**
 * DiaryPaper — scoped paper skeuomorphism for the health journal.
 *
 * Physical report sheets: paper surface, spine edge, stacked-page depth,
 * engraved headers. Used ONLY by the timeline journal; the app-wide guava
 * flat system is untouched. All content is caller-provided real data.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { DiaryDay } from './diary';
import { stripSummary } from './diary';
import { FONT } from '@/theme/guava';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { ReportDocumentView } from './ReportDocumentView';

/** Fixed page height: the wheel sizes every sheet and its stage from this. */
export const DIARY_PAGE_HEIGHT = 336;

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

/** One journal page, laid out like the wireframe: date + report header,
 *  primary content box beside a narrow side box, and a full-width bottom
 *  box for the rest. Every box shows real day data — never filler. */
export function DiarySheet({ day, patientName }: { day: DiaryDay; patientName: string | null }) {
  const strip = stripSummary(day);
  const primary = day.primary;
  const secondary = day.secondary;
  return (
    <View style={styles.page}>
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
    </View>
  );
}

interface SheetProps {
  visible: boolean;
  day: DiaryDay | null;
  days: DiaryDay[];
  patientName: string | null;
  patientId: string | null;
  /** Item key to ring-highlight + scroll to (AI evidence nav). */
  highlightKey: string | null;
  onClose: () => void;
  onSelectDay: (dayKey: string) => void;
  onDocumentPress: (documentId: string) => void;
}

/**
 * The opened page: the selected report sheet rises out of the timeline
 * stack and expands toward the user — a pulled-out physical page, not a
 * generic pushed screen. Custom entrance/exit (no Modal slide): the
 * backdrop fades while the sheet rises with a subtle scale, staged after
 * the wheel brings the tapped page to the front. Behind pages stay dimly
 * visible through the translucent scrim.
 *
 * The timeline (and its scroll position, filters, and wheel order) stays
 * mounted behind, so dismissing returns to the exact prior state.
 * Adjacent-day ‹ › steps swap the document in place.
 */
export function DiaryReportSheet({
  visible,
  day,
  days,
  patientName,
  patientId,
  highlightKey,
  onClose,
  onSelectDay,
  onDocumentPress,
}: SheetProps) {
  const [rendered, setRendered] = useState(false);
  const backdrop = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  const reduced = useReducedMotion();
  const index = day ? days.findIndex((d) => d.dayKey === day.dayKey) : -1;
  const prev = index > 0 ? days[index - 1] : null;
  const next = index >= 0 && index < days.length - 1 ? days[index + 1] : null;

  const playEntrance = useCallback(() => {
    backdrop.setValue(0);
    rise.setValue(0);
    Animated.parallel([
      Animated.timing(backdrop, {
        toValue: 1,
        duration: reduced ? 0 : 200,
        useNativeDriver: true,
      }),
      Animated.timing(rise, {
        toValue: 1,
        duration: reduced ? 0 : 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [backdrop, rise, reduced]);

  // Open: mount, then play the pull-out entrance. Day swaps while open
  // reuse the mounted sheet without replaying it.
  useEffect(() => {
    if (visible && day && !rendered) {
      closing.current = false;
      setRendered(true);
    }
  }, [visible, day, rendered]);
  useEffect(() => {
    if (rendered) playEntrance();
  }, [rendered, playEntrance]);

  const close = useCallback(() => {
    if (closing.current || !rendered) return;
    closing.current = true;
    Animated.parallel([
      Animated.timing(backdrop, {
        toValue: 0,
        duration: reduced ? 0 : 200,
        useNativeDriver: true,
      }),
      Animated.timing(rise, {
        toValue: 0,
        duration: reduced ? 0 : 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => {
      closing.current = false;
      setRendered(false);
      onClose();
    });
  }, [backdrop, rise, reduced, rendered, onClose]);

  const closeThen = useCallback(
    (fn: () => void) => {
      if (closing.current || !rendered) {
        onClose();
        fn();
        return;
      }
      closing.current = true;
      Animated.parallel([
        Animated.timing(backdrop, {
          toValue: 0,
          duration: reduced ? 0 : 200,
          useNativeDriver: true,
        }),
        Animated.timing(rise, {
          toValue: 0,
          duration: reduced ? 0 : 220,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(() => {
        closing.current = false;
        setRendered(false);
        onClose();
        fn();
      });
    },
    [backdrop, rise, reduced, rendered, onClose],
  );

  const sheetTranslateY = rise.interpolate({
    inputRange: [0, 1],
    outputRange: [140, 0],
    extrapolate: 'clamp',
  });
  const sheetScale = rise.interpolate({
    inputRange: [0, 1],
    outputRange: [0.94, 1],
    extrapolate: 'clamp',
  });

  if (!rendered || !day) return null;
  return (
    <Modal visible transparent animationType="none" onRequestClose={close}>
      <Animated.View style={[styles.sheetBackdrop, { opacity: backdrop }]}>
        <Pressable style={styles.sheetBackdropTap} onPress={close} accessibilityRole="button" accessibilityLabel="Close report" />
        <Animated.View
          style={[
            styles.sheet,
            { transform: [{ translateY: sheetTranslateY }, { scale: sheetScale }] },
          ]}
        >
          <View style={styles.sheetGrab} />
          <View style={styles.sheetHead}>
            <Pressable
              onPress={() => prev && onSelectDay(prev.dayKey)}
              disabled={!prev}
              accessibilityRole="button"
              accessibilityLabel={prev ? `Previous day ${prev.fullDate}` : 'No earlier day'}
              hitSlop={8}
              style={styles.dayStep}
            >
              <Text style={[styles.dayStepText, !prev && styles.dayStepDisabled]}>‹</Text>
            </Pressable>
            <View style={styles.sheetTitleWrap}>
              <Text style={styles.sheetTitle} numberOfLines={1}>
                {day.title} · {day.context}
              </Text>
            </View>
            <Pressable
              onPress={() => next && onSelectDay(next.dayKey)}
              disabled={!next}
              accessibilityRole="button"
              accessibilityLabel={next ? `Next day ${next.fullDate}` : 'No later day'}
              hitSlop={8}
              style={styles.dayStep}
            >
              <Text style={[styles.dayStepText, !next && styles.dayStepDisabled]}>›</Text>
            </Pressable>
            <Pressable
              onPress={close}
              accessibilityRole="button"
              accessibilityLabel="Close daily report"
              hitSlop={8}
              style={styles.sheetCloseInline}
            >
              <Text style={styles.sheetCloseText}>Close</Text>
            </Pressable>
          </View>
          <ReportDocumentView
            key={day.dayKey}
            day={day}
            patientName={patientName}
            patientId={patientId}
            highlightKey={highlightKey}
            onDocumentPress={(id) => closeThen(() => onDocumentPress(id))}
          />
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}


const styles = StyleSheet.create({
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
  primaryTitle: { fontFamily: FONT.semi, fontSize: 16, lineHeight: 22, color: PAPER.ink },
  primaryDetail: { fontSize: 12, lineHeight: 17, color: PAPER.muted },
  primaryTime: { fontSize: 11, color: PAPER.muted, fontVariant: ['tabular-nums'] },
  sideBox: {
    width: 96,
    backgroundColor: PAPER.well, borderRadius: 3, paddingHorizontal: 8, paddingVertical: 8, gap: 3,
    borderWidth: 1, borderColor: PAPER.rule, alignItems: 'center', justifyContent: 'center',
  },
  sideLabel: { fontFamily: FONT.semi, fontSize: 11, lineHeight: 14, letterSpacing: 2, color: PAPER.muted },
  sideIcon: { fontSize: 22, color: PAPER.ink },
  sideTitle: { fontFamily: FONT.semi, fontSize: 11, lineHeight: 14, color: PAPER.ink, textAlign: 'center' },
  sideDetail: { fontSize: 11, lineHeight: 15, color: PAPER.muted, textAlign: 'center', fontVariant: ['tabular-nums'] },
  bottomBox: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: PAPER.well, borderRadius: 3, paddingHorizontal: 10, paddingVertical: 9,
    borderWidth: 1, borderColor: PAPER.rule,
  },
  bottomText: { flex: 1, fontSize: 11, color: PAPER.muted },
  bottomTap: { fontFamily: FONT.semi, fontSize: 11, color: PAPER.accent },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(13, 20, 26, 0.72)' },
  sheetBackdropTap: { flex: 1 },
  sheet: {
    height: '70%',
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
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dayStep: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dayStepText: { fontSize: 30, lineHeight: 32, color: PAPER.ink },
  dayStepDisabled: { color: PAPER.sheetEdge },
  sheetTitleWrap: { flex: 1, alignItems: 'center' },
  sheetTitle: { fontFamily: FONT.semi, fontSize: 14, lineHeight: 19, letterSpacing: 1, color: PAPER.ink },
  sheetCloseInline: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  sheetCloseText: { fontFamily: FONT.semi, fontSize: 13, color: PAPER.accent },
});
