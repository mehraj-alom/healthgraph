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
import com.healthgraph.shared.ui.components.CatChip
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.WaterDrop
import androidx.compose.foundation.shape.RoundedCornerShape

@Composable
fun CycleScreen(
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
            ScreenHeader("Cycle Tracking", "Phases, symptoms, fertility")

            // Current Phase
            GlassCardElevated(tint = HealthGraphColors.Error.copy(alpha = 0.15f)) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Row(
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column {
                            Text("Current Phase", style = HealthGraphTypography.TitleMedium)
                            Text("Follicular", style = HealthGraphTypography.HeadlineMedium.copy(color = HealthGraphColors.Error))
                        }
                        Box(
                            modifier = Modifier
                                .size(80.dp)
                                .liquidGlass(GlassCorner.Full, GlassElevation.Level2, HealthGraphColors.Error.copy(alpha = 0.15f))
                                .clip(RoundedCornerShape(GlassCorner.Full))
                        ) {
                            androidx.compose.foundation.Canvas(Modifier.fillMaxSize()) {
                                val center = androidx.compose.ui.geometry.Offset(size.width/2f, size.height/2f)
                                val radius = min(size.width, size.height)/2f - 8
                                drawCircle(HealthGraphColors.GlassStroke, center, radius, style = androidx.compose.ui.draw.Stroke(8.dp.toPx()))
                                drawArc(HealthGraphColors.Error, -90f, 360f * 0.45f, false, androidx.compose.ui.geometry.Offset(center.x - radius, center.y - radius), androidx.compose.ui.geometry.Size(radius*2, radius*2), style = androidx.compose.ui.draw.Stroke(8.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round))
                                drawText("Day 9", 20.sp, HealthGraphColors.OnBackground, FontWeight.Bold, center - androidx.compose.ui.geometry.Offset(18f, 10f))
                            }
                        }
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        CycleStat("Cycle Day", "9", HealthGraphColors.Error)
                        CycleStat("Cycle Length", "28 avg", HealthGraphColors.Primary)
                        CycleStat("Period Length", "5 days", HealthGraphColors.Accent)
                        CycleStat("Next Period", "in 19 days", HealthGraphColors.Warning)
                    }
                }
            }

            // Phase Calendar
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Cycle Phases", style = HealthGraphTypography.TitleLarge, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp))
                    PhaseRow("Menstrual", "Days 1-5", "🩸", HealthGraphColors.Error, false)
                    PhaseRow("Follicular", "Days 6-14", "🌱", HealthGraphColors.Primary, true)
                    PhaseRow("Ovulation", "Days 14-16", "🥚", HealthGraphColors.Success, false)
                    PhaseRow("Luteal", "Days 17-28", "🍂", HealthGraphColors.Warning, false)
                }
            }

            // Symptoms
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp, bottom = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Today's Symptoms", style = HealthGraphTypography.TitleLarge)
                        LiquidButton(onClick = { /* log */ }, label = "Log Symptom", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.SMALL, icon = Icons.Default.Add)
                    }
                    LazyColumn {
                        items(todaySymptoms) { symptom ->
                            SymptomRow(symptom)
                            if (symptom != todaySymptoms.last()) {
                                androidx.compose.foundation.layout.Divider(color = HealthGraphColors.Outline.copy(alpha = 0.1f), modifier = Modifier.fillMaxWidth().padding(16.dp))
                            }
                        }
                    }
                }
            }

            // Fertility Window
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Fertility Window", style = HealthGraphTypography.TitleLarge, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp))
                    FertilityDay("Low", "Days 1-8", HealthGraphColors.Primary.copy(alpha = 0.5f))
                    FertilityDay("Low", "Days 9-10", HealthGraphColors.Primary.copy(alpha = 0.5f))
                    FertilityDay("High", "Days 11-13", HealthGraphColors.Success)
                    FertilityDay("Peak", "Day 14 (Ovulation)", HealthGraphColors.Error)
                    FertilityDay("High", "Day 15", HealthGraphColors.Success)
                    FertilityDay("Low", "Days 16-28", HealthGraphColors.Primary.copy(alpha = 0.5f))
                }
            }
        }
    }
}

data class CycleStat(val label: String, val value: String, val color: Color)

@Composable
fun CycleStat(label: String, value: String, color: Color) {
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
        }
    }
}

data class PhaseItem(val name: String, val days: String, val emoji: String, val color: Color, val current: Boolean)

@Composable
fun PhaseRow(name: String, days: String, emoji: String, color: Color, current: Boolean) {
    val s = rememberGlassAnimationState()
    val bg = if (current) color.copy(alpha = 0.1f) else HealthGraphColors.RefractionTint.copy(alpha = 0.03f)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, if (current) GlassElevation.Level2 else GlassElevation.Level1, bg, timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(emoji, style = HealthGraphTypography.HeadlineMedium, modifier = Modifier.size(40.dp))
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(name, style = HealthGraphTypography.BodyLarge.copy(color = if (current) color else HealthGraphColors.OnSurface))
            Text(days, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
        }
        if (current) {
            Text("NOW", style = HealthGraphTypography.LabelSmall.copy(color = color))
        }
    }
}

data class SymptomItem(val name: String, val severity: Int, val category: String, val color: Color)

val todaySymptoms = listOf(
    SymptomItem("Cramps", 3, "Physical", HealthGraphColors.Error),
    SymptomItem("Bloating", 4, "Physical", HealthGraphColors.Warning),
    SymptomItem("Mood swings", 2, "Emotional", HealthGraphColors.Primary),
    SymptomItem("Fatigue", 3, "Energy", HealthGraphColors.Accent),
)

@Composable
fun SymptomRow(symptom: SymptomItem) {
    val s = rememberGlassAnimationState()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, symptom.color.copy(alpha = 0.05f), timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(symptom.name, style = HealthGraphTypography.BodyLarge)
            Text(symptom.category, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
        }

        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            (1..5).forEach { i ->
                Box(
                    modifier = Modifier.size(16.dp).background(
                        if (i <= symptom.severity) symptom.color else HealthGraphColors.SurfaceVariant.copy(alpha = 0.3f)
                    ).clip(RoundedCornerShape(4.dp))
                )
            }
        }
    }
}

data class FertilityItem(val level: String, val days: String, val color: Color)

@Composable
fun FertilityDay(level: String, days: String, color: Color) {
    val s = rememberGlassAnimationState()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, color.copy(alpha = 0.1f), timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column {
            Text(level, style = HealthGraphTypography.LabelMedium.copy(color = color))
            Text(days, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
        }
        Box(
            modifier = Modifier
                .size(12.dp)
                .background(color)
                .clip(RoundedCornerShape(6.dp))
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