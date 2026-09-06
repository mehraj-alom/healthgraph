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
import { COLORS, SPACING, BORDER_RADIUS, TYPOGRAPHY, ELEVATION } from '@/constants';

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
 * MedGraph modal — dark elevated glass panel over a scrim.
 *
 * Notes:
 *  - Built on React Native's Modal, so nothing stays mounted or blocking after
 *    `visible` becomes false.
 *  - Android Back is wired through onRequestClose.
 *  - Content is scrollable and the keyboard stays usable (taps persist).
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
          style={styles.scrim}
          onPress={allowTouchOutsideToClose ? requestClose : undefined}
          accessibilityLabel="Close"
        />

        <View
          style={[
            styles.card,
            { paddingTop: Math.max(insets.top, 24), paddingBottom: Math.max(insets.bottom, 16) },
            contentStyle,
          ]}
        >
          <View style={styles.header}>
            <View style={styles.headerText}>
              {title ? <Text style={styles.title}>{title}</Text> : null}
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close dialog"
              style={({ pressed }) => [
                styles.closeButton,
                pressed && styles.closeButtonPressed,
              ]}
            >
              <Text style={styles.closeText}>✕</Text>
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

          {actions ? <View style={styles.actions}>{actions}</View> : null}
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
    paddingHorizontal: SPACING.lg,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLORS.overlayScrim,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '82%',
    backgroundColor: COLORS.glassStrong,
    borderWidth: 1,
    borderColor: COLORS.borderFaint,
    borderRadius: BORDER_RADIUS.xl,
    paddingHorizontal: SPACING.lg,
    ...ELEVATION.deep,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: SPACING.md,
    paddingBottom: SPACING.sm,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
  },
  subtitle: {
    ...TYPOGRAPHY.subtitle,
    color: COLORS.textMuted,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: COLORS.borderFaint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonPressed: {
    backgroundColor: COLORS.surfacePressed,
    transform: [{ scale: 0.94 }],
  },
  closeText: {
    color: COLORS.textSecondary,
    fontSize: 14,
    lineHeight: 16,
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingBottom: SPACING.md,
  },
  actions: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.borderFaint,
  },
});
