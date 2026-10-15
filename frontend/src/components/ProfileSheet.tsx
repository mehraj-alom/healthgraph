import { useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  AccessibilityInfo,
  Alert,
  Easing,
  findNodeHandle,
  Image,
  Linking,
  Modal as RNModal,
  PanResponder,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Constants from 'expo-constants';
import { BlurView } from 'expo-blur';
import { useReducedMotion } from '@/theme';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { useDocuments } from '@/context/DocumentsContext';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/Toast';
import {
  IMPRINT_URL,
  OFF_ATTRIBUTION,
  PRIVACY_POLICY_URL,
  hasImprintUrl,
  hasPrivacyPolicyUrl,
} from '@/services/legalLinks';

/**
 * ProfileSheet — avatar tap opens this. A LEFT side drawer taking 2/3 of
 * the screen width, on the teal stage: every feature in one place (each row
 * opens its page), recent uploaded records, Premium, and the legal rows.
 */

interface FeatureDef {
  title: string;
  route: string;
  params?: Record<string, unknown>;
}

const EXPLORE_FEATURES: FeatureDef[] = [
  { title: 'Medications', route: 'Medications' },
  { title: 'My Priorities', route: 'Priority' },
  { title: 'Daily Log', route: 'DailyLog' },
  { title: 'Measure Pulse', route: 'PpgMeasure' },
  { title: 'Scan Food', route: 'FoodScan' },
  { title: 'Upload Record', route: 'DocumentUpload' },
  { title: 'Symptom Map', route: 'SymptomMap' },
  { title: 'Chat', route: 'Chat' },
  { title: 'Timeline', route: 'Timeline' },
  { title: '3D Body', route: 'Body' },
  { title: 'Health Graph', route: 'HealthGraph', params: { source: 'graph' } },
];

const TERMS_COPY =  'Your health data belongs to you. Records you upload are processed to build your timeline and insights, and stay on this device and your private account. HealthGraph is a wellness companion, not a medical device — nothing here is medical advice, diagnosis, or treatment. If something feels urgent, contact a clinician. You can request deletion of your data at any time from Account settings.';

const PRIVACY_COPY =
  'Daily logs, vitals, and documents sync to your account so they survive reinstalls. We never sell personal health data. Processing happens only to power the features you use — timeline, correlations, chat answers. Sign out keeps your local data on the device; uninstalling removes it. Optional Health Connect import (sleep, workouts) runs only after your explicit opt-in, stays on your device and account like hand-logged entries, and stops the moment you disconnect.';

function fmtDocDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * NavRow — one destination: white title, chevron right.
 */
function NavRow({
  title,
  label,
  last,
  onPress,
}: {
  title: string;
  label: string;
  last: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.row,
        !last && styles.rowDivider,
        pressed && { opacity: 0.7 },
      ]}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>
          {title}
        </Text>
      </View>
      <Text style={styles.chev}>›</Text>
    </Pressable>
  );
}

export function ProfileSheet({
  visible,
  onClose,
  photoUri,
  onOpen,
}: {
  visible: boolean;
  onClose: () => void;
  photoUri: string | null;
  /** Navigate then close: parent calls navigation.navigate(route, params). */
  onOpen: (route: string, params?: Record<string, unknown>) => void;
}) {
  const { width: W } = useWindowDimensions();
  const { documents } = useDocuments();
  const { user, userProfile } = useAuth() as unknown as {
    user: { email?: string | null } | null;
    userProfile?: { displayName?: string | null; email?: string | null } | null;
  };
  const displayName =
    userProfile?.displayName?.trim() ||
    userProfile?.email?.split('@')[0] ||
    user?.email?.split('@')[0] ||
    '';
  const toast = useToast();
  const [legalOpen, setLegalOpen] = useState<'terms' | 'privacy' | null>(null);
  const [premiumOpen, setPremiumOpen] = useState(false);
  const drawerW = Math.round(W * (2 / 3));
  // Frosted glass costs a blur pass: collapse to the solid stage when
  // reduced motion is requested (the transparency-reduction equivalent).
  const glassOff = useReducedMotion();

  // Screen-reader focus enters the drawer the moment it opens (no
  // timers: the slide animation runs underneath while focus is already
  // home, so ears and eyes land in the same place).
  const closeBtnRef = useRef<ComponentRef<typeof Pressable>>(null);
  useEffect(() => {
    if (!visible) return;
    const node = findNodeHandle(closeBtnRef.current);
    if (node) AccessibilityInfo.setAccessibilityFocus(node);
  }, [visible]);
  const slideX = useRef(new Animated.Value(0)).current;
  const panX = useRef(new Animated.Value(0)).current;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const widthRef = useRef(drawerW);
  widthRef.current = drawerW;
  useEffect(() => {
    if (visible) {
      slideX.setValue(-drawerW);
      // Fast start, soft landing — a linear 260 ms read as "sticky".
      Animated.timing(slideX, {
        toValue: 0,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      panX.setValue(0);
      setLegalOpen(null);
      setPremiumOpen(false);
    }
  }, [visible, slideX, drawerW, panX]);

  const drag = useRef(
    PanResponder.create({
      // Leftward, horizontal-dominant drags dismiss; vertical scrolls inside
      // pass straight through to the ScrollView.
      onMoveShouldSetPanResponder: (_e, g) =>
        g.dx < -6 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
      onPanResponderMove: (_e, g) => {
        panX.setValue(Math.min(0, g.dx));
      },
      onPanResponderRelease: (_e, g) => {
        if (g.dx < -90 || g.vx < -1) {
          Animated.timing(panX, {
            toValue: -widthRef.current,
            duration: 180,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }).start(() => {
            panX.setValue(0);
            closeRef.current();
          });
        } else {
          // Damped snap-back: the old speed/bounciness spring overshot and
          // wobbled, which read as stickiness at the end of the gesture.
          Animated.spring(panX, {
            toValue: 0,
            tension: 140,
            friction: 20,
            useNativeDriver: true,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(panX, {
          toValue: 0,
          tension: 140,
          friction: 20,
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  const go = (route: string, params?: Record<string, unknown>) => {
    onClose();
    onOpen(route, params);
  };

  const recentDocs = documents.slice(0, 5);
  const version = Constants.expoConfig?.version ?? '1.0.0';

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Animated.View style={[styles.slide, { width: drawerW, transform: [{ translateX: slideX }] }]}>
          <Animated.View
            style={[styles.sheet, { transform: [{ translateX: panX }] }]}
            accessibilityViewIsModal
            {...drag.panHandlers}
          >
          {/* Liquid-glass sheet: live blur over the content beneath (the
              mirror-on-water surface), tinted with the stage brand color
              for depth, bright hairline on the leading edge where light
              catches the material. Solid stage fallback under reduced
              motion. White content cards stay solid for legibility. */}
          {glassOff ? (
            <View style={styles.glassSolid} />
          ) : (
            <BlurView tint="dark" intensity={100} style={[styles.glass, styles.glassTint]} />
          )}
          {!glassOff ? <View style={styles.edgeLight} pointerEvents="none" /> : null}
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.head}>
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarEmpty]} accessible accessibilityRole="image" accessibilityLabel="Profile avatar">
                  <Text style={styles.avatarInitials}>
                    {(user?.email?.trim().charAt(0) ?? 'H').toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={styles.headMeta}>
                <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
                  {displayName || 'Profile'}
                </Text>
              </View>
              <Pressable
                ref={closeBtnRef}
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close profile"
                hitSlop={12}
                style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.closeGlyph}>✕</Text>
              </Pressable>
            </View>

            <Text style={styles.sectionLabel}>Explore</Text>
            <View style={styles.card}>
              {EXPLORE_FEATURES.map((f, i) => (
                <NavRow
                  key={f.route + f.title}
                  title={f.title}
                  label={`Open ${f.title}`}
                  last={i === EXPLORE_FEATURES.length - 1}
                  onPress={() => go(f.route, f.params)}
                />
              ))}
            </View>

            <Text style={styles.sectionLabel}>My records</Text>
            <View style={styles.card}>
              {recentDocs.length === 0 ? (
                <Text style={styles.emptyText}>No records yet. Upload your first report.</Text>
              ) : (
                recentDocs.map((d, i) => (
                  <Pressable
                    key={d.document_id}
                    onPress={() => go('DocumentDetail', { documentId: d.document_id })}
                    accessibilityRole="button"
                    accessibilityLabel={`Open record from ${fmtDocDate(d.created_at)}`}
                  style={({ pressed }) => [
                    styles.row,
                    i < recentDocs.length - 1 && styles.rowDivider,
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>Documents</Text>
                    <Text style={styles.rowSub}>
                      {fmtDocDate(d.created_at)} · {d.status.toLowerCase().replace('_', ' ')}
                    </Text>
                  </View>
                  <Text style={styles.chev}>›</Text>
                  </Pressable>
                ))
              )}
            </View>

            <Text style={styles.sectionLabel}>Premium</Text>
            <View style={[styles.card, styles.premiumCardWrap]}>
              <Pressable
                onPress={() => setPremiumOpen((v) => !v)}
                accessibilityRole="button"
                accessibilityState={{ expanded: premiumOpen }}
                accessibilityLabel="Premium plans and pricing"
                style={({ pressed }) => [styles.premiumHead, pressed && { opacity: 0.7 }]}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>Go Premium</Text>
                  <Text style={styles.rowSub}>3 days free, then from €11 a month</Text>
                </View>
                <Text style={styles.chev}>{premiumOpen ? '▾' : '›'}</Text>
              </Pressable>
              {premiumOpen ? (
                <View style={styles.tiers}>
                  <View style={styles.tier}>
                    <View style={styles.tierHead}>
                      <Text style={styles.tierName}>Free</Text>
                      <Text style={styles.tierPrice}>€0</Text>
                    </View>
                    <Text style={styles.tierFeat}>Daily logging & check-ins{'\n'}Medications & dose tracking{'\n'}Timeline & history{'\n'}3 meal scans a month{'\n'}2 AI messages a month</Text>
                    <View style={styles.tierCurrent}>
                      <Text style={styles.tierCurrentText}>Your current plan</Text>
                    </View>
                  </View>
                  <View style={styles.tier}>
                    <View style={styles.tierHead}>
                      <Text style={styles.tierName}>General</Text>
                      <Text style={styles.tierPrice}>€11<Text style={styles.tierPer}>/mo</Text></Text>
                    </View>
                    <Text style={styles.tierFeat}>Everything in Free, unlimited{'\n'}Camera pulse (PPG){'\n'}Health graph & correlations{'\n'}Priority engines{'\n'}4 document scans a month{'\n'}Unlimited food scans</Text>
                    <Pressable
                      onPress={() => toast.info('Subscriptions open soon.')}
                      accessibilityRole="button"
                      accessibilityLabel="Choose General plan"
                      style={({ pressed }) => [styles.tierBtn, pressed && { opacity: 0.8 }]}
                    >
                      <Text style={styles.tierBtnText}>Choose General</Text>
                    </Pressable>
                  </View>
                  <View style={[styles.tier, styles.tierBest]}>
                    <View style={styles.tierHead}>
                      <Text style={styles.tierName}>All-in</Text>
                      <Text style={styles.tierPrice}>€18<Text style={styles.tierPer}>/mo</Text></Text>
                    </View>
                    <Text style={styles.tierFeat}>Everything in General{'\n'}Face pulse (rPPG){'\n'}3D body included{'\n'}Voice alarms & call reminders{'\n'}Unlimited AI chat{'\n'}Unlimited document scans</Text>
                    <Pressable
                      onPress={() => toast.info('Subscriptions open soon.')}
                      accessibilityRole="button"
                      accessibilityLabel="Choose All-in plan"
                      style={({ pressed }) => [styles.tierBtn, pressed && { opacity: 0.8 }]}
                    >
                      <Text style={styles.tierBtnText}>Choose All-in</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.compareTitle}>Compare every feature</Text>
                  {(
                    [
                      ['Daily logging & check-ins', '✓', '✓', '✓'],
                      ['Medications & reminders', '✓', '✓', '✓'],
                      ['Timeline & history', '✓', '✓', '✓'],
                      ['Priority engines', '✓', '✓', '✓'],
                      ['Health graph & correlations', '–', '✓', '✓'],
                      ['Camera pulse (fingertip PPG)', '–', '✓', '✓'],
                      ['Face pulse (rPPG)', '–', '–', '✓'],
                      ['3D body', '–', '–', '✓'],
                      ['Food scans', '3 / mo', 'Unlimited', 'Unlimited'],
                      ['Document scans', '–', '4 / mo', 'Unlimited'],
                      ['AI chat messages', '2 / mo', 'Limited', 'Unlimited'],
                      ['Voice alarms & call reminders', '–', '–', '✓'],
                    ] as Array<[string, string, string, string]>
                  ).map(([feature, free, general, allIn], i, arr) => (
                    <View key={feature} style={[styles.compareRow, i < arr.length - 1 && styles.rowDivider]}>
                      <Text style={styles.compareFeature} numberOfLines={2}>{feature}</Text>
                      <Text style={[styles.compareCell, free === '–' && styles.compareNo]}>{free}</Text>
                      <Text style={[styles.compareCell, general === '–' && styles.compareNo]}>{general}</Text>
                      <Text style={[styles.compareCell, styles.compareBest, allIn === '–' && styles.compareNo]}>{allIn}</Text>
                    </View>
                  ))}
                  <Text style={styles.renewNote}>Start with 3 days free. Then your plan auto-renews every month. Cancel anytime and keep access until the period ends.</Text>
                </View>
              ) : null}
            </View>

            <Text style={styles.sectionLabel}>About</Text>
            <View style={styles.card}>
              <Pressable
                onPress={() => go('Settings')}
                accessibilityRole="button"
                accessibilityLabel="Open settings"
                style={({ pressed }) => [
                  styles.row,
                  styles.rowDivider,
                  pressed && { opacity: 0.6 },
                ]}
              >
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>Settings</Text>
                </View>
                <Text style={styles.chev}>›</Text>
              </Pressable>
              {(
                [
                  { key: 'terms', title: 'Terms & Conditions', copy: TERMS_COPY },
                  { key: 'privacy', title: 'Privacy Policy', copy: PRIVACY_COPY },
                ] as const
              ).map((item, i) => {
                const open = legalOpen === item.key;
                return (
                  <View key={item.key}>
                    <Pressable
                      onPress={() => setLegalOpen(open ? null : item.key)}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: open }}
                      accessibilityLabel={item.title}
                      style={({ pressed }) => [
                        styles.row,
                        (i < 1 || open) && styles.rowDivider,
                        pressed && { opacity: 0.6 },
                      ]}
                    >
                      <View style={styles.rowText}>
                        <Text style={styles.rowTitle}>{item.title}</Text>
                      </View>
                      <Text style={styles.chev}>{open ? '▾' : '›'}</Text>
                    </Pressable>
                    {open ? <Text style={styles.legalCopy}>{item.copy}</Text> : null}
                  </View>
                );
              })}
              <View style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>Version</Text>
                </View>
                <Text style={styles.rowSub}>{version}</Text>
              </View>
              {hasPrivacyPolicyUrl() && PRIVACY_POLICY_URL ? (
                <Pressable
                  onPress={() => {
                    void Linking.openURL(PRIVACY_POLICY_URL as string).catch(() => {});
                  }}
                  accessibilityRole="link"
                  accessibilityLabel="Read the full privacy policy"
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>Read full policy ↗</Text>
                  </View>
                  <Text style={styles.chev}>›</Text>
                </Pressable>
              ) : null}
              {hasImprintUrl() && IMPRINT_URL ? (
                <Pressable
                  onPress={() => {
                    void Linking.openURL(IMPRINT_URL as string).catch(() => {});
                  }}
                  accessibilityRole="link"
                  accessibilityLabel="Read the legal notice"
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
                >
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>Impressum ↗</Text>
                  </View>
                  <Text style={styles.chev}>›</Text>
                </Pressable>
              ) : null}
              <View style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.rowSub}>{OFF_ATTRIBUTION}</Text>
                </View>
              </View>
            </View>

            <View style={{ height: 24 }} />
          </ScrollView>
          </Animated.View>
        </Animated.View>
        <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close profile" />
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  scrim: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.6)' } as const,
  slide: { height: '100%' },
  sheet: {
    flex: 1,
    backgroundColor: 'transparent',
    borderTopRightRadius: 28,
    borderBottomRightRadius: 28,
    paddingTop: 8,
    overflow: 'hidden',
  },
  // Frost layers sit behind the scroll content (absolute fill, clipped to
  // the sheet's rounded shape by overflow hidden above).
  glass: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  glassTint: {
    backgroundColor: 'rgba(8, 10, 17, 0.72)',
  },
  glassSolid: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#080A11',
  },
  // Bright leading edge: 1px of caught light down the rounded side.
  edgeLight: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  closeGlyph: {
    color: GV.card,
    fontSize: 15,
    fontFamily: FONT.bold,
  },
  content: {
    paddingHorizontal: SPACE.screenH,
    paddingBottom: 24,
    gap: 0,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  headMeta: {
    flex: 1,
    gap: 2,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  avatarEmpty: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    fontFamily: FONT.semi,
    fontSize: 22,
    lineHeight: 26,
    color: '#FFFFFF',
  },
  title: {
    ...TYPE.display,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.4,
    color: '#FFFFFF',
    textAlign: 'left',
  },
  sectionLabel: {
    fontFamily: FONT.semi,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1.5,
    color: GV.fog,
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  // Glass modules (Control Center pattern): translucent panels on the
  // blur, white primary text, fog secondary, hairline light dividers.
  // Nothing solid white ever sits on the glass.
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    minHeight: 56,
  },
  rowText: { flex: 1, gap: 1 },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255, 255, 255, 0.12)',
  },
  rowTitle: {
    fontFamily: FONT.medium,
    fontSize: 17,
    lineHeight: 22,
    color: '#FFFFFF',
  },
  rowSub: {
    ...TYPE.caption,
    color: GV.fog,
  },
  chev: {
    fontSize: 20,
    color: 'rgba(255, 255, 255, 0.45)',
    fontWeight: '400',
  },
  emptyText: {
    ...TYPE.body,
    color: GV.fog,
    paddingVertical: 12,
  },
  premiumCardWrap: {
    paddingVertical: 8,
  },
  premiumHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    minHeight: 56,
  },
  tiers: {
    gap: 12,
    paddingTop: 8,
    paddingBottom: 12,
  },
  tier: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 14,
    padding: 16,
    gap: 8,
  },
  tierBest: {
    borderWidth: 1.5,
    borderColor: GV.teal,
  },
  tierHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  tierName: {
    ...TYPE.button,
    fontSize: 16,
    color: '#FFFFFF',
  },
  tierPrice: {
    fontFamily: FONT.bold,
    fontSize: 20,
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  tierPer: {
    fontFamily: FONT.regular,
    fontSize: 13,
    color: GV.fog,
  },
  tierFeat: {
    ...TYPE.body,
    fontSize: 13.5,
    lineHeight: 21,
    color: GV.fog,
  },
  tierBtn: {
    backgroundColor: GV.cta,
    borderRadius: 9999,
    alignItems: 'center',
    paddingVertical: 11,
    marginTop: 4,
  },
  tierBtnText: {
    ...TYPE.button,
    fontSize: 14,
    color: '#FFFFFF',
  },
  tierCurrent: {
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    paddingVertical: 10,
    marginTop: 4,
  },
  tierCurrentText: {
    ...TYPE.chip,
    color: GV.fog,
  },
  renewNote: {
    ...TYPE.caption,
    color: GV.fog,
    lineHeight: 18,
    paddingHorizontal: 4,
  },
  // Full feature-comparison matrix (Free / General / All-in).
  compareTitle: {
    ...TYPE.button,
    fontSize: 15,
    color: '#FFFFFF',
    marginTop: 16,
    marginBottom: 4,
    paddingHorizontal: 4,
  },
  compareRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 4,
  },
  compareFeature: {
    flex: 1.4,
    fontSize: 13,
    lineHeight: 17,
    color: GV.fog,
  },
  compareCell: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: FONT.semi,
    color: '#FFFFFF',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  compareNo: {
    color: 'rgba(255, 255, 255, 0.45)',
    fontFamily: FONT.regular,
  },
  compareBest: {
    color: GV.teal,
  },
  legalCopy: {
    ...TYPE.body,
    fontSize: 14,
    color: GV.fog,
    lineHeight: 21,
    paddingBottom: 12,
    paddingRight: 8,
  },
  signOut: {
    marginTop: 16,
    alignItems: 'center',
    paddingVertical: 16,
  },
  signOutText: {
    ...TYPE.button,
    fontSize: 15,
    color: GV.danger,
  },
});
