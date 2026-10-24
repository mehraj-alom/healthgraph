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
import androidx.compose.material.icons.filled.BatteryFull
import androidx.compose.material.icons.filled.Battery50
import androidx.compose.material.icons.filled.BatteryAlert
import androidx.compose.material.icons.filled.SelfImprovement
import androidx.compose.material.icons.filled.AccessibilityNew
import androidx.compose.foundation.shape.RoundedCornerShape

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun RecoveryScreen(
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
            ScreenHeader("Recovery", "Readiness, fatigue, recovery protocols")

            // Readiness Score
            GlassCardElevated(tint = HealthGraphColors.Success.copy(alpha = 0.15f)) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text("Daily Readiness", style = HealthGraphTypography.TitleMedium.copy(color = HealthGraphColors.OnSurfaceVariant))
                    Text("89", style = HealthGraphTypography.NumberXLarge.copy(color = HealthGraphColors.Success))
                    Text("Ready to Train", style = HealthGraphTypography.BodyLarge.copy(color = HealthGraphColors.Success))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        ReadinessMetric("HRV", "58 ms", "+5", HealthGraphColors.Success)
                        ReadinessMetric("RHR", "52 bpm", "-3", HealthGraphColors.Success)
                        ReadinessMetric("Sleep", "87%", "+4%", HealthGraphColors.Primary)
                        ReadinessMetric("Fatigue", "Low", "12%", HealthGraphColors.Success)
                    }
                }
            }

            // Recovery Protocols
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Today's Protocols", style = HealthGraphTypography.TitleLarge, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp))
                    ProtocolRow("Active Recovery Walk", "20-30 min, Zone 1", "Recommended", HealthGraphColors.Primary, true)
                    ProtocolRow("Foam Rolling", "10 min, major muscle groups", "Optional", HealthGraphColors.Accent, false)
                    ProtocolRow("Contrast Shower", "3 cycles hot/cold", "Optional", HealthGraphColors.Warning, false)
                    ProtocolRow("Breathing Exercise", "5 min box breathing", "Recommended", HealthGraphColors.Success, true)
                    ProtocolRow("Early Bedtime", "Target 22:00", "Recommended", HealthGraphColors.Primary, true)
                }
            }

            // Fatigue Factors
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Fatigue Analysis", style = HealthGraphTypography.TitleLarge, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp))
                    FatigueRow("Training Load", "Moderate", "Acute: 420, Chronic: 380", HealthGraphColors.Primary)
                    FatigueRow("Sleep Debt", "Low", "+0.5h vs baseline", HealthGraphColors.Success)
                    FatigueRow("HRV Trend", "Improving", "+8 ms over 7 days", HealthGraphColors.Success)
                    FatigueRow("Subjective", "Good", "Energy: 8/10, Soreness: 2/10", HealthGraphColors.Success)
                    FatigueRow("Illness Risk", "Low", "No symptoms", HealthGraphColors.Success)
                }
            }

            // Quick Actions
            GlassCard {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    LiquidButton(onClick = { /* log readiness */ }, label = "Log Readiness", variant = LiquidButtonVariant.FILLED, size = LiquidButtonSize.LARGE, modifier = Modifier.weight(1f), icon = Icons.Default.BatteryFull)
                    LiquidButton(onClick = { /* start protocol */ }, label = "Start Protocol", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.LARGE, modifier = Modifier.weight(1f), icon = Icons.Default.SelfImprovement)
                }
            }
        }
    }
}

data class ReadinessMetric(val label: String, val value: String, val change: String, val color: Color)

@Composable
fun ReadinessMetric(metric: ReadinessMetric) {
    val s = rememberGlassAnimationState()
    Box(
        Modifier
            .weight(1f)
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, metric.color.copy(alpha = 0.12f))
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(12.dp)
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(metric.value, style = HealthGraphTypography.TitleMedium.copy(color = metric.color))
            Text(metric.label, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
            Text(metric.change, style = HealthGraphTypography.Caption.copy(color = metric.color))
        }
    }
}

data class ProtocolItem(
    val name: String,
    val detail: String,
    val status: String,
    val color: Color,
    val recommended: Boolean
)

@Composable
fun ProtocolRow(name: String, detail: String, status: String, color: Color, recommended: Boolean) {
    val s = rememberGlassAnimationState()
    val bg = if (recommended) color.copy(alpha = 0.08f) else HealthGraphColors.RefractionTint.copy(alpha = 0.03f)

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, bg, timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp)
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier.size(40.dp).liquidGlass(GlassCorner.Full, GlassElevation.Level1, color.copy(alpha = 0.15f)).clip(RoundedCornerShape(GlassCorner.Full)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = if (recommended) Icons.Default.CheckCircle else Icons.Default.RadioButtonUnchecked,
                    contentDescription = null,
                    tint = color,
                    modifier = Modifier.size(20.dp)
                )
            }

            Column(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(name, style = HealthGraphTypography.BodyLarge)
                    if (recommended) {
                        Text("RECOMMENDED", style = HealthGraphTypography.LabelSmall.copy(color = color))
                    }
                }
                Text(detail, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
            }

            Text(status, style = HealthGraphTypography.LabelMedium.copy(color = color))
        }
    }
}

data class FatigueRowItem(val label: String, val status: String, val detail: String, val color: Color)

@Composable
fun FatigueRow(label: String, status: String, detail: String, color: Color) {
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

@OptIn(ExperimentalComposeUiApi::class)
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

@OptIn(ExperimentalComposeUiApi::class)
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