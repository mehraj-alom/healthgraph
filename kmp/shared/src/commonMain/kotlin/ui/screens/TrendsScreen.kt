@file:OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
package com.healthgraph.shared.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.healthgraph.shared.theme.GlassCorner
import com.healthgraph.shared.theme.GlassElevation
import com.healthgraph.shared.theme.HealthGraphColors
import com.healthgraph.shared.theme.HealthGraphTypography
import com.healthgraph.shared.theme.liquidGlass
import com.healthgraph.shared.theme.rememberGlassAnimationState
import com.healthgraph.shared.ui.components.GlassCard
import com.healthgraph.shared.ui.components.LiquidButton
import com.healthgraph.shared.ui.components.LiquidButtonVariant
import com.healthgraph.shared.ui.components.LiquidButtonSize
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ShowChart
import androidx.compose.material.icons.filled.Expand
import androidx.compose.material.icons.filled.Download
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.Background

@Composable
fun TrendsScreen(
    modifier: androidx.compose.ui.Modifier = androidx.compose.ui.Modifier
) {
    val state = rememberGlassAnimationState()
    val selectedPeriod by remember { mutableStateOf(TimePeriod.MONTH) }
    val selectedMetric by remember { mutableStateOf(trendMetrics[0]) }

    Box(
        modifier = modifier
            .fillMaxSize()
            .liquidGlass(cornerRadius = 0.dp, elevation = 0.dp, tint = Color.Transparent, timeMs = state.timeMs)
    ) {
        Column(
            modifier = Modifier.fillMaxSize().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            ScreenHeader("Trends", "Long-term patterns & comparisons")

            // Period Selector
            GlassCard {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    TimePeriod.values().forEach { period ->
                        PeriodChip(period, period == selectedPeriod) { selectedPeriod = period }
                    }
                }
            }

            // Metric Selector
            GlassCard {
                LazyVerticalGrid(
                    cells = GridCells.Fixed(3),
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(trendMetrics) { metric ->
                        MetricChip(metric, metric == selectedMetric) { selectedMetric = metric }
                    }
                }
            }

            // Chart Area
            GlassCardElevated {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Row(horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("${selectedMetric.name} - ${selectedPeriod.label}", style = HealthGraphTypography.TitleLarge)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            LiquidButton(onClick = { /* expand */ }, label = "Expand", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.SMALL, icon = Icons.Default.Expand)
                            LiquidButton(onClick = { /* export */ }, label = "Export", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.SMALL, icon = Icons.Default.Download)
                        }
                    }

                    // Chart placeholder
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(240.dp)
                            .background(HealthGraphColors.SurfaceVariant.copy(alpha = 0.3f))
                            .clip(RoundedCornerShape(GlassCorner.MD))
                    ) {
                        // Chart would go here
                        Column(
                            modifier = Modifier.fillMaxSize(),
                            verticalArrangement = Arrangement.Center,
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Icon(Icons.Default.ShowChart, contentDescription = null, tint = HealthGraphColors.OnSurfaceVariant.copy(alpha = 0.5f), modifier = Modifier.size(48.dp))
                            androidx.compose.foundation.layout.Spacer(modifier = Modifier.height(8.dp))
                            Text("Chart: ${selectedMetric.name} (${selectedPeriod.label})", style = HealthGraphTypography.BodyMedium.copy(color = HealthGraphColors.OnSurfaceVariant))
                            Text("Interactive chart with trends, averages, comparisons", style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant.copy(alpha = 0.7f)))
                        }
                    }

                    // Summary stats
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        TrendStat("Current", selectedMetric.currentValue, selectedMetric.color)
                        TrendStat("Average", selectedMetric.avgValue, HealthGraphColors.Primary)
                        TrendStat("Change", selectedMetric.change, if (selectedMetric.change.startsWith("+")) HealthGraphColors.Success else HealthGraphColors.Error)
                        TrendStat("Best", selectedMetric.bestValue, HealthGraphColors.Accent)
                    }
                }
            }

            // Comparison Cards
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Comparisons", style = HealthGraphTypography.TitleLarge, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp))
                    ComparisonRow("vs Last Month", "+12%", HealthGraphColors.Success)
                    ComparisonRow("vs 3 Months Ago", "+28%", HealthGraphColors.Success)
                    ComparisonRow("vs Year Ago", "+45%", HealthGraphColors.Success)
                    ComparisonRow("vs Similar Age Group", "+8%", HealthGraphColors.Primary)
                }
            }
        }
    }
}

enum class TimePeriod(val label: String) {
    WEEK("7 Days"),
    MONTH("30 Days"),
    QUARTER("90 Days"),
    YEAR("1 Year"),
    ALL("All Time")
}

data class TrendMetric(
    val name: String,
    val currentValue: String,
    val avgValue: String,
    val change: String,
    val bestValue: String,
    val color: Color
)

val trendMetrics = listOf(
    TrendMetric("VO₂ Max", "42.3", "40.1", "+5.5%", "44.8", HealthGraphColors.Primary),
    TrendMetric("Weight", "78.2 kg", "79.5", "-1.3 kg", "76.0 kg", HealthGraphColors.Success),
    TrendMetric("Sleep Score", "87%", "82%", "+6%", "94%", HealthGraphColors.Accent),
    TrendMetric("HRV", "58 ms", "52 ms", "+11%", "68 ms", HealthGraphColors.Primary),
    TrendMetric("Resting HR", "52 bpm", "56 bpm", "-7%", "48 bpm", HealthGraphColors.Success),
    TrendMetric("Workouts/Week", "4.2", "3.5", "+20%", "5.0", HealthGraphColors.Accent),
    TrendMetric("Steps/Day", "9,842", "8,200", "+20%", "12,500", HealthGraphColors.Primary),
    TrendMetric("Calories Burned", "3,240", "2,890", "+12%", "3,800", HealthGraphColors.Warning),
    TrendMetric("Deep Sleep", "1h 42m", "1h 28m", "+16%", "2h 15m", HealthGraphColors.Success)
)

data class TrendStat(val label: String, val value: String, val color: Color)

@Composable
fun TrendStat(label: String, value: String, color: Color) {
    val s = rememberGlassAnimationState()
    Box(
        Modifier
            .weight(1f)
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, color.copy(alpha = 0.1f))
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp)
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(label, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
            Text(value, style = HealthGraphTypography.TitleMedium.copy(color = color))
        }
    }
}

@Composable
fun PeriodChip(period: TimePeriod, selected: Boolean, onClick: () -> Unit) {
    val s = rememberGlassAnimationState()
    val bg = if (selected) HealthGraphColors.Primary else HealthGraphColors.Surface
    val txt = if (selected) Color.White else HealthGraphColors.OnSurface

    Box(
        modifier = Modifier
            .weight(1f)
            .liquidGlass(GlassCorner.MD, if (selected) GlassElevation.Level2 else GlassElevation.Level1, if (selected) HealthGraphColors.Primary.copy(alpha = 0.2f) else HealthGraphColors.RefractionTint.copy(alpha = 0.05f), timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(12.dp, 8.dp)
            .fillMaxWidth()
            .onClick(onClick)
    ) {
        Text(period.label, style = HealthGraphTypography.LabelMedium.copy(color = txt), textAlign = TextAlign.Center)
    }
}

data class MetricChipItem(val metric: TrendMetric, val selected: Boolean, val onClick: () -> Unit)

@Composable
fun MetricChip(metric: TrendMetric, selected: Boolean, onClick: () -> Unit) {
    val s = rememberGlassAnimationState()
    val bg = if (selected) metric.color.copy(alpha = 0.15f) else HealthGraphColors.RefractionTint.copy(alpha = 0.05f)
    val border = if (selected) metric.color else Color.Transparent

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, if (selected) GlassElevation.Level2 else GlassElevation.Level1, bg, timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(12.dp, 8.dp)
            .onClick(onClick)
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(metric.name, style = HealthGraphTypography.LabelMedium.copy(color = if (selected) metric.color else HealthGraphColors.OnSurface))
            Text(metric.currentValue, style = HealthGraphTypography.TitleSmall.copy(color = if (selected) metric.color else HealthGraphColors.OnSurfaceVariant))
        }
    }
}

@Composable
fun ComparisonRow(label: String, change: String, color: Color) {
    val s = rememberGlassAnimationState()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, color.copy(alpha = 0.05f))
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, style = HealthGraphTypography.BodyMedium)
        Text(change, style = HealthGraphTypography.TitleMedium.copy(color = color))
    }
}

@Composable
fun GlassCardElevated(content: @Composable () -> Unit) {
    val s = rememberGlassAnimationState()
    Box(
        Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.XL, GlassElevation.Level3, HealthGraphColors.RefractionTintCool, timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.XL))
            .padding(20.dp),
        content = content
    )
}

@Composable
fun GlassCard(content: @Composable () -> Unit) {
    val s = rememberGlassAnimationState()
    Box(
        Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.LG, GlassElevation.Level2, timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.LG))
            .padding(16.dp),
        content = content
    )
}

@Composable
fun ScreenHeader(title: String, subtitle: String? = null) {
    val s = rememberGlassAnimationState()
    Box(
        Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, HealthGraphColors.RefractionTint, timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp)
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = HealthGraphTypography.HeadlineMedium)
            subtitle?.let { Text(it, style = HealthGraphTypography.BodyMedium.copy(color = HealthGraphColors.OnSurfaceVariant)) }
        }
    }
}