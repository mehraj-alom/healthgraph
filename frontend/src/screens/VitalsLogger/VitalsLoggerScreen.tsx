import {
  StyleSheet,
  View,
  Text,
  TextInput,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { useState, useEffect, useRef } from 'react';
import { api } from '@/services/api';
import { Input, Card } from '@/components';
import {
  COLORS,
  SPACING,
  BORDER_RADIUS,
  TYPOGRAPHY,
  SHADOWS,
} from '@/constants';
import { useAuth } from '@/context/AuthContext';

interface VitalInput {
  label: string;
  placeholder: string;
  unit: string;
  type: 'blood_sugar' | 'resting_pulse' | 'pain_level' | 'notes';
  keyboardType: 'numeric' | 'decimal-pad' | 'default';
  min?: number;
  max?: number;
  step?: number;
}

const VITAL_INPUTS: VitalInput[] = [
  {
    label: 'Blood Sugar',
    placeholder: 'e.g., 95',
    unit: 'mg/dL',
    type: 'blood_sugar',
    keyboardType: 'numeric',
    min: 40,
    max: 400,
  },
  {
    label: 'Resting Pulse',
    placeholder: 'e.g., 72',
    unit: 'bpm',
    type: 'resting_pulse',
    keyboardType: 'numeric',
    min: 30,
    max: 200,
  },
  {
    label: 'Pain Level',
    placeholder: '0-10',
    unit: '/10',
    type: 'pain_level',
    keyboardType: 'numeric',
    min: 0,
    max: 10,
  },
  {
    label: 'Notes',
    placeholder: 'How are you feeling?',
    unit: '',
    type: 'notes',
    keyboardType: 'default',
  },
];

export default function VitalsLoggerScreen() {
  const { user } = useAuth();

  const [values, setValues] = useState<Record<string, string>>({});
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [saveStatus, setSaveStatus] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');

  const debounceTimers = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({});

  /*
   * Map a UI field to the body structure used by the backend.
   */
  const getStructureId = (fieldId: string): string => {
    const map: Record<string, string> = {
      blood_sugar: 'BLOOD',
      resting_pulse: 'HEART',
      pain_level: 'FULL_BODY',
      notes: 'FULL_BODY',
    };

    return map[fieldId] || 'FULL_BODY';
  };

  /*
   * Convert a vital value into a normalized severity score.
   */
  const getSeverityScore = (
    fieldId: string,
    value: string
  ): number => {
    const num = parseFloat(value);

    if (Number.isNaN(num)) {
      return 0;
    }

    switch (fieldId) {
      case 'blood_sugar':
        if (num < 70 || num > 180) {
          return 0.8;
        }

        if (num < 80 || num > 140) {
          return 0.4;
        }

        return 0.1;

      case 'resting_pulse':
        if (num < 50 || num > 100) {
          return 0.7;
        }

        if (num < 60 || num > 90) {
          return 0.4;
        }

        return 0.1;

      case 'pain_level':
        return Math.max(0, Math.min(1, num / 10));

      default:
        return 0;
    }
  };

  /*
   * Convert severity into the visual status consumed by the backend/UI.
   */
  const getVisualStatus = (
    fieldId: string,
    value: string
  ): string => {
    const score = getSeverityScore(fieldId, value);

    if (score >= 0.7) {
      return 'critical';
    }

    if (score >= 0.4) {
      return 'warning';
    }

    if (score > 0) {
      return 'mild_attention';
    }

    return 'normal';
  };

  /*
   * Persist one vital to the backend.
   */
  const saveVital = async (
    fieldId: string,
    value: string
  ): Promise<void> => {
    if (!user) {
      return;
    }

    const trimmedValue = value.trim();

    /*
     * Do not send completely empty fields to the backend.
     */
    if (!trimmedValue) {
      return;
    }

    setSaveStatus('saving');

    try {
      await api.post('/api/v1/body-state/log', {
        patient_id: user.uid,
        structure_id: getStructureId(fieldId),
        finding_code: fieldId,
        visual_severity_score: getSeverityScore(
          fieldId,
          trimmedValue
        ),
        visual_status: getVisualStatus(
          fieldId,
          trimmedValue
        ),
        clinical_summary:
          fieldId === 'notes' ? trimmedValue : undefined,
        source_type: 'PATIENT_REPORTED',
      });

      setSaveStatus('saved');

      setTimeout(() => {
        setSaveStatus('idle');
      }, 2000);
    } catch (error) {
      console.error('Failed to save vital:', error);

      setSaveStatus('error');

      setTimeout(() => {
        setSaveStatus('idle');
      }, 3000);
    }
  };

  /*
   * Debounced field update.
   *
   * Each field has its own timer, so editing one field does not
   * cancel the pending save of another field.
   */
  const handleChange = (
    fieldId: string,
    value: string
  ): void => {
    setLocalValues(prev => ({
      ...prev,
      [fieldId]: value,
    }));

    setValues(prev => ({
      ...prev,
      [fieldId]: value,
    }));

    const existingTimer = debounceTimers.current[fieldId];

    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    debounceTimers.current[fieldId] = setTimeout(() => {
      void saveVital(fieldId, value);

      delete debounceTimers.current[fieldId];
    }, 5000);
  };

  /*
   * Cleanup pending debounce timers when leaving the screen.
   */
  useEffect(() => {
    return () => {
      Object.values(debounceTimers.current).forEach(timer => {
        clearTimeout(timer);
      });

      debounceTimers.current = {};
    };
  }, []);

  /*
   * Keep values synchronized with local values.
   */
  useEffect(() => {
    setValues(prev => ({
      ...prev,
      ...localValues,
    }));
  }, [localValues]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerContent}>
            <View>
              <Text style={styles.greeting}>
                Log Vitals
              </Text>

              <Text style={styles.subtitle}>
                Track your daily health metrics
              </Text>
            </View>
          </View>
        </View>

        {/* Vitals Input Cards */}
        <View>
          {VITAL_INPUTS.map(input => {
            const currentValue =
              localValues[input.type] ??
              values[input.type] ??
              '';

            const status = getVisualStatus(
              input.type,
              currentValue
            );

            return (
              <Card
                key={input.type}
                style={styles.inputCard}
                padding="md"
              >
                <View style={styles.inputHeader}>
                  <View style={styles.inputLabelContainer}>
                    <Text style={styles.inputLabel}>
                      {input.label}
                    </Text>

                    {input.unit ? (
                      <Text style={styles.inputUnit}>
                        {input.unit}
                      </Text>
                    ) : null}
                  </View>

                  <View style={styles.valueDisplay}>
                    <Text
                      style={[
                        styles.valueText,
                        {
                          color: getStatusColor(status),
                        },
                      ]}
                    >
                      {currentValue || '—'}

                      {input.unit ? (
                        <Text style={styles.valueUnit}>
                          {' '}
                          {input.unit}
                        </Text>
                      ) : null}
                    </Text>
                  </View>
                </View>

                {input.type === 'notes' ? (
                  <Input
                    label=""
                    placeholder={input.placeholder}
                    value={currentValue}
                    onChangeText={(text: string) =>
                      handleChange(input.type, text)
                    }
                    multiline
                    numberOfLines={4}
                    disabled={saveStatus === 'saving'}
                    style={{
                      marginTop: SPACING.sm,
                    }}
                  />
                ) : (
                  <>
                    <TextInput
                      style={[
                        styles.numberInput,
                        saveStatus === 'saving' &&
                          styles.numberInputDisabled,
                      ]}
                      value={currentValue}
                      onChangeText={(text: string) =>
                        handleChange(input.type, text)
                      }
                      placeholder={input.placeholder}
                      keyboardType={input.keyboardType}
                      editable={saveStatus !== 'saving'}
                      placeholderTextColor={
                        COLORS.textMuted
                      }
                      returnKeyType="done"
                    />

                    <View style={styles.sliderContainer}>
                      <Text style={styles.sliderMin}>
                        {input.min ?? 0}
                      </Text>

                      <View style={styles.sliderTrack}>
                        <View
                          style={[
                            styles.sliderThumb,
                            {
                              left: `${getSliderPosition(
                                input.type,
                                currentValue
                              )}%`,
                            },
                          ]}
                        />
                      </View>

                      <Text style={styles.sliderMax}>
                        {input.max ?? 10}
                      </Text>
                    </View>
                  </>
                )}
              </Card>
            );
          })}

          {/* Save Status Indicator */}
          <View style={styles.saveStatusContainer}>
            {saveStatus === 'saving' ? (
              <View
                style={[
                  styles.saveStatus,
                  styles.saveStatusSaving,
                ]}
              >
                <ActivityIndicator
                  size="small"
                  color={COLORS.primary}
                />

                <Text style={styles.saveStatusText}>
                  Saving...
                </Text>
              </View>
            ) : null}

            {saveStatus === 'saved' ? (
              <View
                style={[
                  styles.saveStatus,
                  styles.saveStatusSaved,
                ]}
              >
                <Text style={styles.saveStatusText}>
                  Saved ✓
                </Text>
              </View>
            ) : null}

            {saveStatus === 'error' ? (
              <View
                style={[
                  styles.saveStatus,
                  styles.saveStatusError,
                ]}
              >
                <Text style={styles.saveStatusText}>
                  Failed to save
                </Text>
              </View>
            ) : null}
          </View>

          {/* Medical Disclaimer */}
          <Card
            style={styles.disclaimerCard}
            padding="sm"
          >
            <Text style={styles.disclaimerTitle}>
              Important Disclaimer
            </Text>

            <Text style={styles.disclaimerText}>
              MedGraph is for general wellness, fitness
              tracking, and record organization. It is not a
              medical device. MedGraph does not provide medical
              advice, diagnosis, or treatment. Always consult a
              physician.
            </Text>
          </Card>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'normal':
      return COLORS.success;

    case 'mild_attention':
      return COLORS.warning;

    case 'warning':
      return COLORS.warning;

    case 'critical':
      return COLORS.error;

    default:
      return COLORS.textPrimary;
  }
};

const getSliderPosition = (
  fieldId: string,
  value: string
): number => {
  const input = VITAL_INPUTS.find(
    vital => vital.type === fieldId
  );

  if (
    !input ||
    input.min === undefined ||
    input.max === undefined
  ) {
    return 0;
  }

  const num = parseFloat(value);

  if (Number.isNaN(num)) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      100,
      ((num - input.min) /
        (input.max - input.min)) *
        100
    )
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  scrollContent: {
    paddingBottom: SPACING.xxl,
  },

  header: {
    paddingHorizontal: SPACING.xl,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.md,
    borderBottomWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
  },

  headerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  greeting: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
  },

  subtitle: {
    ...TYPOGRAPHY.body,
    color: COLORS.textMuted,
  },

  inputCard: {
    marginHorizontal: SPACING.xl,
    marginBottom: SPACING.md,
  },

  inputHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },

  inputLabelContainer: {
    flex: 1,
  },

  inputLabel: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
  },

  inputUnit: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    marginLeft: SPACING.xs,
  },

  valueDisplay: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },

  valueText: {
    ...TYPOGRAPHY.h2,
    fontWeight: '700',
  },

  valueUnit: {
    ...TYPOGRAPHY.body,
    color: COLORS.textMuted,
  },

  sliderContainer: {
    marginTop: SPACING.md,
  },

  sliderMin: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    position: 'absolute',
    left: -30,
  },

  sliderTrack: {
    height: 4,
    backgroundColor: COLORS.border,
    borderRadius: 2,
    marginHorizontal: 30,
    position: 'relative',
  },

  sliderThumb: {
    position: 'absolute',
    top: -6,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: COLORS.primary,
    ...SHADOWS.sm,
  },

  sliderMax: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    position: 'absolute',
    right: -30,
  },

  numberInput: {
    ...TYPOGRAPHY.h2,
    fontWeight: '700',
    color: COLORS.textPrimary,
    textAlign: 'center',
    paddingVertical: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  numberInputDisabled: {
    opacity: 0.6,
  },

  saveStatusContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
  },

  saveStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.full,
  },

  saveStatusSaving: {
    backgroundColor: 'rgba(20, 184, 166, 0.1)',
  },

  saveStatusSaved: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },

  saveStatusError: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
  },

  saveStatusText: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.primary,
  },

  disclaimerCard: {
    marginHorizontal: SPACING.xl,
    marginBottom: SPACING.xl,
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
    borderColor: 'rgba(16, 185, 129, 0.2)',
    borderWidth: 1,
  },

  disclaimerTitle: {
    ...TYPOGRAPHY.captionStrong,
    color: COLORS.accent,
    marginBottom: SPACING.xs,
  },

  disclaimerText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    lineHeight: 18,
  },
});