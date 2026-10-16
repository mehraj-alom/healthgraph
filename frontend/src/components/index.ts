// ── HealthGraph shared design-system components ─────────────────────────────
export { Card } from './Card';
export { Button } from './Button';
export { Input } from './Input';
export { NumberInput } from './NumberInput';
export { Chip } from './Chip';
export { SectionHeader } from './SectionHeader';
export { Badge } from './Badge';
export { Toggle } from './Toggle';
export { EmptyState } from './EmptyState';
export { StageGradient } from './StageGradient';
export { LoadingState } from './LoadingState';
export { Modal } from './Modal';
export { BottomSheet } from './BottomSheet';
export { Select } from './Select';
export { Slider } from './Slider';
export { DialInput, feverTint, severityTint } from './DialInput';
export { WheelSlider } from './WheelSlider';
export { GlassCuboid } from './GlassCuboid';
export { GlassCard } from './GlassCard';
export { AmbientBackground } from './AmbientBackground';
export { UmbrellaTabBar } from './UmbrellaTabBar';
export { LogCelebration } from './LogCelebration';
export { ProcessingBadge } from './ProcessingBadge';
export { ProcessingBanner } from './ProcessingBanner';
export {
  DeleteConfirmSheet,
  type DeleteMode,
  type DeleteResult,
} from './DeleteConfirmSheet';

// ── Reusable layout & feedback primitives ───────────────────────────────────
export { Skeleton, SkeletonList, SkeletonCard } from './Skeleton';
export { ErrorState } from './ErrorState';
export { PressScale } from './PressScale';

// ── Toast feedback ──────────────────────────────────────────────────────────
export { ToastProvider, useToast } from './Toast';
// ── Boot splash (video loading animation) ───────────────────────────────────
export { BootSplash } from './BootSplash';
// ── Rotating wellness facts for loading screens ─────────────────────────────
export { HealthFact, HEALTH_FACTS } from './HealthFact';

// ── Health metric primitives ────────────────────────────────────────────────
export { MetricValue } from './MetricValue';
export { TrendIndicator } from './TrendIndicator';
export { HealthAreaCard } from './health/HealthAreaCard';
export { StatusLabel } from './StatusLabel';
export { MetricCard } from './MetricCard';
export { ProgressBar } from './ProgressBar';
export { BrandLogo, LOGO_ASPECT } from './BrandLogo';
export {
  SymptomBodyMap,
  type SymptomDatum,
  type SelectedBodyPart,
  type BodySide,
  type BodyGender,
  type PainSide,
} from './SymptomBodyMap';

// ── Med* aliases (legacy naming, kept for backward compatibility) ───────────
export { Card as MedCard } from './Card';
export { Button as MedButton } from './Button';
export { Input as MedInput } from './Input';
export { NumberInput as MedNumberInput } from './NumberInput';
export { Chip as MedChip } from './Chip';
export { SectionHeader as MedSectionHeader } from './SectionHeader';
export { Badge as MedBadge } from './Badge';
export { Toggle as MedToggle } from './Toggle';
export { EmptyState as MedEmptyState } from './EmptyState';
export { LoadingState as MedLoadingState } from './LoadingState';
export { Modal as MedModal } from './Modal';
export { BottomSheet as MedBottomSheet } from './BottomSheet';
export { Select as MedSelect } from './Select';
export { Slider as MedSlider } from './Slider';

// ── New canonical aliases (consistent with the design system) ────────────────
export { MetricValue as MedMetricValue } from './MetricValue';
export { TrendIndicator as MedTrendIndicator } from './TrendIndicator';
export { StatusLabel as MedStatusLabel } from './StatusLabel';
export { MetricCard as MedMetricCard } from './MetricCard';
export { ProgressBar as MedProgressBar } from './ProgressBar';
export { Skeleton as MedSkeleton } from './Skeleton';
export { ErrorState as MedErrorState } from './ErrorState';
export { PressScale as MedPressScale } from './PressScale';