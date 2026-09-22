import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Skeleton, Card, Chip, SectionHeader } from '@/components';
import { HealthFact } from '@/components/HealthFact';
import { GV, TYPE, SPACE, FONT } from '@/theme/guava';
import { StageGradient } from '@/components/StageGradient';
import { useTrends } from '@/hooks/useTrends';
import { useTrendRange, TREND_RANGE_ORDER, TREND_RANGES } from '@/context/TrendRangeContext';
import type {
  TrendsResponse,
  DailyWellbeingPoint,
  DailySleepPoint,
  ScatterPoint,
  SymptomSummary,
  SymptomTimeSeries,
} from '@/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SCORE_LABELS: Record<number, string> = {
  1: 'Very low', 2: 'Low', 3: 'Moderate', 4: 'High', 5: 'Very high',
};

const LINE_COLORS = {
  wellbeing: GV.teal,
  energy: GV.cta,
  stress: GV.fx.blue,
  sleepDuration: GV.fx.sky,
  sleepQuality: GV.fx.green,
  symptom: GV.fx.blue,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function trendColor(direction: string): string {
  if (direction === 'improving') return GV.cta;
  if (direction === 'declining') return GV.danger;
  return GV.muted;
}

function trendIcon(direction: string): string {
  if (direction === 'improving') return '↑';
  if (direction === 'declining') return '↓';
  return '→';
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateAxis(dateStr: string, index: number, total: number): string {
  if (total <= 7) return formatDateShort(dateStr);
  if (index % Math.ceil(total / 6) === 0) return formatDateShort(dateStr);
  return '';
}

function TrendsScrollContainer({ embedded, children }: { embedded: boolean; children: React.ReactNode }) {
  if (embedded) return <View style={styles.scrollContent}>{children}</View>;
  return (
    <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Chart primitives
// ---------------------------------------------------------------------------

function LineChart({
  data,
  color,
  height = 100,
  yMin,
  yMax,
  showDots = true,
  showLabels = true,
}: {
  data: { date: string; value: number | null }[];
  color: string;
  height?: number;
  yMin?: number;
  yMax?: number;
  showDots?: boolean;
  showLabels?: boolean;
}) {
  const [selectedPoint, setSelectedPoint] = useState<{ date: string; value: number } | null>(null);
  const validData = data.filter((d) => d.value !== null) as { date: string; value: number }[];
  if (validData.length === 0) {
    return (
      <View style={[styles.chartContainer, { height }]}>
        <Text style={styles.noDataText}>No data in this period</Text>
      </View>
    );
  }

  const vals = validData.map((d) => d.value);
  const minV = yMin ?? Math.min(...vals) - 0.5;
  const maxV = yMax ?? Math.max(...vals) + 0.5;
  const range = maxV - minV || 1;

  const points = data.map((d, i) => {
    if (d.value === null) return null;
    const x = data.length > 1 ? (i / (data.length - 1)) * 100 : 50;
    const y = 100 - ((d.value - minV) / range) * 100;
    return { x, y, value: d.value, date: d.date };
  });

  return (
    <View style={styles.chartContainer}>
      {showLabels && (
        <View style={styles.yAxis}>
          <Text style={styles.axisLabel}>{Math.round(maxV)}</Text>
          <Text style={styles.axisLabel}>{Math.round((maxV + minV) / 2)}</Text>
          <Text style={styles.axisLabel}>{Math.round(minV)}</Text>
        </View>
      )}

      <View style={[styles.chartArea, { height }]}>
        {[0.25, 0.5, 0.75].map((frac) => (
          <View key={frac} style={[styles.gridLine, { top: `${frac * 100}%` }]} />
        ))}

        {points.map((pt, i) => {
          if (!pt) return null;
          const nextPt = points[i + 1];
          return (
            <View key={i}>
              {showDots && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${formatDateShort(pt.date)} ${pt.value}`}
                  onPress={() => setSelectedPoint(pt)}
                  style={[styles.chartDot, { left: `${pt.x}%`, top: `${pt.y}%`, backgroundColor: color }]}
                />
              )}
              {nextPt && (
                <View
                  style={[
                    styles.chartLine,
                    {
                      left: `${pt.x}%`,
                      top: `${pt.y}%`,
                      width: `${nextPt.x - pt.x}%`,
                      height: 2,
                      backgroundColor: color,
                      transform: [
                        {
                          rotate: `${Math.atan2((nextPt.y - pt.y) * height, ((nextPt.x - pt.x) / 100) * 200)}rad`,
                        },
                      ],
                      transformOrigin: 'left center',
                    },
                  ]}
                />
              )}
            </View>
          );
        })}
      </View>

      {selectedPoint ? (
        <Pressable style={styles.tooltip} onPress={() => setSelectedPoint(null)}>
          <Text style={styles.tooltipText}>
            {formatDateShort(selectedPoint.date)}: {selectedPoint.value.toFixed(1)}
          </Text>
        </Pressable>
      ) : null}

      {showLabels && data.length > 1 && (
        <View style={styles.xAxis}>
          {data.map((d, i) => {
            const label = formatDateAxis(d.date, i, data.length);
            if (!label) return null;
            return <Text key={i} style={styles.xAxisLabel}>{label}</Text>;
          })}
        </View>
      )}
    </View>
  );
}

function ScatterPlot({
  points,
  color,
  xLabel,
  yLabel,
  height = 160,
}: {
  points: ScatterPoint[];
  color: string;
  xLabel: string;
  yLabel: string;
  height?: number;
}) {
  const [selectedPoint, setSelectedPoint] = useState<ScatterPoint | null>(null);
  if (points.length === 0) {
    return (
      <View style={[styles.chartContainer, { height }]}>
        <Text style={styles.noDataText}>No paired data available</Text>
      </View>
    );
  }

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs) - 30;
  const xMax = Math.max(...xs) + 30;
  const yMin = Math.min(...ys) - 0.5;
  const yMax = Math.max(...ys) + 0.5;
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  return (
    <View style={styles.chartContainer}>
      <View style={[styles.chartArea, { height }]}>
        {[0.25, 0.5, 0.75].map((frac) => (
          <View key={frac} style={[styles.gridLine, { top: `${frac * 100}%` }]} />
        ))}
        {[0.25, 0.5, 0.75].map((frac) => (
          <View key={`v${frac}`} style={[styles.gridLineVert, { left: `${frac * 100}%` }]} />
        ))}

        {points.map((pt, i) => {
          const px = ((pt.x - xMin) / xRange) * 100;
          const py = 100 - ((pt.y - yMin) / yRange) * 100;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${formatDateShort(pt.date)} ${pt.x}, ${pt.y}`}
              onPress={() => setSelectedPoint(pt)}
              key={i}
              style={[styles.scatterDot, { left: `${px}%`, top: `${py}%`, backgroundColor: color }]}
            />
          );
        })}
      </View>

      {selectedPoint ? (
        <Pressable style={styles.tooltip} onPress={() => setSelectedPoint(null)}>
          <Text style={styles.tooltipText}>
            {formatDateShort(selectedPoint.date)}: {formatMinutes(Math.round(selectedPoint.x))}, {selectedPoint.y.toFixed(1)}
          </Text>
        </Pressable>
      ) : null}

      <View style={styles.scatterAxis}>
        <Text style={styles.scatterAxisLabel}>{xLabel}: {formatMinutes(Math.round(xMin))}–{formatMinutes(Math.round(xMax))}</Text>
        <Text style={styles.scatterAxisLabel}>{yLabel}: {yMin.toFixed(1)}–{yMax.toFixed(1)}</Text>
      </View>
    </View>
  );
}

function HorizontalBarChart({ items, color }: { items: { label: string; value: number }[]; color: string }) {
  const maxValue = Math.max(...items.map((i) => i.value), 1);

  return (
    <View style={styles.barChart}>
      {items.map((item, i) => (
        <View key={i} style={styles.barRow}>
          <Text style={styles.barLabel} numberOfLines={1}>{item.label}</Text>
          <View style={styles.barTrack}>
            <View style={[styles.barFill, { width: `${(item.value / maxValue) * 100}%`, backgroundColor: color }]} />
          </View>
          <Text style={styles.barValue}>{item.value}</Text>
        </View>
      ))}
    </View>
  );
}

function ActivityChart({ points }: { points: { date: string; event_count: number }[] }) {
  const maxValue = Math.max(...points.map((point) => point.event_count), 1);

  return (
    <View style={styles.activityChart}>
      {points.map((point) => (
        <View key={point.date} style={styles.activityColumn}>
          <View style={styles.activityTrack}>
            <View style={[styles.activityFill, { height: `${(point.event_count / maxValue) * 100}%` }]} />
          </View>
          <Text style={styles.activityValue}>{point.event_count}</Text>
          <Text style={styles.activityLabel}>{formatDateShort(point.date)}</Text>
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Section + Card components
// ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <SectionHeader title={title} />
      {children}
    </View>
  );
}

function StatCard({ label, value, sublabel, color }: {
  label: string;
  value: string | number;
  sublabel?: string;
  color?: string;
}) {
  return (
    <Card style={styles.statCardInner}>
      {color ? <View style={[styles.statDot, { backgroundColor: color }]} /> : null}
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      {sublabel ? <Text style={styles.statSublabel}>{sublabel}</Text> : null}
    </Card>
  );
}

function TrendBadge({ trend }: { trend: { direction: string; label: string } }) {
  return (
    <View style={styles.trendBadge}>
      <View style={[styles.trendDot, { backgroundColor: trendColor(trend.direction) }]} />
      <Text style={styles.trendText}>
        {trendIcon(trend.direction)} {trend.label}
      </Text>
    </View>
  );
}

function InsightCard({ text }: { text: string }) {
  return (
    <Card style={styles.insightCardInner}>
      <View style={styles.insightIconTile}>
        <Text style={styles.insightIconText}>!</Text>
      </View>
      <Text style={styles.insightText}>{text}</Text>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function TrendsScreen({ embedded = false }: { embedded?: boolean }) {
  const navigation = useNavigation();
  // Single global range — one selection drives every correlation graph.
  const { range, days: selectedDays, setRange } = useTrendRange();
  const [selectedSymptom, setSelectedSymptom] = useState<string | null>(null);

  const { data: trend, isLoading, error } = useTrends(selectedDays);

  // Range transitions (week → month → year) refetch while the previous
  // range's charts are still on screen. Instead of flashing a full-screen
  // spinner, keep the stale charts visible under a blur + skeleton overlay
  // so the switch feels continuous and premium.
  const hasContent = trend != null && trend.logged_days > 0;
  const transitioning = isLoading && hasContent;

  const availableSymptoms = trend?.available_symptoms ?? [];
  const activeSymptomId = selectedSymptom ?? availableSymptoms[0] ?? null;
  const activeSymptomSeries = trend?.symptom_time_series.find(
    (ts) => ts.concept_id === activeSymptomId,
  );

  const sleepEnergyScatter = trend?.sleep_energy_scatter ?? [];
  const sleepStressScatter = trend?.sleep_stress_scatter ?? [];

  return (
    <SafeAreaView style={embedded ? styles.embeddedContainer : styles.container} edges={embedded ? [] : ['top']} >
      <StageGradient />
      {!embedded && (
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Trends</Text>
        </View>
      )}
      {embedded && (
        <View style={styles.embeddedHeader}>
          <Text style={styles.headerTitle}>Trends</Text>
          <Text style={styles.embeddedSubtitle}>This {TREND_RANGES[range].label.toLowerCase()}</Text>
        </View>
      )}

      {/* Range selector — global: one tap retunes every graph */}
      <View style={styles.rangeRow}>
        {TREND_RANGE_ORDER.map((key) => {
          return (
            <Chip
              key={key}
              label={TREND_RANGES[key].label}
              selected={range === key}
              color={GV.cta}
              onPress={() => { setRange(key); setSelectedSymptom(null); }}
            />
          );
        })}
      </View>

      {isLoading && !hasContent ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={GV.teal} />
          <Text style={styles.loadingText}>Loading trends…</Text>
          <HealthFact style={styles.factText} />
        </View>
      ) : error && !hasContent ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Unable to load trends</Text>
          <Text style={styles.emptyText}>Please check your connection and try again.</Text>
        </View>
      ) : !trend || trend.logged_days === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No trends yet</Text>
          <Text style={styles.emptyText}>Start your first Daily Log to begin building your health history.</Text>
        </View>
      ) : (
        <View style={embedded ? undefined : styles.contentWrap}>
        <TrendsScrollContainer embedded={embedded}>
          {/* HEALTH OVERVIEW */}
          <Section title="Health Overview">
            <View style={styles.summaryRow}>
              <StatCard label="Days logged" value={trend.logged_days} />
              {trend.avg_wellbeing !== null && (
                <StatCard label="Avg wellbeing" value={`${trend.avg_wellbeing}`} sublabel={SCORE_LABELS[Math.round(trend.avg_wellbeing)]} color={GV.teal} />
              )}
            </View>
            <View style={styles.summaryRow}>
              {trend.avg_energy !== null && (
                <StatCard label="Avg energy" value={`${trend.avg_energy}`} sublabel={SCORE_LABELS[Math.round(trend.avg_energy)]} color={GV.cta} />
              )}
              {trend.avg_stress !== null && (
                <StatCard label="Avg stress" value={`${trend.avg_stress}`} sublabel={SCORE_LABELS[Math.round(trend.avg_stress)]} color={GV.fx.blue} />
              )}
            </View>
          </Section>

          {/* Wellbeing */}
          <Section title="Wellbeing">
            <TrendBadge trend={trend.wellbeing_trend} />
            <LineChart data={trend.wellbeing_points.map((p) => ({ date: p.date, value: p.wellbeing }))} color={LINE_COLORS.wellbeing} yMin={0.5} yMax={5.5} />
          </Section>

          {/* Energy */}
          <Section title="Energy">
            <LineChart data={trend.wellbeing_points.map((p) => ({ date: p.date, value: p.energy }))} color={LINE_COLORS.energy} yMin={0.5} yMax={5.5} />
          </Section>

          {/* Stress */}
          <Section title="Stress">
            <LineChart data={trend.wellbeing_points.map((p) => ({ date: p.date, value: p.stress }))} color={LINE_COLORS.stress} yMin={0.5} yMax={5.5} />
          </Section>

          {/* Sleep */}
          <Section title="Sleep">
            <TrendBadge trend={trend.sleep_trend} />
            {trend.avg_sleep_minutes !== null && (
              <View style={styles.summaryRow}>
                <StatCard label="Avg duration" value={formatMinutes(trend.avg_sleep_minutes)} color={GV.fx.sky} />
                {trend.avg_sleep_quality !== null && (
                  <StatCard label="Avg quality" value={`${trend.avg_sleep_quality}/5`} color={GV.fx.green} />
                )}
                {trend.min_sleep_minutes !== null && trend.max_sleep_minutes !== null && (
                  <StatCard label="Range" value={`${formatMinutes(trend.min_sleep_minutes)}–${formatMinutes(trend.max_sleep_minutes)}`} />
                )}
              </View>
            )}
          </Section>

          {/* Sleep Duration */}
          <Section title="Sleep Duration">
            <LineChart data={trend.sleep_points.map((p) => ({ date: p.date, value: p.duration_minutes !== null ? p.duration_minutes / 60 : null }))} color={LINE_COLORS.sleepDuration} yMin={0} />
            <Text style={styles.chartAxisUnit}>hours</Text>
          </Section>

          {/* Sleep Quality */}
          <Section title="Sleep Quality">
            <LineChart data={trend.sleep_points.map((p) => ({ date: p.date, value: p.sleep_quality }))} color={LINE_COLORS.sleepQuality} yMin={0.5} yMax={5.5} />
          </Section>

          {/* Sleep & Energy */}
          <Section title="Sleep & Energy">
            <ScatterPlot points={sleepEnergyScatter} color={LINE_COLORS.energy} xLabel="Sleep" yLabel="Energy" />
            {trend.sleep_energy_correlation.paired_count > 0 && (
              <View style={styles.correlationBadge}>
                <Text style={styles.correlationText}>{trend.sleep_energy_correlation.description}</Text>
                <Text style={styles.correlationMeta}>Based on {trend.sleep_energy_correlation.paired_count} paired observations</Text>
              </View>
            )}
          </Section>

          {/* Sleep & Stress */}
          <Section title="Sleep & Stress">
            <ScatterPlot points={sleepStressScatter} color={LINE_COLORS.stress} xLabel="Sleep" yLabel="Stress" />
            {trend.sleep_stress_correlation.paired_count > 0 && (
              <View style={styles.correlationBadge}>
                <Text style={styles.correlationText}>{trend.sleep_stress_correlation.description}</Text>
                <Text style={styles.correlationMeta}>Based on {trend.sleep_stress_correlation.paired_count} paired observations</Text>
              </View>
            )}
          </Section>

          {/* Symptoms */}
          <Section title="Symptoms">
            {trend.symptom_summaries.length > 0 ? (
              trend.symptom_summaries.map((sym) => (
                <SymptomRow key={sym.concept_id ?? sym.display_name} symptom={sym} />
              ))
            ) : (
              <Text style={styles.noDataText}>No symptoms logged in this period.</Text>
            )}
          </Section>

          {/* Symptom Frequency */}
          {trend.symptom_summaries.length > 0 && (
            <Section title="Most Frequent Symptoms">
              <HorizontalBarChart items={trend.symptom_summaries.slice(0, 8).map((s) => ({ label: s.display_name, value: s.count }))} color={GV.fx.blue} />
            </Section>
          )}

          {/* Symptom Severity */}
          {trend.symptom_time_series.length > 0 && (
            <Section title="Symptom Severity">
              <View style={styles.symptomSelector}>
                {trend.symptom_time_series.map((ts) => {
                  return (
                    <Chip key={ts.concept_id} label={ts.display_name} selected={ts.concept_id === activeSymptomId} color={GV.cta} onPress={() => setSelectedSymptom(ts.concept_id)} />
                  );
                })}
              </View>

              {activeSymptomSeries && activeSymptomSeries.points.length > 0 ? (
                <LineChart
                  data={(() => {
                    const allDates = trend.wellbeing_points.map((p) => p.date);
                    const severityMap = new Map(activeSymptomSeries.points.map((p) => [p.date, p.severity]));
                    return allDates.map((d) => ({ date: d, value: severityMap.get(d) ?? null }));
                  })()}
                  color={LINE_COLORS.symptom}
                  yMin={0}
                  yMax={10.5}
                  showDots={true}
                />
              ) : (
                <Text style={styles.noDataText}>No severity data for this symptom in the selected period.</Text>
              )}
            </Section>
          )}

          {/* Medical Records */}
          <Section title="Health Records">
            <View style={styles.summaryRow}>
              <StatCard label="Documents" value={trend.documents_processed} />
              <StatCard label="Clinical events" value={trend.clinical_events_extracted} />
            </View>
            {trend.medical_record_activity.length > 0 ? (
              <ActivityChart points={trend.medical_record_activity} />
            ) : (
              <Text style={styles.noDataText}>No medical record activity in this period.</Text>
            )}
          </Section>

          {/* Insights */}
          {trend.insights.length > 0 && (
            <Section title="Insights">
              {trend.insights.map((insight, i) => (
                <InsightCard key={i} text={insight.text} />
              ))}
            </Section>
          )}

          <View style={{ height: 48 }} />
        </TrendsScrollContainer>
        {transitioning && (
          <View
            style={styles.transitionOverlay}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={`Updating trends to ${TREND_RANGES[range].label}`}
          >
            <View style={styles.transitionCard}>
              <View style={styles.transitionPill}>
                <ActivityIndicator size="small" color={GV.cta} />
                <Text style={styles.transitionPillText}>
                  Updating to {TREND_RANGES[range].label}…
                </Text>
              </View>
              <Skeleton width="45%" height={12} />
              <Skeleton width="100%" height={110} accent />
              <Skeleton width="70%" height={14} />
            </View>
          </View>
        )}
        </View>
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Dual line chart
// ---------------------------------------------------------------------------

function DualLineChart({ dataA, dataB, colorA, colorB, height = 100, yMin, yMax }: {
  dataA: { date: string; value: number | null }[];
  dataB: { date: string; value: number | null }[];
  colorA: string;
  colorB: string;
  height?: number;
  yMin?: number;
  yMax?: number;
}) {
  const allVals = [...dataA.filter((d) => d.value !== null).map((d) => d.value!), ...dataB.filter((d) => d.value !== null).map((d) => d.value!)];
  if (allVals.length === 0) {
    return <View style={[styles.chartContainer, { height }]}><Text style={styles.noDataText}>No data in this period</Text></View>;
  }

  const minV = yMin ?? Math.min(...allVals) - 0.5;
  const maxV = yMax ?? Math.max(...allVals) + 0.5;
  const range = maxV - minV || 1;
  const total = Math.max(dataA.length, dataB.length);

  function renderLine(data: { date: string; value: number | null }[], color: string, key: string) {
    const points = data.map((d, i) => {
      if (d.value === null) return null;
      const x = total > 1 ? (i / (total - 1)) * 100 : 50;
      const y = 100 - ((d.value - minV) / range) * 100;
      return { x, y };
    });

    return points.map((pt, i) => {
      if (!pt) return null;
      const nextPt = points[i + 1];
      return (
        <View key={`${key}-${i}`}>
          <View style={[styles.chartDot, { left: `${pt.x}%`, top: `${pt.y}%`, backgroundColor: color }]} />
          {nextPt && (
            <View style={[styles.chartLine, { left: `${pt.x}%`, top: `${pt.y}%`, width: `${nextPt.x - pt.x}%`, height: 2, backgroundColor: color, transform: [{ rotate: `${Math.atan2((nextPt.y - pt.y) * height, ((nextPt.x - pt.x) / 100) * 200)}rad` }], transformOrigin: 'left center' }]} />
          )}
        </View>
      );
    });
  }

  return (
    <View style={styles.chartContainer}>
      <View style={[styles.chartArea, { height }]}>
        {[0.25, 0.5, 0.75].map((frac) => (<View key={frac} style={[styles.gridLine, { top: `${frac * 100}%` }]} />))}
        {renderLine(dataA, colorA, 'a')}
        {renderLine(dataB, colorB, 'b')}
      </View>
      {dataA.length > 1 && (
        <View style={styles.xAxis}>
          {dataA.map((d, i) => {
            const label = formatDateAxis(d.date, i, dataA.length);
            if (!label) return null;
            return <Text key={i} style={styles.xAxisLabel}>{label}</Text>;
          })}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Symptom row
// ---------------------------------------------------------------------------

function SymptomRow({ symptom }: { symptom: SymptomSummary }) {
  const severityLabel = symptom.avg_severity !== null ? `Severity ${symptom.avg_severity}/10` : null;
  return (
    <View style={styles.symptomRow}>
      <View style={styles.symptomInfo}>
        <Text style={styles.symptomName}>{symptom.display_name}</Text>
        <Text style={styles.symptomMeta}>
          {symptom.count} {symptom.count === 1 ? 'entry' : 'entries'}{severityLabel ? ` · ${severityLabel}` : ''}
        </Text>
      </View>
      <Text style={styles.symptomDate}>{formatDateShort(symptom.latest_date)}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: GV.stage },
  embeddedContainer: { backgroundColor: 'transparent', overflow: 'visible' },

  header: {
    alignItems: 'center',
    paddingHorizontal: SPACE.screenH,
    paddingVertical: 8,
  },
  headerTitle: { ...TYPE.display, color: '#FFFFFF', textAlign: 'center' },
  embeddedHeader: { paddingTop: 24, paddingBottom: 8 },
  embeddedSubtitle: { ...TYPE.caption, color: GV.fog, marginTop: 8 },

  rangeRow: {
    flexDirection: 'row',
    paddingHorizontal: SPACE.screenH,
    paddingVertical: 8,
    gap: 8,
    backgroundColor: GV.stage,
  },

  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { ...TYPE.body, color: GV.fog },
  factText: { ...TYPE.caption, color: GV.fog, textAlign: 'center', maxWidth: 300 },
  // Range-transition layer: stale charts stay mounted underneath while the
  // new range loads; the flat stage + white skeleton card sits on top and
  // swallows touches so users can't act on stale numbers mid-flight.
  contentWrap: { flex: 1 },
  transitionOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACE.screenH,
    backgroundColor: GV.stage,
    opacity: 0.96,
  },
  transitionCard: {
    width: '100%',
    maxWidth: 340,
    gap: 8,
  },
  transitionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: SPACE.rPill,
    backgroundColor: GV.wash,
  },
  transitionPillText: { ...TYPE.caption, fontFamily: FONT.semi, color: GV.cta, fontSize: 12 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACE.cardPad },
  emptyTitle: { ...TYPE.title, color: '#FFFFFF', marginBottom: 8 },
  emptyText: { ...TYPE.body, color: GV.fog, textAlign: 'center' },

  scrollContent: { paddingHorizontal: SPACE.screenH, paddingBottom: 32, gap: SPACE.sectionGap },

  section: { marginTop: SPACE.sectionGap, gap: SPACE.cardGap },
  sectionTitle: { ...TYPE.title, color: '#FFFFFF', marginBottom: 8 },

  summaryRow: { flexDirection: 'row', gap: SPACE.cardGap, flexWrap: 'wrap' },
  statCardInner: {
    flex: 1,
    minWidth: 90,
    alignItems: 'center',
  },
  statDot: { width: 8, height: 8, borderRadius: 4, marginBottom: 8 },
  statLabel: { ...TYPE.caption, color: GV.muted, marginBottom: 8 },
  statValue: { ...TYPE.title, color: GV.ink, fontSize: 20 },
  statSublabel: { ...TYPE.caption, color: GV.muted, marginTop: 2 },

  trendBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    backgroundColor: GV.card,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: SPACE.rPill,
    marginTop: 8,
    marginBottom: 8,
  },
  trendDot: { width: 8, height: 8, borderRadius: 4 },
  trendText: { ...TYPE.caption, fontFamily: FONT.semi, color: GV.ink },

  chartContainer: { marginTop: 8, backgroundColor: GV.card, borderRadius: SPACE.rCard, padding: SPACE.cardPad },
  chartArea: {
    position: 'relative',
    backgroundColor: GV.card,
    borderRadius: 12,
    overflow: 'hidden',
  },
  chartDot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, marginLeft: -4, marginTop: -4, zIndex: 2 },
  chartLine: { position: 'absolute', zIndex: 1 },
  gridLine: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: GV.line, opacity: 0.6 },
  gridLineVert: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: GV.line, opacity: 0.6 },

  yAxis: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 30, justifyContent: 'space-between', paddingVertical: 4, zIndex: 3 },
  axisLabel: { ...TYPE.caption, color: GV.muted, fontSize: 10, textAlign: 'right' },
  xAxis: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, marginTop: 4 },
  xAxisLabel: { ...TYPE.caption, color: GV.muted, fontSize: 10 },
  chartAxisUnit: { ...TYPE.caption, color: GV.muted, marginTop: 4 },
  tooltip: { alignSelf: 'center', backgroundColor: GV.ink, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginTop: 8 },
  tooltipText: { ...TYPE.caption, color: '#FFFFFF' },

  scatterDot: { position: 'absolute', width: 10, height: 10, borderRadius: 5, marginLeft: -5, marginTop: -5, opacity: 0.8 },
  scatterAxis: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  scatterAxisLabel: { ...TYPE.caption, color: GV.muted, fontSize: 10 },

  correlationBadge: {
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    padding: SPACE.cardPad,
    marginTop: 8,
  },
  correlationText: { ...TYPE.body, color: GV.ink },
  correlationMeta: { ...TYPE.caption, color: GV.muted, marginTop: 8 },

  barChart: { gap: 8, backgroundColor: GV.card, borderRadius: SPACE.rCard, padding: SPACE.cardPad },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barLabel: { ...TYPE.body, color: GV.ink, width: 120, textAlign: 'right' },
  barTrack: { flex: 1, height: 16, backgroundColor: GV.wash, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  barValue: { ...TYPE.caption, fontFamily: FONT.semi, color: GV.ink, width: 24 },

  activityChart: { height: 140, flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingTop: 16, backgroundColor: GV.card, borderRadius: SPACE.rCard, padding: SPACE.cardPad },
  activityColumn: { flex: 1, alignItems: 'center', minWidth: 28 },
  activityTrack: { height: 90, width: '70%', justifyContent: 'flex-end', backgroundColor: GV.wash },
  activityFill: { width: '100%', backgroundColor: GV.cta, minHeight: 2 },
  activityValue: { ...TYPE.caption, fontFamily: FONT.semi, color: GV.ink, fontSize: 10, marginTop: 2 },
  activityLabel: { ...TYPE.caption, color: GV.muted, fontSize: 9, marginTop: 2 },

  symptomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: GV.card,
    borderRadius: SPACE.rCard,
    paddingVertical: 12,
    paddingHorizontal: SPACE.cardPad,
  },
  symptomInfo: { flex: 1 },
  symptomName: { ...TYPE.body, fontFamily: FONT.semi, color: GV.ink },
  symptomMeta: { ...TYPE.caption, color: GV.muted, marginTop: 2 },
  symptomDate: { ...TYPE.caption, color: GV.muted, marginLeft: 16 },

  symptomSelector: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },

  insightCardInner: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  insightIconTile: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: GV.wash,
    alignItems: 'center',
    justifyContent: 'center',
  },
  insightIconText: { ...TYPE.caption, fontFamily: FONT.semi, color: GV.cta },
  insightText: { ...TYPE.body, color: GV.ink, flex: 1 },

  noDataText: {
    ...TYPE.body,
    color: GV.fog,
    paddingVertical: 8,
  },
});
