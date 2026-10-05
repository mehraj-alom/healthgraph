/**
 * DiaryPaper — frosted glass journal pages, Apple Liquid Glass psychology.
 *
 * Two-layer architecture:
 *  - Functional layer (DiaryReportSheet): real backdrop blur, hairline highlight,
 *    the "pulled page" sits on this layer. Uses BlurView.
 *  - Content layer (DiarySheet in the wheel): opaque frosted material fill only,
 *    NO blur — the wheel renders many pages; BlurView per page kills perf.
 *    Frosted look via LG.card.fillStrong + hairline top edge.
 *
 * Typography: lgType scale, system font (SF Pro on iOS). Monochrome on glass:
 *   LG.card.label, LG.card.labelSecondary, LG.card.mint for one accent.
 * No paper palette — LG.card tokens only.
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
import { BlurView } from 'expo-blur';
import type { DiaryDay } from './diary';
import { stripSummary } from './diary';
import { LG, lgType } from '@/theme/liquidGlass';
import { useReducedMotion } from '@/theme/useReducedMotion';
import { ReportDocumentView } from './ReportDocumentView';

/** Fixed page height: the wheel sizes every sheet and its stage from this. */
export const DIARY_PAGE_HEIGHT = 336;

/**
 * One journal page in the wheel — frosted content card, no blur.
 * The wheel renders ~8 of these simultaneously; BlurView would tank FPS.
 * Frosted appearance comes from translucent fill + bright hairline top edge.
 */
export function DiarySheet({ day, patientName }: { day: DiaryDay; patientName: string | null }) {
  const strip = stripSummary(day);
  const primary = day.primary;
  const secondary = day.secondary;
  return (
    <View style={styles.page}>
      {/* Top hairline catch — simulates glass catching light */}
      <View style={styles.rim} />
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
              <Text style={styles.primaryDetail}>Nothing logged yet.</Text>
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
          <Text style={styles.bottomTap}>Read the full report ›</Text>
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
 * Functional layer: real BlurView + LG.fill + hairline highlight + border.
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
          {/* Functional-layer glass: real backdrop blur under a translucent
              fill, hairline top edge above. Content sits over both. */}
          {reduced ? (
            <View style={styles.sheetSolid} />
          ) : (
            <BlurView tint="dark" intensity={LG.blurIntensity} style={styles.sheetBlur} />
          )}
          <View style={styles.sheetTint} />
          <View style={styles.sheetContent}>
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
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}


const styles = StyleSheet.create({
  // ---- Wheel page (content layer) ----
  page: {
    flex: 1,
    backgroundColor: LG.card.fillStrong,   // frosted content material
    borderRadius: LG.card.radius,           // 24
    borderWidth: 1,
    borderColor: LG.card.border,
    // Soft shadow for depth on dark stage
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 8,
  },
  // Bright top hairline — glass catching light
  rim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: LG.card.hairlineTop,
  },
  pageBody: { flex: 1, paddingHorizontal: 16, paddingVertical: 14, gap: 8 },
  dateRow: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  dateTitle: {
    ...lgType.title,                        // 20/26, semibold
    letterSpacing: 0.5,
    color: LG.card.label,
    fontVariant: ['tabular-nums'],
  },
  dateContext: { ...lgType.caption, color: LG.card.labelSecondary },
  reportHeadRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  reportHead: { ...lgType.overline, color: LG.card.label },     // tracked uppercase
  reportDate: { ...lgType.caption, color: LG.card.labelSecondary },
  patient: { ...lgType.caption, color: LG.card.labelSecondary },
  rule: { height: 1, backgroundColor: LG.card.border },
  mainRow: { flexDirection: 'row', gap: 10, minHeight: 120 },
  primaryWell: {
    flex: 1,
    backgroundColor: LG.card.fill,           // lighter frosted well
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 4,
    borderLeftWidth: 3,
    borderLeftColor: LG.card.mint,
  },
  primaryTitle: { ...lgType.headline, color: LG.card.label },
  primaryDetail: { ...lgType.bodySmall, color: LG.card.labelSecondary },
  primaryTime: { ...lgType.caption, color: LG.card.labelTertiary, fontVariant: ['tabular-nums'] },
  sideBox: {
    width: 100,
    backgroundColor: LG.card.fill,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 12,
    gap: 4,
    borderWidth: 1,
    borderColor: LG.card.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideLabel: { ...lgType.overline, color: LG.card.labelTertiary },
  sideIcon: { fontSize: 24, color: LG.card.label },
  sideTitle: { ...lgType.caption, color: LG.card.label, textAlign: 'center', lineHeight: 16 },
  sideDetail: { ...lgType.caption, color: LG.card.labelSecondary, textAlign: 'center', fontVariant: ['tabular-nums'] },
  bottomBox: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: LG.card.fill, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: LG.card.border,
  },
  bottomText: { flex: 1, ...lgType.caption, color: LG.card.labelSecondary },
  bottomTap: { ...lgType.overline, color: LG.card.mint },

  // ---- Opened sheet (functional layer) ----
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: LG.edgeFade },
  sheetBackdropTap: { flex: 1 },
  sheet: {
    height: '72%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderTopColor: LG.hairlineTop,
    overflow: 'hidden',
  },
  sheetBlur: { ...StyleSheet.absoluteFill },
  sheetTint: { ...StyleSheet.absoluteFill, backgroundColor: LG.fill },
  // Reduce Transparency fallback: opaque fill instead of blur.
  sheetSolid: { ...StyleSheet.absoluteFill, backgroundColor: LG.fillOpaque },
  sheetContent: { flex: 1, paddingBottom: 12 },
  sheetGrab: { alignSelf: 'center', width: 48, height: 4, borderRadius: 2, backgroundColor: LG.border, marginBottom: 10 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingBottom: 8 },
  dayStep: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  dayStepText: { fontSize: 32, lineHeight: 36, color: LG.card.label },
  dayStepDisabled: { color: LG.card.labelTertiary },
  sheetTitleWrap: { flex: 1, alignItems: 'center' },
  sheetTitle: { ...lgType.title, letterSpacing: 0.2, color: LG.card.label },
  sheetCloseInline: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  sheetCloseText: { ...lgType.overline, color: LG.card.mint },
});