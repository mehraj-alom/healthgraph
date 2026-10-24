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
import androidx.compose.material.icons.filled.MonitorWeight
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.material.icons.filled.TrendingDown
import androidx.compose.foundation.shape.RoundedCornerShape

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun WeightEngineScreen(
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
            ScreenHeader("Weight Engine", "Weight trends, body composition, goals")

            // Current Stats Card
            GlassCardElevated(tint = HealthGraphColors.Success.copy(alpha = 0.15f)) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp)
                ) {
                    Row(
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column {
                            Text("Current Weight", style = HealthGraphTypography.TitleMedium)
                            Text("78.2 kg", style = HealthGraphTypography.NumberLarge.copy(color = HealthGraphColors.Success))
                        }
                        Box(
                            modifier = Modifier
                                .size(80.dp)
                                .liquidGlass(GlassCorner.Full, GlassElevation.Level2, HealthGraphColors.Success.copy(alpha = 0.15f))
                                .clip(RoundedCornerShape(GlassCorner.Full))
                        ) {
                            // Progress ring
                            androidx.compose.foundation.Canvas(Modifier.fillMaxSize()) {
                                val center = androidx.compose.ui.geometry.Offset(size.width/2f, size.height/2f)
                                val radius = min(size.width, size.height)/2f - 6
                                drawCircle(HealthGraphColors.GlassStroke, center, radius, style = androidx.compose.ui.draw.Stroke(6.dp.toPx()))
                                drawArc(HealthGraphColors.Success, -90f, 360f * 0.73f, false, androidx.compose.ui.geometry.Offset(center.x - radius, center.y - radius), androidx.compose.ui.geometry.Size(radius*2, radius*2), style = androidx.compose.ui.draw.Stroke(6.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round))
                                drawText("73%", 24.sp, HealthGraphColors.OnBackground, FontWeight.Bold, center - androidx.compose.ui.geometry.Offset(22f, 12f))
                            }
                        }
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        WeightMetric("Body Fat", "18.5%", "Target: <20%", HealthGraphColors.Success)
                        WeightMetric("Muscle Mass", "36.2 kg", "Target: >35kg", HealthGraphColors.Primary)
                        WeightMetric("Water", "58%", "Target: 55-60%", HealthGraphColors.Accent)
                    }
                }
            }

            // Goal Progress
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Active Goal", style = HealthGraphTypography.TitleLarge, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp))
                    GoalProgressCard(
                        title = "Weight Loss",
                        current = "78.2 kg",
                        target = "75.0 kg",
                        start = "84.5 kg",
                        progress = 0.68,
                        color = HealthGraphColors.Success
                    )
                    GoalProgressCard(
                        title = "Body Fat %",
                        current = "18.5%",
                        target = "15%",
                        start = "22.1%",
                        progress = 0.82,
                        color = HealthGraphColors.Primary
                    )
                }
            }

            // Recent Logs
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp, bottom = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Recent Entries", style = HealthGraphTypography.TitleLarge)
                        LiquidButton(onClick = { /* add */ }, label = "Log Weight", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.SMALL)
                    }
                    LazyColumn {
                        items(weightLogs) { log ->
                            WeightLogRow(log)
                            if (log != weightLogs.last()) {
                                androidx.compose.foundation.layout.Divider(color = HealthGraphColors.Outline.copy(alpha = 0.1f), modifier = Modifier.fillMaxWidth().padding(16.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}

data class WeightMetric(val label: String, val value: String, val target: String, val color: Color)

@Composable
fun WeightMetric(label: String, value: String, target: String, color: Color) {
    val s = rememberGlassAnimationState()
    Box(
        Modifier
            .weight(1f)
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, color.copy(alpha = 0.12f))
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp)
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(value, style = HealthGraphTypography.TitleMedium.copy(color = color))
            Text(label, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
            Text(target, style = HealthGraphTypography.Caption.copy(color = color.copy(alpha = 0.7f)))
        }
    }
}

data class GoalProgressCard(
    val title: String,
    val current: String,
    val target: String,
    val start: String,
    val progress: Float,
    val color: Color
)

@Composable
fun GoalProgressCard(card: GoalProgressCard) {
    val s = rememberGlassAnimationState()
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.LG, GlassElevation.Level2, card.color.copy(alpha = 0.08f), timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.LG))
            .padding(16.dp)
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(horizontalArrangement = Arrangement.SpaceBetween) {
                Text(card.title, style = HealthGraphTypography.TitleMedium)
                Text("${(card.progress * 100).toInt()}%", style = HealthGraphTypography.TitleMedium.copy(color = card.color))
            }

            // Progress bar
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(8.dp)
                    .background(HealthGraphColors.SurfaceVariant.copy(alpha = 0.3f))
                    .clip(RoundedCornerShape(4.dp))
            ) {
                Box(
                    modifier = Modifier
                        .width(Modifier.fillMaxWidth().width * card.progress)
                        .height(8.dp)
                        .background(card.color)
                        .clip(RoundedCornerShape(4.dp))
                )
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text("Start: ${card.start}", style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
                Text("Target: ${card.target}", style = HealthGraphTypography.Caption.copy(color = card.color))
            }
        }
    }
}

data class WeightLog(val date: String, val weight: String, val bodyFat: String?, val muscle: String?, val note: String?)

val weightLogs = listOf(
    WeightLog("Jan 15", "78.2 kg", "18.5%", "36.2 kg", "Post-workout"),
    WeightLog("Jan 14", "78.5 kg", "18.7%", "36.0 kg", "Morning"),
    WeightLog("Jan 13", "78.8 kg", null, null, "Evening"),
    WeightLog("Jan 12", "79.1 kg", "19.0%", "35.8 kg", "Morning"),
    WeightLog("Jan 11", "79.3 kg", null, null, ""),
    WeightLog("Jan 10", "79.5 kg", "19.2%", "35.5 kg", "Morning"),
    WeightLog("Jan 9", "80.0 kg", "19.5%", "35.2 kg", "Weekly check-in"),
)

@Composable
fun WeightLogRow(log: WeightLog) {
    val s = rememberGlassAnimationState()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, HealthGraphColors.RefractionTint.copy(alpha = 0.05f), timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(log.date, style = HealthGraphTypography.BodyMedium)
            log.note?.takeIf { it.isNotBlank() }?.let { Text(it, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant)) }
        }

        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(log.weight, style = HealthGraphTypography.TitleMedium.copy(color = HealthGraphColors.Success))
            log.bodyFat?.let { Text("BF: $it", style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.Primary)) }
            log.muscle?.let { Text("Muscle: $it", style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.Accent)) }
        }
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