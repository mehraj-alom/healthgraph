import {
  StyleSheet,
  View,
  Text,
  Pressable,
  ScrollView,
  Modal as RNModal,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import { spacing, radius } from '@/theme/tokens';

interface ModalProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  /** Optional action row rendered below the scrollable content. */
  actions?: React.ReactNode;
  /** Close when the scrim is tapped (default true). */
  allowTouchOutsideToClose?: boolean;
  /** Android hardware back button / outside request callback. */
  onRequestClose?: () => void;
  contentStyle?: ViewStyle;
}

/**
 * HealthGraph modal — elevated glass panel over a scrim.
 *
 * Built on RN Modal, so nothing stays mounted or blocking after `visible`
 * becomes false. Android Back is wired through onRequestClose.
 */
export const Modal = ({
  visible,
  onClose,
  title,
  subtitle,
  children,
  actions,
  allowTouchOutsideToClose = true,
  onRequestClose,
  contentStyle,
}: ModalProps) => {
  const insets = useSafeAreaInsets();
  const { colors, typography, elevation } = useTheme();
  const requestClose = onRequestClose ?? onClose;

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={requestClose}
      accessibilityViewIsModal
    >
      <View style={styles.root}>
        <Pressable
          style={[styles.scrim, { backgroundColor: colors.overlayScrim }]}
          onPress={allowTouchOutsideToClose ? requestClose : undefined}
          accessibilityLabel="Close"
        />

        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.glassStrong,
              borderColor: colors.glassBorder,
            },
            elevation.deep,
            { paddingTop: Math.max(insets.top, 24), paddingBottom: Math.max(insets.bottom, 16) },
            contentStyle,
          ]}
        >
          <View style={styles.header}>
            <View style={styles.headerText}>
              {title ? (
                <Text style={[styles.title, typography.heading, { color: colors.textPrimary }]}>{title}</Text>
              ) : null}
              {subtitle ? (
                <Text style={[styles.subtitle, typography.bodySecondary, { color: colors.textMuted }]}>{subtitle}</Text>
              ) : null}
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close dialog"
              style={({ pressed }) => [
                styles.closeButton,
                { backgroundColor: colors.glassHighlight, borderColor: colors.glassBorder },
                pressed && [{ backgroundColor: colors.surfacePressed, transform: [{ scale: 0.94 }] }],
              ]}
            >
              <Text style={[styles.closeText, { color: colors.textSecondary }]}>✕</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>

          {actions ? (
            <View style={[styles.actions, { borderTopColor: colors.glassBorder }]}>{actions}</View>
          ) : null}
        </View>
      </View>
    </RNModal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '82%',
    borderWidth: 1,
    borderRadius: radius.xxl,
    paddingHorizontal: spacing.lg,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 20,
  },
  subtitle: {
    fontSize: 13,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontSize: 14,
    lineHeight: 16,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingBottom: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
  },
});