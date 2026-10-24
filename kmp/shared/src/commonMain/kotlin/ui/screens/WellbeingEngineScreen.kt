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
import com.healthgraph.shared.ui.components.CatChip
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.SelfImprovement
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.SentimentSatisfied
import androidx.compose.material.icons.filled.SentimentNeutral
import androidx.compose.material.icons.filled.SentimentDissatisfied
import androidx.compose.foundation.shape.RoundedCornerShape

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun WellbeingEngineScreen(
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
            ScreenHeader("Wellbeing Engine", "Stress, mood, HRV, resilience")

            // Wellbeing Score
            GlassCardElevated(tint = HealthGraphColors.Primary.copy(alpha = 0.15f)) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text("Resilience Score", style = HealthGraphTypography.TitleMedium.copy(color = HealthGraphColors.OnSurfaceVariant))
                    Text("78", style = HealthGraphTypography.NumberXLarge.copy(color = HealthGraphColors.Primary))
                    Text("Good", style = HealthGraphTypography.BodyLarge.copy(color = HealthGraphColors.Primary))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        WellbeingMetric("Stress", "Low", "12%", HealthGraphColors.Success, Icons.Default.SentimentSatisfied)
                        WellbeingMetric("Mood", "Positive", "8.2/10", HealthGraphColors.Primary, Icons.Default.Psychology)
                        WellbeingMetric("HRV", "Optimal", "58 ms", HealthGraphColors.Accent, Icons.Default.Favorite)
                        WellbeingMetric("Recovery", "Ready", "92%", HealthGraphColors.Success, Icons.Default.SelfImprovement)
                    }
                }
            }

            // Mood Tracker
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp, bottom = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Mood Today", style = HealthGraphTypography.TitleLarge)
                        Text("8.2/10", style = HealthGraphTypography.TitleMedium.copy(color = HealthGraphColors.Primary))
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth().padding(16.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        MoodChip("Great", Icons.Default.SentimentVerySatisfied, HealthGraphColors.Success, false)
                        MoodChip("Good", Icons.Default.SentimentSatisfied, HealthGraphColors.Primary, true)
                        MoodChip("Okay", Icons.Default.SentimentNeutral, HealthGraphColors.Warning, false)
                        MoodChip("Low", Icons.Default.SentimentDissatisfied, HealthGraphColors.Error, false)
                        MoodChip("Poor", Icons.Default.SentimentVeryDissatisfied, HealthGraphColors.Error, false)
                    }
                }
            }

            // Stress Factors
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Stress Factors", style = HealthGraphTypography.TitleLarge, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp))
                    StressFactorRow("Work pressure", 65, HealthGraphColors.Warning)
                    StressFactorRow("Sleep quality", 20, HealthGraphColors.Success)
                    StressFactorRow("Financial", 35, HealthGraphColors.Primary)
                    StressFactorRow("Relationships", 15, HealthGraphColors.Success)
                    StressFactorRow("Health concerns", 25, HealthGraphColors.Primary)
                }
            }

            // Quick Actions
            GlassCard {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    LiquidButton(onClick = { /* breathe */ }, label = "Breathing Exercise", variant = LiquidButtonVariant.FILLED, size = LiquidButtonSize.LARGE, modifier = Modifier.weight(1f), icon = Icons.Default.Air)
                    LiquidButton(onClick = { /* meditate */ }, label = "Meditate", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.LARGE, modifier = Modifier.weight(1f), icon = Icons.Default.SelfImprovement)
                }
            }
        }
    }
}

data class WellbeingMetric(
    val label: String,
    val status: String,
    val value: String,
    val color: Color,
    val icon: androidx.compose.ui.graphics.vector.ImageVector
)

@Composable
fun WellbeingMetric(metric: WellbeingMetric) {
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
            Box(
                modifier = Modifier.size(36.dp).liquidGlass(GlassCorner.Full, GlassElevation.Level1, metric.color.copy(alpha = 0.15f)).clip(RoundedCornerShape(GlassCorner.Full)),
                contentAlignment = Alignment.Center
            ) {
                Icon(imageVector = metric.icon, contentDescription = null, tint = metric.color, modifier = Modifier.size(18.dp))
            }
            Text(metric.status, style = HealthGraphTypography.LabelMedium.copy(color = metric.color))
            Text(metric.label, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
            Text(metric.value, style = HealthGraphTypography.Caption.copy(color = metric.color))
        }
    }
}

data class MoodChipItem(val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector, val color: Color, val selected: Boolean)

@Composable
fun MoodChip(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, color: Color, selected: Boolean) {
    val s = rememberGlassAnimationState()
    val bg = if (selected) color.copy(alpha = 0.15f) else HealthGraphColors.RefractionTint.copy(alpha = 0.05f)

    Box(
        modifier = Modifier
            .weight(1f)
            .liquidGlass(GlassCorner.MD, if (selected) GlassElevation.Level2 else GlassElevation.Level1, bg, timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(12.dp, 8.dp)
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Icon(imageVector = icon, contentDescription = null, tint = if (selected) color else HealthGraphColors.OnSurfaceVariant, modifier = Modifier.size(24.dp))
            Text(label, style = HealthGraphTypography.Caption.copy(color = if (selected) color else HealthGraphColors.OnSurfaceVariant))
        }
    }
}

data class StressFactor(val label: String, val level: Int, val color: Color)

@Composable
fun StressFactorRow(label: String, level: Int, color: Color) {
    val s = rememberGlassAnimationState()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, color.copy(alpha = 0.05f), timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, style = HealthGraphTypography.BodyMedium, modifier = Modifier.weight(1f))
        
        Box(
            modifier = Modifier
                .width(100.dp)
                .height(6.dp)
                .background(HealthGraphColors.SurfaceVariant.copy(alpha = 0.3f))
                .clip(RoundedCornerShape(3.dp))
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(level / 100f)
                    .height(6.dp)
                    .background(color)
                    .clip(RoundedCornerShape(3.dp))
            )
        }
        
        Text("$level%", style = HealthGraphTypography.LabelMedium.copy(color = color), modifier = Modifier.width(40.dp))
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