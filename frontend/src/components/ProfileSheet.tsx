import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
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
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { useDocuments } from '@/context/DocumentsContext';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/Toast';

/**
 * ProfileSheet — avatar tap opens this. A LEFT side drawer taking 2/3 of
 * the screen width, on the teal stage: every feature in one place (each row
 * opens its page), recent uploaded records, Premium, and the legal rows.
 */

interface FeatureDef {
  title: string;
  sub: string;
  dot: string;
  route: string;
  params?: Record<string, unknown>;
}

const FEATURES: FeatureDef[] = [
  { title: 'Chat', sub: 'Ask about your health', dot: GV.fx.purple, route: 'Chat' },
  { title: 'Daily Log', sub: 'Log today', dot: GV.fx.green, route: 'DailyLog' },
  { title: 'Timeline', sub: 'Your history', dot: GV.fx.blue, route: 'Timeline' },
  { title: 'Medications', sub: 'Schedule & doses', dot: GV.fx.sky, route: 'Medications' },
  { title: 'Symptom Map', sub: 'Mark where it hurts', dot: GV.fx.pink, route: 'SymptomMap' },
  { title: '3D Body', sub: 'Explore your body', dot: GV.teal, route: 'Body' },
  { title: 'Health Graph', sub: 'Full overview', dot: GV.cta, route: 'HealthGraph', params: { source: 'graph' } },
  { title: 'Measure Pulse', sub: 'Check heart rate', dot: GV.pulse, route: 'PpgMeasure' },
  { title: 'Upload Record', sub: 'Add a document', dot: GV.fx.amber, route: 'DocumentUpload' },
  { title: 'Scan Food', sub: 'Estimate meal calories', dot: GV.fx.amber, route: 'FoodScan' },
  { title: 'Account', sub: 'Settings & sign out', dot: GV.fx.brown, route: 'Settings' },
];

const TERMS_COPY =
  'Your health data belongs to you. Records you upload are processed to build your timeline and insights, and stay on this device and your private account. HealthGraph is a wellness companion, not a medical device — nothing here is medical advice, diagnosis, or treatment. If something feels urgent, contact a clinician. You can request deletion of your data at any time from Account settings.';

const PRIVACY_COPY =
  'Daily logs, vitals, and documents sync to your account so they survive reinstalls. We never sell personal health data. Processing happens only to power the features you use — timeline, correlations, chat answers. Sign out keeps your local data on the device; uninstalling removes it.';

function fmtDocDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
  const { logout } = useAuth();
  const toast = useToast();
  const [legalOpen, setLegalOpen] = useState<'terms' | 'privacy' | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const drawerW = Math.round(W * (2 / 3));

  // Slide in from the left on open; resting position is handled by the
  // drag release below.
  const slideX = useRef(new Animated.Value(0)).current;
  const panX = useRef(new Animated.Value(0)).current;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const widthRef = useRef(drawerW);
  widthRef.current = drawerW;
  useEffect(() => {
    if (visible) {
      slideX.setValue(-drawerW);
      Animated.timing(slideX, { toValue: 0, duration: 260, useNativeDriver: true }).start();
      panX.setValue(0);
      setLegalOpen(null);
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
            useNativeDriver: true,
          }).start(() => {
            panX.setValue(0);
            closeRef.current();
          });
        } else {
          Animated.spring(panX, { toValue: 0, useNativeDriver: true, speed: 24, bounciness: 4 }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(panX, { toValue: 0, useNativeDriver: true }).start();
      },
    }),
  ).current;

  const go = (route: string, params?: Record<string, unknown>) => {
    onClose();
    onOpen(route, params);
  };

  const confirmSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => void (async () => {
          if (signingOut) return;
          setSigningOut(true);
          try {
            await logout();
            onClose();
          } catch {
            toast.info('Could not sign you out. Please try again.');
          } finally {
            setSigningOut(false);
          }
        })(),
      },
    ]);
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
          <Animated.View style={[styles.sheet, { transform: [{ translateX: panX }] }]} {...drag.panHandlers}>
          <ScrollView
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.headRow}>
              <View style={styles.head} />
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                accessibilityLabel="Close profile"
                hitSlop={12}
                style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.closeGlyph}>✕</Text>
              </Pressable>
            </View>
            <View style={styles.head}>
              {photoUri ? (
                <Image source={{ uri: photoUri }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarEmpty]} />
              )}
              <Text style={styles.title}>Profile</Text>
            </View>

            <Text style={styles.sectionLabel}>Features</Text>
            <View style={styles.card}>
              {FEATURES.map((f, i) => (
                <Pressable
                  key={f.route + f.title}
                  onPress={() => go(f.route, f.params)}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${f.title}`}
                  style={({ pressed }) => [
                    styles.row,
                    i < FEATURES.length - 1 && styles.rowDivider,
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <View style={[styles.dot, { backgroundColor: f.dot }]} />
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{f.title}</Text>
                    <Text style={styles.rowSub}>{f.sub}</Text>
                  </View>
                  <Text style={styles.chev}>›</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.sectionLabel}>My records</Text>
            <View style={styles.card}>
              {recentDocs.length === 0 ? (
                <Text style={styles.emptyText}>No records yet — upload your first report.</Text>
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
                      <Text style={styles.rowTitle}>Medical report</Text>
                      <Text style={styles.rowSub}>
                        {fmtDocDate(d.created_at)} · {d.status.toLowerCase().replace('_', ' ')}
                      </Text>
                    </View>
                    <Text style={styles.chev}>›</Text>
                  </Pressable>
                ))
              )}
              <Pressable
                onPress={() => go('DocumentUpload')}
                accessibilityRole="button"
                accessibilityLabel="Upload a new record"
                style={({ pressed }) => [styles.uploadBtn, pressed && { opacity: 0.75 }]}
              >
                <Text style={styles.uploadBtnText}>+ Upload record</Text>
              </Pressable>
            </View>

            <Text style={styles.sectionLabel}>Premium</Text>
            <Pressable
              onPress={() => toast.info('Premium is coming soon.')}
              accessibilityRole="button"
              accessibilityLabel="Premium subscription, coming soon"
              style={({ pressed }) => [styles.card, styles.premiumCard, pressed && { opacity: 0.85 }]}
            >
              <View style={[styles.dot, { backgroundColor: GV.violet }]} />
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>Go Premium</Text>
                <Text style={styles.rowSub}>Deeper insights & unlimited history</Text>
              </View>
              <Text style={styles.chev}>›</Text>
            </Pressable>

            <Text style={styles.sectionLabel}>About</Text>
            <View style={styles.card}>
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
            </View>

            <Pressable
              onPress={confirmSignOut}
              accessibilityRole="button"
              accessibilityLabel="Sign out"
              style={({ pressed }) => [styles.card, styles.signOut, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.signOutText}>{signingOut ? 'Signing out…' : 'Sign Out'}</Text>
            </Pressable>
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
  scrim: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.5)' } as const,
  slide: { height: '100%' },
  sheet: {
    flex: 1,
    backgroundColor: GV.stage,
    borderTopRightRadius: 28,
    borderBottomRightRadius: 28,
    paddingTop: 8,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 8,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GV.stageline,
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
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
  },
  avatarEmpty: {
    backgroundColor: GV.stageline,
  },
  title: {
    ...TYPE.display,
    color: GV.card,
  },
  sectionLabel: {
    ...TYPE.chip,
    color: GV.fog,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 16,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  card: {
    backgroundColor: GV.card,
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
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: GV.line,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  rowText: { flex: 1, gap: 1 },
  rowTitle: {
    ...TYPE.button,
    fontSize: 15,
    color: GV.ink,
  },
  rowSub: {
    ...TYPE.caption,
    color: GV.muted,
  },
  chev: {
    fontSize: 20,
    color: GV.muted,
    fontWeight: '400',
  },
  emptyText: {
    ...TYPE.body,
    color: GV.muted,
    paddingVertical: 12,
  },
  uploadBtn: {
    backgroundColor: GV.cta,
    borderRadius: 9999,
    alignItems: 'center',
    paddingVertical: 12,
    marginVertical: 12,
  },
  uploadBtnText: {
    ...TYPE.button,
    fontSize: 15,
    color: '#FFFFFF',
  },
  premiumCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 16,
  },
  legalCopy: {
    ...TYPE.body,
    fontSize: 14,
    color: GV.body,
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
