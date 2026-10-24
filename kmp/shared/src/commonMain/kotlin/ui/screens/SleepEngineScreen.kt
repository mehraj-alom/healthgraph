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
import androidx.compose.material.icons.filled.Bedtime
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.foundation.shape.RoundedCornerShape

@Composable
fun SleepEngineScreen(
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
            ScreenHeader("Sleep Engine", "Sleep stages, efficiency, recovery score")

            // Sleep Score Card
            GlassCardElevated(tint = HealthGraphColors.Accent.copy(alpha = 0.15f)) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text("Last Night", style = HealthGraphTypography.TitleMedium.copy(color = HealthGraphColors.OnSurfaceVariant))
                    Text("87", style = HealthGraphTypography.NumberXLarge.copy(color = HealthGraphColors.Accent))
                    Text("Sleep Score", style = HealthGraphTypography.BodyLarge.copy(color = HealthGraphColors.OnSurfaceVariant))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        SleepMetric("Duration", "7h 42m", "Target: 7h 30m", HealthGraphColors.Accent)
                        SleepMetric("Efficiency", "92%", "Target: >85%", HealthGraphColors.Success)
                        SleepMetric("Consistency", "89%", "Target: >80%", HealthGraphColors.Primary)
                    }

                    // Sleep stages breakdown
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        SleepStageBar("Deep", "1h 42m", 22, HealthGraphColors.Primary)
                        SleepStageBar("REM", "1h 58m", 25, HealthGraphColors.Accent)
                        SleepStageBar("Light", "3h 52m", 50, HealthGraphColors.Success)
                        SleepStageBar("Awake", "10m", 3, HealthGraphColors.Warning)
                    }
                }
            }

            // Trends
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("7-Day Trend", style = HealthGraphTypography.TitleLarge, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp))
                    SleepTrendRow("Mon", 82, "7h 15m")
                    SleepTrendRow("Tue", 85, "7h 30m")
                    SleepTrendRow("Wed", 79, "6h 45m")
                    SleepTrendRow("Thu", 88, "7h 50m")
                    SleepTrendRow("Fri", 84, "7h 20m")
                    SleepTrendRow("Sat", 91, "8h 15m")
                    SleepTrendRow("Sun", 87, "7h 42m")
                }
            }

            // Factors
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Sleep Factors", style = HealthGraphTypography.TitleLarge, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp))
                    FactorRow("Caffeine cutoff", "2:00 PM", true, HealthGraphColors.Success)
                    FactorRow("Screen time", "30 min before bed", true, HealthGraphColors.Success)
                    FactorRow("Room temp", "18°C (64°F)", true, HealthGraphColors.Success)
                    FactorRow("Alcohol", "None", true, HealthGraphColors.Success)
                    FactorRow("Late workout", "None", true, HealthGraphColors.Success)
                }
            }
        }
    }
}

data class SleepMetric(val label: String, val value: String, val target: String, val color: Color)

@Composable
fun SleepMetric(label: String, value: String, target: String, color: Color) {
    val s = rememberGlassAnimationState()
    Box(
        Modifier
            .weight(1f)
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, color.copy(alpha = 0.12f))
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(12.dp)
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(value, style = HealthGraphTypography.TitleMedium.copy(color = color))
            Text(label, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
            Text(target, style = HealthGraphTypography.Caption.copy(color = color.copy(alpha = 0.7f)))
        }
    }
}

@Composable
fun SleepStageBar(stage: String, duration: String, percent: Int, color: Color) {
    val s = rememberGlassAnimationState()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, color.copy(alpha = 0.05f), timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier.size(12.dp).background(color).clip(RoundedCornerShape(6.dp))
        )
        Text(stage, style = HealthGraphTypography.BodyMedium, modifier = Modifier.width(60.dp))
        Box(
            modifier = Modifier
                .weight(1f)
                .height(8.dp)
                .background(HealthGraphColors.SurfaceVariant.copy(alpha = 0.3f))
                .clip(RoundedCornerShape(4.dp))
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(percent / 100f)
                    .height(8.dp)
                    .background(color)
                    .clip(RoundedCornerShape(4.dp))
            )
        }
        Text(duration, style = HealthGraphTypography.LabelMedium, modifier = Modifier.width(60.dp))
        Text("$percent%", style = HealthGraphTypography.Caption.copy(color = color), modifier = Modifier.width(40.dp))
    }
}

data class SleepTrendData(val day: String, val score: Int, val duration: String)

@Composable
fun SleepTrendRow(day: String, score: Int, duration: String) {
    val s = rememberGlassAnimationState()
    val color = when {
        score >= 85 -> HealthGraphColors.Success
        score >= 75 -> HealthGraphColors.Primary
        score >= 65 -> HealthGraphColors.Warning
        else -> HealthGraphColors.Error
    }

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

        Box(
            modifier = Modifier
                .weight(1f)
                .height(6.dp)
                .background(HealthGraphColors.SurfaceVariant.copy(alpha = 0.3f))
                .clip(RoundedCornerShape(3.dp))
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(score / 100f)
                    .height(6.dp)
                    .background(color)
                    .clip(RoundedCornerShape(3.dp))
            )
        }

        Text("$score", style = HealthGraphTypography.TitleSmall.copy(color = color), modifier = Modifier.width(36.dp))
        Text(duration, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant), modifier = Modifier.width(60.dp))
    }
}

data class FactorRowData(val label: String, val detail: String, val good: Boolean, val color: Color)

@Composable
fun FactorRow(label: String, detail: String, good: Boolean, color: Color) {
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
        Icon(
            imageVector = if (good) Icons.Default.CheckCircle else Icons.Default.Cancel,
            contentDescription = null,
            tint = if (good) color else HealthGraphColors.Error,
            modifier = Modifier.size(20.dp)
        )
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