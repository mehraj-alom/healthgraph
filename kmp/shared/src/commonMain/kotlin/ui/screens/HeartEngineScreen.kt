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
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.MonitorHeart
import androidx.compose.foundation.shape.RoundedCornerShape

@Composable
fun HeartEngineScreen(
    modifier: androidx.compose.ui.Modifier = androidx.compose.ui.Modifier
) {
    val state = rememberGlassAnimationState()

    Box(
        modifier = modifier
            .fillMaxSize()
            .liquidGlass(cornerRadius = 0.dp, elevation = 0.dp, tint = Color.Transparent, timeMs = state.timeMs)
    ) {
        Column(
            modifier = Modifier.fillMaxSize().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            ScreenHeader("Heart Engine", "HRV, resting HR, cardio fitness")

            // Key Metrics Card
            GlassCardElevated(tint = HealthGraphColors.Error.copy(alpha = 0.15f)) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        HeartMetric("HRV", "58 ms", "+5 ms", HealthGraphColors.Success, Icons.Default.Favorite)
                        HeartMetric("Resting HR", "52 bpm", "-3 bpm", HealthGraphColors.Success, Icons.Default.MonitorHeart)
                        HeartMetric("Cardio Fitness", "42.3", "+1.2", HealthGraphColors.Primary, Icons.Default.TrendingUp)
                    }

                    // HRV Trend mini chart
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(120.dp)
                            .background(HealthGraphColors.SurfaceVariant.copy(alpha = 0.3f))
                            .clip(RoundedCornerShape(GlassCorner.MD))
                    ) {
                        Column(modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                            Icon(Icons.Default.ShowChart, contentDescription = null, tint = HealthGraphColors.OnSurfaceVariant.copy(alpha = 0.5f), modifier = Modifier.size(48.dp))
                            Text("HRV Trend (30 days)", style = HealthGraphTypography.BodyMedium.copy(color = HealthGraphColors.OnSurfaceVariant))
                        }
                    }
                }
            }

            // Readiness Indicators
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Readiness", style = HealthGraphTypography.TitleLarge, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp))
                    ReadinessRow("HRV Balance", "Optimal", "Within normal range", HealthGraphColors.Success)
                    ReadinessRow("Resting HR", "Good", "Below 10-year avg", HealthGraphColors.Success)
                    ReadinessRow("Recovery", "Ready", "HRV + RHR favorable", HealthGraphColors.Success)
                    ReadinessRow("Temperature", "Normal", "36.8°C", HealthGraphColors.Primary)
                    ReadinessRow("Respiratory Rate", "Normal", "15.2 rpm", HealthGraphColors.Primary)
                }
            }

            // Weekly Trend
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("7-Day HRV", style = HealthGraphTypography.TitleLarge, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp))
                    HrvTrendRow("Mon", 52, 54)
                    HrvTrendRow("Tue", 55, 56)
                    HrvTrendRow("Wed", 48, 52)
                    HrvTrendRow("Thu", 56, 58)
                    HrvTrendRow("Fri", 60, 62)
                    HrvTrendRow("Sat", 62, 65)
                    HrvTrendRow("Sun", 58, 60)
                }
            }

            // Actions
            GlassCard {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    LiquidButton(onClick = { /* measure */ }, label = "Measure HRV", variant = LiquidButtonVariant.FILLED, size = LiquidButtonSize.LARGE, modifier = Modifier.weight(1f), icon = Icons.Default.MonitorHeart)
                    LiquidButton(onClick = { /* ecg */ }, label = "ECG Scan", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.LARGE, modifier = Modifier.weight(1f), icon = Icons.Default.Favorite)
                }
            }
        }
    }
}

data class HeartMetric(
    val label: String,
    val value: String,
    val change: String,
    val color: Color,
    val icon: androidx.compose.ui.graphics.vector.ImageVector
)

@Composable
fun HeartMetric(metric: HeartMetric) {
    val s = rememberGlassAnimationState()
    val changeColor = if (metric.change.startsWith("+") || metric.change.startsWith("-") && metric.label == "Resting HR") HealthGraphColors.Success else HealthGraphColors.Error

    Box(
        Modifier
            .weight(1f)
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, metric.color.copy(alpha = 0.12f))
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp)
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Box(
                modifier = Modifier.size(40.dp).liquidGlass(GlassCorner.Full, GlassElevation.Level1, metric.color.copy(alpha = 0.15f)).clip(RoundedCornerShape(GlassCorner.Full)),
                contentAlignment = Alignment.Center
            ) {
                Icon(imageVector = metric.icon, contentDescription = null, tint = metric.color, modifier = Modifier.size(20.dp))
            }
            Text(metric.value, style = HealthGraphTypography.TitleMedium.copy(color = metric.color))
            Text(metric.label, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
            Text(metric.change, style = HealthGraphTypography.Caption.copy(color = changeColor))
        }
    }
}

data class ReadinessItem(val label: String, val status: String, val detail: String, val color: Color)

@Composable
fun ReadinessRow(label: String, status: String, detail: String, color: Color) {
    val s = rememberGlassAnimationState()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, color.copy(alpha = 0.05f), timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column {
            Text(label, style = HealthGraphTypography.BodyMedium)
            Text(detail, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
        }
        Text(status, style = HealthGraphTypography.LabelMedium.copy(color = color))
    }
}

data class HrvTrendData(val day: String, val morning: Int, val evening: Int)

@Composable
fun HrvTrendRow(day: String, morning: Int, evening: Int) {
    val s = rememberGlassAnimationState()
    val color = if (morning >= 55) HealthGraphColors.Success else if (morning >= 45) HealthGraphColors.Primary else HealthGraphColors.Warning

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, color.copy(alpha = 0.05f), timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(day, style = HealthGraphTypography.BodyMedium.copy(fontWeight = FontWeight.Medium), modifier = Modifier.width(50.dp))
        Text("$morning ms", style = HealthGraphTypography.TitleSmall.copy(color = color), modifier = Modifier.width(70.dp))

        Box(
            modifier = Modifier
                .weight(1f)
                .height(4.dp)
                .background(HealthGraphColors.SurfaceVariant.copy(alpha = 0.3f))
                .clip(RoundedCornerShape(2.dp))
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(morning / 100f)
                    .height(4.dp)
                    .background(color)
                    .clip(RoundedCornerShape(2.dp))
            )
        }

        Text("Eve: $evening ms", style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant), modifier = Modifier.width(80.dp))
    }
}

@Composable
fun GlassCardElevated(tint: Color = HealthGraphColors.RefractionTintCool, content: @Composable () -> Unit) {
    val s = rememberGlassAnimationState()
    Box(
        Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.XL, GlassElevation.Level3, tint, timeMs = s.timeMs)
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