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
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import com.healthgraph.shared.ui.components.GlassTextField
import com.healthgraph.shared.ui.components.LiquidButton
import com.healthgraph.shared.ui.components.LiquidButtonVariant
import com.healthgraph.shared.ui.components.LiquidButtonSize

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun FitnessEngineScreen(
    modifier: androidx.compose.ui.Modifier = androidx.compose.ui.Modifier
) {
    val state = rememberGlassAnimationState()

    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(16.dp)
            .liquidGlass(cornerRadius = 0.dp, elevation = 0.dp, tint = Color.Transparent, timeMs = state.timeMs)
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            ScreenHeader("Fitness Engine", "VO₂ Max, Strength & Mobility")

            GlassCardElevated(tint = HealthGraphColors.Accent.copy(alpha = 0.15f)) {
                Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Row(
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column {
                            Text("VO₂ Max", style = HealthGraphTypography.TitleMedium)
                            Text("42.3 ml/kg/min", style = HealthGraphTypography.NumberLarge.copy(color = HealthGraphColors.Accent))
                        }
                        Box(Modifier.size(60.dp).liquidGlass(GlassCorner.Full, GlassElevation.Level2, HealthGraphColors.Accent.copy(alpha = 0.2f)).clip(androidx.compose.foundation.shape.CircleShape)) {
                            androidx.compose.foundation.Canvas(Modifier.fillMaxSize()) {
                                val center = androidx.compose.ui.geometry.Offset(size.width/2f, size.height/2f)
                                val radius = min(size.width, size.height)/2f - 4
                                drawCircle(HealthGraphColors.GlassStroke, center, radius, style = androidx.compose.ui.draw.Stroke(4.dp.toPx()))
                                drawArc(HealthGraphColors.Accent, -90f, 360f * 0.72f, false, androidx.compose.ui.geometry.Offset(center.x - radius, center.y - radius), androidx.compose.ui.geometry.Size(radius*2, radius*2), style = androidx.compose.ui.draw.Stroke(4.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round))
                                drawText("72%", 20.sp, HealthGraphColors.OnBackground, FontWeight.Bold, center - androidx.compose.ui.geometry.Offset(20f, 10f))
                            }
                        }
                    }

                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        FitnessMetric("Strength", "85th %ile", HealthGraphColors.Success)
                        FitnessMetric("Mobility", "Good", HealthGraphColors.Primary)
                        FitnessMetric("Recovery", "Ready", HealthGraphColors.Warning)
                    }
                }
            }

            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("This Week's Plan", style = HealthGraphTypography.TitleLarge)
                    LazyColumn {
                        items(workoutPlan) { w ->
                            WorkoutRow(w)
                        }
                    }
                }
            }
        }
    }
}

data class FitnessMetric(val label: String, val value: String, val color: Color)

@Composable
fun FitnessMetric(label: String, value: String, color: Color) {
    val s = rememberGlassAnimationState()
    Box(Modifier.weight(1f).liquidGlass(GlassCorner.MD, GlassElevation.Level1, color.copy(alpha=0.15f)).clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.MD)).padding(16.dp)) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(value, style = HealthGraphTypography.TitleMedium.copy(color = color))
            Text(label, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
        }
    }
}

data class Workout(val day: String, val focus: String, val duration: String, val intensity: String, val color: Color, val completed: Boolean)
val workoutPlan = listOf(
    Workout("Mon", "Zone 2 Run", "45 min", "Low", HealthGraphColors.Primary, false),
    Workout("Tue", "Upper Strength", "50 min", "Moderate", HealthGraphColors.Accent, false),
    Workout("Wed", "Mobility Flow", "30 min", "Low", HealthGraphColors.Success, false),
    Workout("Thu", "Threshold Run", "40 min", "High", HealthGraphColors.Error, false),
    Workout("Fri", "Lower Strength", "50 min", "Moderate", HealthGraphColors.Accent, false),
    Workout("Sat", "Long Run", "90 min", "Low", HealthGraphColors.Primary, false),
    Workout("Sun", "Rest / Walk", "30 min", "Recovery", HealthGraphColors.Success, false)
)

@Composable
fun WorkoutRow(w: Workout) {
    val s = rememberGlassAnimationState()
    Row(Modifier.fillMaxWidth().liquidGlass(GlassCorner.MD, GlassElevation.Level1, w.color.copy(alpha=0.1f)).clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.MD)).padding(16.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(10.dp).background(w.color).clip(androidx.compose.foundation.shape.CircleShape))
            Column { Text(w.day, style = HealthGraphTypography.LabelLarge.copy(fontWeight=FontWeight.Bold, color=w.color)); Text(w.focus, style = HealthGraphTypography.Caption.copy(color=HealthGraphColors.OnSurfaceVariant)) }
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(w.duration, style = HealthGraphTypography.LabelMedium)
            Text(w.intensity, style = HealthGraphTypography.LabelSmall.copy(color=w.color))
        }
    }
}

@Composable
fun ScreenHeader(title: String, subtitle: String? = null) {
    val s = rememberGlassAnimationState()
    Box(Modifier.fillMaxWidth().liquidGlass(GlassCorner.MD, GlassElevation.Level1, HealthGraphColors.RefractionTint, timeMs=s.timeMs).clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.MD)).padding(16.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = HealthGraphTypography.HeadlineMedium)
            subtitle?.let { Text(it, style = HealthGraphTypography.BodyMedium.copy(color=HealthGraphColors.OnSurfaceVariant)) }
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun GlassCardElevated(tint: Color = HealthGraphColors.RefractionTintCool, content: @Composable () -> Unit) {
    val s = rememberGlassAnimationState()
    Box(Modifier.fillMaxWidth().liquidGlass(GlassCorner.XL, GlassElevation.Level3, tint, timeMs=s.timeMs).clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.XL)).padding(20.dp), content = content)
}

@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun GlassCard(content: @Composable () -> Unit) {
    val s = rememberGlassAnimationState()
    Box(Modifier.fillMaxWidth().liquidGlass(GlassCorner.LG, GlassElevation.Level2, timeMs=s.timeMs).clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.LG)).padding(16.dp), content = content)
}