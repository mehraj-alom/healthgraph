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
import androidx.compose.material.icons.filled.LocalFireDepartment
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.foundation.shape.RoundedCornerShape

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun DisciplineEngineScreen(
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
            ScreenHeader("Discipline Engine", "Habits, streaks, consistency scoring")

            // Streak Overview
            GlassCardElevated(tint = HealthGraphColors.Warning.copy(alpha = 0.15f)) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        StreakStat("Current Streak", "47 days", HealthGraphColors.Warning, Icons.Default.LocalFireDepartment)
                        StreakStat("Longest Streak", "89 days", HealthGraphColors.Primary, Icons.Default.TrendingUp)
                        StreakStat("This Month", "94%", HealthGraphColors.Success, Icons.Default.CalendarMonth)
                    }

                    // Weekly consistency
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Weekly Consistency", style = HealthGraphTypography.TitleMedium)
                        ConsistencyBar("Mon", 100)
                        ConsistencyBar("Tue", 100)
                        ConsistencyBar("Wed", 80)
                        ConsistencyBar("Thu", 100)
                        ConsistencyBar("Fri", 100)
                        ConsistencyBar("Sat", 60)
                        ConsistencyBar("Sun", 100)
                    }
                }
            }

            // Active Habits
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp, bottom = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Active Habits", style = HealthGraphTypography.TitleLarge)
                        LiquidButton(onClick = { /* add habit */ }, label = "Add Habit", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.SMALL)
                    }
                    LazyColumn {
                        items(activeHabits) { habit ->
                            HabitRow(habit)
                            if (habit != activeHabits.last()) {
                                androidx.compose.foundation.layout.Divider(color = HealthGraphColors.Outline.copy(alpha = 0.1f), modifier = Modifier.fillMaxWidth().padding(16.dp))
                            }
                        }
                    }
                }
            }

            // Consistency Score
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Consistency Score", style = HealthGraphTypography.TitleLarge, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp))
                    ScoreRow("Overall", 94, HealthGraphColors.Success)
                    ScoreRow("Morning Routine", 96, HealthGraphColors.Success)
                    ScoreRow("Workout", 89, HealthGraphColors.Primary)
                    ScoreRow("Nutrition", 92, HealthGraphColors.Success)
                    ScoreRow("Sleep Schedule", 85, HealthGraphColors.Warning)
                    ScoreRow("Mindfulness", 78, HealthGraphColors.Primary)
                }
            }
        }
    }
}

data class StreakStat(val label: String, val value: String, val color: Color, val icon: androidx.compose.ui.graphics.vector.ImageVector)

@Composable
fun StreakStat(stat: StreakStat) {
    val s = rememberGlassAnimationState()
    Box(
        Modifier
            .weight(1f)
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, stat.color.copy(alpha = 0.12f))
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp)
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Box(
                modifier = Modifier.size(40.dp).liquidGlass(GlassCorner.Full, GlassElevation.Level1, stat.color.copy(alpha = 0.15f)).clip(RoundedCornerShape(GlassCorner.Full)),
                contentAlignment = Alignment.Center
            ) {
                Icon(imageVector = stat.icon, contentDescription = null, tint = stat.color, modifier = Modifier.size(20.dp))
            }
            Text(stat.value, style = HealthGraphTypography.TitleMedium.copy(color = stat.color))
            Text(stat.label, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
        }
    }
}

@Composable
fun ConsistencyBar(day: String, percent: Int) {
    val s = rememberGlassAnimationState()
    val color = if (percent >= 80) HealthGraphColors.Success else if (percent >= 60) HealthGraphColors.Warning else HealthGraphColors.Error

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, color.copy(alpha = 0.05f), timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(12.dp, 8.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(day, style = HealthGraphTypography.BodyMedium.copy(fontWeight = FontWeight.Medium), modifier = Modifier.width(50.dp))
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
        Text("$percent%", style = HealthGraphTypography.LabelMedium.copy(color = color), modifier = Modifier.width(40.dp))
    }
}

data class Habit(
    val name: String,
    val streak: Int,
    val target: String,
    val completed: Boolean,
    val color: Color,
    val icon: androidx.compose.ui.graphics.vector.ImageVector
)

val activeHabits = listOf(
    Habit("Morning hydration", 47, "Daily", true, HealthGraphColors.Primary, Icons.Default.LocalDrink),
    Habit("Workout", 23, "4x/week", false, HealthGraphColors.Success, Icons.Default.FitnessCenter),
    Habit("Meditation", 12, "Daily", false, HealthGraphColors.Accent, Icons.Default.SelfImprovement),
    Habit("No phone before bed", 31, "Daily", true, HealthGraphColors.Warning, Icons.Default.PhoneAndroid),
    Habit("Protein goal", 41, "Daily", true, HealthGraphColors.Primary, Icons.Default.Restaurant),
    Habit("Stretching", 8, "Daily", false, HealthGraphColors.Success, Icons.Default.AccessibilityNew),
)

@Composable
fun HabitRow(habit: Habit) {
    val s = rememberGlassAnimationState()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, habit.color.copy(alpha = 0.05f), timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier.size(44.dp).liquidGlass(GlassCorner.Full, GlassElevation.Level1, habit.color.copy(alpha = 0.15f)).clip(RoundedCornerShape(GlassCorner.Full)),
            contentAlignment = Alignment.Center
        ) {
            Icon(imageVector = habit.icon, contentDescription = null, tint = habit.color, modifier = Modifier.size(22.dp))
        }

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(habit.name, style = HealthGraphTypography.BodyLarge)
            Text("${habit.streak} day streak  •  ${habit.target}", style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
        }

        if (habit.completed) {
            Icon(Icons.Default.CheckCircle, contentDescription = null, tint = habit.color, modifier = Modifier.size(24.dp))
        } else {
            LiquidButton(onClick = { /* complete */ }, label = "Done", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.SMALL)
        }
    }
}

data class ScoreItem(val label: String, val score: Int, val color: Color)

@Composable
fun ScoreRow(label: String, score: Int, color: Color) {
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
                .width(80.dp)
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

        Text("$score%", style = HealthGraphTypography.TitleMedium.copy(color = color), modifier = Modifier.width(50.dp))
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