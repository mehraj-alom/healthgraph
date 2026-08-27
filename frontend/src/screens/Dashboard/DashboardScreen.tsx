import { StyleSheet, View, Text, ScrollView, SafeAreaView, RefreshControl, Dimensions } from 'react-native';
import { Canvas } from '@react-three/fiber/native';
import { useState } from 'react';
import { useBodyState } from '@/hooks/useBodyState';
import { Card, Button, Input } from '@/components';
import { COLORS, SPACING, BORDER_RADIUS, TYPOGRAPHY, SHADOWS } from '@/constants';

const { width } = Dimensions.get('window');

interface BodyStateData {
  structure_id: string;
  display_name: string;
  mesh_node_name: string;
  visual_status: string;
  severity: number;
  trend: string;
  latest_summary: string | null;
}

export default function DashboardScreen() {
  const { data: bodyState, isLoading, isError, refetch } = useBodyState();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'normal': return '#10b981';
      case 'mild_attention': return '#f59e0b';
      case 'warning': return '#f97316';
      case 'critical': return '#ef4444';
      default: return '#64748b';
    }
  };

  const trendIcon = (trend: string) => {
    switch (trend) {
      case 'improving': return '↗';
      case 'declining': return '↘';
      case 'stable': return '→';
      default: return '•';
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[COLORS.primary]}
          />
        }
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerContent}>
            <View>
              <Text style={styles.greeting}>Good morning</Text>
              <Text style={styles.userName}>Welcome back</Text>
            </View>
            <View style={styles.headerActions}>
              <Text style={styles.dateText}>{new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric'
              })}</Text>
            </View>
          </View>
        </View>

        {/* 3D Body Visualization */}
        <View style={styles.bodySection}>
          <View style={styles.bodyHeader}>
            <Text style={styles.sectionTitle}>Body Status</Text>
            <Text style={styles.bodySubtitle}>Real-time 3D visualization</Text>
          </View>
          <View style={styles.canvasContainer}>
            <Canvas
              style={styles.canvas}
              camera={{ position: [0, 0, 5], fov: 45 }}
              shadows
            >
              <ambientLight intensity={0.6} />
              <directionalLight position={[5, 10, 7]} intensity={1} castShadow />

              {/* Placeholder human body representation */}
              <group>
                {/* Head */}
                <mesh
                  position={[0, 1.8, 0]}
                  scale={0.25}
                  castShadow
                  receiveShadow
                >
                  <sphereGeometry args={[0.5, 32, 32]} />
                  <meshStandardMaterial
                    color={COLORS.primary}
                    metalness={0.1}
                    roughness={0.8}
                    transparent
                    opacity={0.3}
                  />
                </mesh>

                {/* Torso */}
                <mesh
                  position={[0, 1.1, 0]}
                  scale={[0.5, 0.8, 0.3]}
                  castShadow
                  receiveShadow
                >
                  <boxGeometry args={[1, 1, 1]} />
                  <meshStandardMaterial
                    color={COLORS.primary}
                    metalness={0.1}
                    roughness={0.8}
                    transparent
                    opacity={0.2}
                  />
                </mesh>

                {/* Arms */}
                <mesh
                  position={[-0.7, 1.3, 0]}
                  scale={[0.2, 0.8, 0.2]}
                  castShadow
                  receiveShadow
                >
                  <boxGeometry args={[1, 1, 1]} />
                  <meshStandardMaterial
                    color={COLORS.primary}
                    metalness={0.1}
                    roughness={0.8}
                    transparent
                    opacity={0.2}
                  />
                </mesh>

                <mesh
                  position={[0.7, 1.3, 0]}
                  scale={[0.2, 0.8, 0.2]}
                  castShadow
                  receiveShadow
                >
                  <boxGeometry args={[1, 1, 1]} />
                  <meshStandardMaterial
                    color={COLORS.primary}
                    metalness={0.1}
                    roughness={0.8}
                    transparent
                    opacity={0.2}
                  />
                </mesh>

                {/* Legs */}
                <mesh
                  position={[-0.3, 0.3, 0]}
                  scale={[0.2, 0.8, 0.2]}
                  castShadow
                  receiveShadow
                >
                  <boxGeometry args={[1, 1, 1]} />
                  <meshStandardMaterial
                    color={COLORS.primary}
                    metalness={0.1}
                    roughness={0.8}
                    transparent
                    opacity={0.2}
                  />
                </mesh>

                <mesh
                  position={[0.3, 0.3, 0]}
                  scale={[0.2, 0.8, 0.2]}
                  castShadow
                  receiveShadow
                >
                  <boxGeometry args={[1, 1, 1]} />
                  <meshStandardMaterial
                    color={COLORS.primary}
                    metalness={0.1}
                    roughness={0.8}
                    transparent
                    opacity={0.2}
                  />
                </mesh>
              </group>

              {/* Grid floor */}
              <mesh
                rotation={[-Math.PI / 2, 0, 0]}
                position={[0, -0.5, 0]}
                receiveShadow
              >
                <planeGeometry args={[10, 10]} />
                <meshStandardMaterial color="#1e293b" transparent opacity={0.3} />
              </mesh>
            </Canvas>

            {/* Legend overlay */}
            <View style={styles.canvasLegend}>
              <View style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: '#10b981' }]} />
                <Text style={styles.legendText}>Normal</Text>
              </View>
              <View style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: '#f59e0b' }]} />
                <Text style={styles.legendText}>Attention</Text>
              </View>
              <View style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: '#f97316' }]} />
                <Text style={styles.legendText}>Warning</Text>
              </View>
              <View style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: '#ef4444' }]} />
                <Text style={styles.legendText}>Critical</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Health Summary Cards */}
        <View style={styles.summarySection}>
          <Text style={styles.sectionTitle}>Health Summary</Text>
          <View style={styles.summaryGrid}>
            <Card style={styles.summaryCard} padding="md">
              <Text style={styles.summaryLabel}>Overall Status</Text>
              <Text style={[styles.summaryValue, { color: '#10b981' }]}>Normal</Text>
              <Text style={{ ...TYPOGRAPHY.caption, color: COLORS.textMuted }}>All systems normal</Text>
            </Card>
            <Card style={styles.summaryCard} padding="md">
              <Text style={styles.summaryLabel}>Active Observations</Text>
              <Text style={{ ...TYPOGRAPHY.h3, color: COLORS.primary }}>0</Text>
              <Text style={{ ...TYPOGRAPHY.caption, color: COLORS.textMuted }}>No active issues</Text>
            </Card>
            <Card style={styles.summaryCard} padding="md">
              <Text style={styles.summaryLabel}>Documents</Text>
              <Text style={{ ...TYPOGRAPHY.h3, color: COLORS.accent }}>1</Text>
              <Text style={{ ...TYPOGRAPHY.caption, color: COLORS.textMuted }}>Recent upload</Text>
            </Card>
          </View>
        </View>

        {/* Body State List */}
        {bodyState && bodyState.length > 0 && (
          <View style={styles.bodyStateSection}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Body Status</Text>
            </View>
            {bodyState.map((item: any) => (
              <Card key={item.structure_id} style={styles.bodyStateCard} padding="md">
                <View style={styles.bodyStateRow}>
                  <View style={styles.bodyStateInfo}>
                    <Text style={styles.bodyStateName}>{item.display_name}</Text>
                    <Text style={styles.bodyStateMeta}>
                      {item.finding_code} • {item.trend === 'stable' ? 'Stable' : item.trend}
                    </Text>
                    {item.latest_summary && (
                      <Text style={styles.summaryText} numberOfLines={2}>
                        {item.latest_summary}
                      </Text>
                    )}
                  </View>
                  <View style={[
                    styles.statusBadge,
                    { backgroundColor: statusColor(item.visual_status) + '20' }
                  ]}>
                    <View
                      style={[
                        styles.statusDot,
                        { backgroundColor: statusColor(item.visual_status) }
                      ]}
                    />
                    <Text style={[
                      styles.statusText,
                      { color: statusColor(item.visual_status) }
                    ]}>
                      {item.visual_status.replace('_', ' ')}
                    </Text>
                  </View>
                </View>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

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
    alignItems: 'flex-start',
  },
  greeting: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
  },
  userName: {
    ...TYPOGRAPHY.body,
    color: COLORS.textMuted,
  },
  headerActions: {
    alignItems: 'flex-end',
  },
  dateText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
  },
  bodySection: {
    paddingHorizontal: SPACING.xl,
    marginTop: SPACING.lg,
  },
  bodyHeader: {
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    ...TYPOGRAPHY.h2,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  bodySubtitle: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
  },
  canvasContainer: {
    height: 300,
    borderRadius: BORDER_RADIUS.xl,
    overflow: 'hidden',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  canvas: {
    flex: 1,
  },
  canvasLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: SPACING.md,
    marginTop: SPACING.md,
    paddingHorizontal: SPACING.md,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
  },
  summarySection: {
    marginTop: SPACING.xl,
    paddingHorizontal: SPACING.xl,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
    marginTop: SPACING.md,
  },
  summaryCard: {
    flex: 1,
    minWidth: 100,
    padding: SPACING.md,
  },
  summaryLabel: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    marginBottom: SPACING.xs,
  },
  summaryValue: {
    ...TYPOGRAPHY.h3,
  },
  bodyStateSection: {
    marginTop: SPACING.xl,
    paddingHorizontal: SPACING.xl,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  bodyStateCard: {
    marginBottom: SPACING.md,
  },
  bodyStateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: SPACING.md,
  },
  bodyStateInfo: {
    flex: 1,
  },
  bodyStateName: {
    ...TYPOGRAPHY.h3,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  bodyStateMeta: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textMuted,
    marginBottom: SPACING.xs,
  },
  summaryText: {
    ...TYPOGRAPHY.caption,
    color: COLORS.textSecondary,
    lineHeight: 20,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.full,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    ...TYPOGRAPHY.captionStrong,
    fontSize: 12,
  },
});
