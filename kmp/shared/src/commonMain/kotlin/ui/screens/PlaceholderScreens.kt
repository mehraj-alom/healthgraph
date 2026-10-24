package com.healthgraph.shared.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import androidx.compose.material.icons.filled.AccessibilityNew
import androidx.compose.material.icons.filled.Timeline
import androidx.compose.material.icons.filled.Flag
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun HealthAreasScreen(
    modifier: androidx.compose.ui.Modifier = androidx.compose.ui.Modifier
) {
    val state = rememberGlassAnimationState()

    Box(
        modifier = modifier
            .fillMaxWidth()
            .padding(16.dp)
            .liquidGlass(
                cornerRadius = 0.dp,
                elevation = 0.dp,
                tint = Color.Transparent,
                timeMs = state.timeMs
            )
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            ScreenHeader(title = "Health Areas", subtitle = "Track and optimize your wellbeing")

            GlassCard(
                cornerRadius = GlassCorner.LG,
                elevation = GlassElevation.Level2
            ) {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Text("Health Areas Screen", style = HealthGraphTypography.HeadlineMedium)
                    Text("This screen shows all 8 health areas with their scores and trends", style = HealthGraphTypography.BodyMedium.copy(color = HealthGraphColors.OnSurfaceVariant))
                    LiquidButton(onClick = {}, label = "Explore", variant = LiquidButtonVariant.PRIMARY)
                }
            }
        }
    }
}

@Composable
fun ScreenHeader(title: String, subtitle: String? = null, onBack: () -> Unit = {}) {
    val state = rememberGlassAnimationState()

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(
                cornerRadius = GlassCorner.MD,
                elevation = GlassElevation.Level1,
                tint = HealthGraphColors.RefractionTint,
                timeMs = state.timeMs
            )
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(text = title, style = HealthGraphTypography.HeadlineMedium)
            subtitle?.let {
                Text(text = it, style = HealthGraphTypography.BodyMedium.copy(color = HealthGraphColors.OnSurfaceVariant))
            }
        }
        if (onBack != null) {
            LiquidButton(onClick = onBack, label = "", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.SMALL, icon = Icons.Default.ArrowBack)
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun DashboardScreen(
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
            ScreenHeader("Dashboard", "Your health overview")

            // Health Score Card
            GlassCardElevated(tint = HealthGraphColors.Primary.copy(alpha = 0.15f)) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text("Health Score", style = HealthGraphTypography.TitleMedium.copy(color = HealthGraphColors.OnSurfaceVariant))
                    Text("94", style = HealthGraphTypography.NumberXLarge.copy(color = HealthGraphColors.Primary))
                    Text("Excellent", style = HealthGraphTypography.BodyLarge.copy(color = HealthGraphColors.Primary))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        DashboardMetric("Readiness", "89%", HealthGraphColors.Success)
                        DashboardMetric("Recovery", "92%", HealthGraphColors.Primary)
                        DashboardMetric("Activity", "78%", HealthGraphColors.Warning)
                        DashboardMetric("Sleep", "87%", HealthGraphColors.Accent)
                    }
                }
            }

            // Quick Actions
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Quick Actions", style = HealthGraphTypography.TitleLarge, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp))
                    QuickActionRow("Log Workout", Icons.Default.FitnessCenter, HealthGraphColors.Success)
                    QuickActionRow("Log Meal", Icons.Default.Restaurant, HealthGraphColors.Warning)
                    QuickActionRow("Record Vitals", Icons.Default.MonitorHeart, HealthGraphColors.Error)
                    QuickActionRow("Voice Check-in", Icons.Default.Mic, HealthGraphColors.Primary)
                    QuickActionRow("Meditation", Icons.Default.SelfImprovement, HealthGraphColors.Accent)
                }
            }

            // Today's Summary
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Today's Summary", style = HealthGraphTypography.TitleLarge, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp))
                    SummaryRow("Workouts", "Completed", "45 min run", HealthGraphColors.Success)
                    SummaryRow("Nutrition", "2,340 kcal", "Target: 2,500", HealthGraphColors.Warning)
                    SummaryRow("Sleep", "7h 42m", "Score: 87%", HealthGraphColors.Accent)
                    SummaryRow("Steps", "9,842", "Target: 10,000", HealthGraphColors.Primary)
                }
            }
        }
    }
}

data class DashboardMetric(val label: String, val value: String, val color: Color)

@Composable
fun DashboardMetric(label: String, value: String, color: Color) {
    val s = rememberGlassAnimationState()
    Box(
        Modifier
            .weight(1f)
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, color.copy(alpha = 0.12f))
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.MD))
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

data class QuickActionItem(val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector, val color: Color)

@Composable
fun QuickActionRow(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, color: Color) {
    val s = rememberGlassAnimationState()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, color.copy(alpha = 0.05f), timeMs = s.timeMs)
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier.size(44.dp).liquidGlass(GlassCorner.Full, GlassElevation.Level1, color.copy(alpha = 0.15f)).clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.Full)),
            contentAlignment = Alignment.Center
        ) {
            Icon(imageVector = icon, contentDescription = null, tint = color, modifier = Modifier.size(22.dp))
        }
        Text(label, style = HealthGraphTypography.BodyLarge, modifier = Modifier.weight(1f))
        Icon(Icons.Default.ChevronRight, contentDescription = null, tint = HealthGraphColors.OnSurfaceVariant, modifier = Modifier.size(24.dp))
    }
}

data class SummaryItem(val label: String, val status: String, val detail: String, val color: Color)

@Composable
fun SummaryRow(label: String, status: String, detail: String, color: Color) {
    val s = rememberGlassAnimationState()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, color.copy(alpha = 0.05f), timeMs = s.timeMs)
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.MD))
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

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun BodyScreen(
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
            ScreenHeader("Body", "Measurements & composition")

            GlassCardElevated(tint = HealthGraphColors.Success.copy(alpha = 0.15f)) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        BodyMetric("Weight", "78.2 kg", "75.0 kg", HealthGraphColors.Success)
                        BodyMetric("Body Fat", "18.5%", "15.0%", HealthGraphColors.Primary)
                        BodyMetric("Muscle", "36.2 kg", "35.0 kg", HealthGraphColors.Accent)
                        BodyMetric("Water", "58%", "55-60%", HealthGraphColors.Success)
                    }
                }
            }

            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Measurements", style = HealthGraphTypography.TitleLarge, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp))
                    MeasurementRow("Chest", "102 cm", "100 cm", HealthGraphColors.Primary)
                    MeasurementRow("Waist", "82 cm", "80 cm", HealthGraphColors.Success)
                    MeasurementRow("Hips", "98 cm", "95 cm", HealthGraphColors.Accent)
                    MeasurementRow("Thigh", "58 cm", "55 cm", HealthGraphColors.Primary)
                    MeasurementRow("Arm", "36 cm", "35 cm", HealthGraphColors.Success)
                }
            }
        }
    }
}

data class BodyMetric(val label: String, val current: String, val target: String, val color: Color)

@Composable
fun BodyMetric(label: String, current: String, target: String, color: Color) {
    val s = rememberGlassAnimationState()
    Box(
        Modifier
            .weight(1f)
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, color.copy(alpha = 0.12f))
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp)
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(current, style = HealthGraphTypography.TitleMedium.copy(color = color))
            Text(label, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
            Text("Target: $target", style = HealthGraphTypography.Caption.copy(color = color.copy(alpha = 0.7f)))
        }
    }
}

data class MeasurementItem(val label: String, val current: String, val target: String, val color: Color)

@Composable
fun MeasurementRow(label: String, current: String, target: String, color: Color) {
    val s = rememberGlassAnimationState()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, color.copy(alpha = 0.05f), timeMs = s.timeMs)
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column {
            Text(label, style = HealthGraphTypography.BodyMedium)
            Text("Target: $target", style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
        }
        Text(current, style = HealthGraphTypography.TitleMedium.copy(color = color))
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun TimelineScreen(
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
            ScreenHeader("Timeline", "Your health journey")

            GlassCard {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(timelineEvents) { event ->
                        TimelineEventRow(event)
                    }
                }
            }
        }
    }
}

data class TimelineEvent(
    val title: String,
    val time: String,
    val category: String,
    val value: String,
    val color: Color,
    val icon: androidx.compose.ui.graphics.vector.ImageVector
)

val timelineEvents = listOf(
    TimelineEvent("Morning Run", "06:30", "Workout", "45 min • Zone 2", HealthGraphColors.Primary, Icons.Default.DirectionsRun),
    TimelineEvent("Breakfast", "07:30", "Nutrition", "420 kcal • 32g protein", HealthGraphColors.Warning, Icons.Default.FreeBreakfast),
    TimelineEvent("Vitals Logged", "07:45", "Vitals", "BP 118/76 • HR 58", HealthGraphColors.Error, Icons.Default.MonitorHeart),
    TimelineEvent("Supplements", "08:00", "Supplements", "Vit D, Omega-3, Probiotic", HealthGraphColors.Success, Icons.Default.Medication),
    TimelineEvent("Work Session", "09:00", "Activity", "3h 42m focus time", HealthGraphColors.Primary, Icons.Default.Work),
    TimelineEvent("Lunch", "12:30", "Nutrition", "680 kcal • 42g protein", HealthGraphColors.Warning, Icons.Default.LunchDining),
    TimelineEvent("Afternoon Walk", "15:00", "Activity", "22 min • 2,100 steps", HealthGraphColors.Success, Icons.Default.DirectionsWalk),
    TimelineEvent("Workout", "18:00", "Workout", "Upper body strength • 50 min", HealthGraphColors.Accent, Icons.Default.FitnessCenter),
    TimelineEvent("Dinner", "19:30", "Nutrition", "720 kcal • 50g protein", HealthGraphColors.Warning, Icons.Default.DinnerDining),
    TimelineEvent("Meditation", "21:00", "Mindfulness", "15 min • Stress relief", HealthGraphColors.Accent, Icons.Default.SelfImprovement),
    TimelineEvent("Sleep", "22:30", "Sleep", "7h 42m • Score 87%", HealthGraphColors.Primary, Icons.Default.Bedtime),
)

@Composable
fun TimelineEventRow(event: TimelineEvent) {
    val s = rememberGlassAnimationState()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, event.color.copy(alpha = 0.05f), timeMs = s.timeMs)
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier.size(44.dp).liquidGlass(GlassCorner.Full, GlassElevation.Level1, event.color.copy(alpha = 0.15f)).clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.Full)),
            contentAlignment = Alignment.Center
        ) {
            Icon(imageVector = event.icon, contentDescription = null, tint = event.color, modifier = Modifier.size(22.dp))
        }

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(event.title, style = HealthGraphTypography.BodyLarge)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(event.category, style = HealthGraphTypography.Caption.copy(color = event.color))
                Text(event.time, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
            }
        }

        Text(event.value, style = HealthGraphTypography.LabelMedium.copy(color = event.color))
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun PriorityScreen(
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
            ScreenHeader("Priority", "Focus areas & recommendations")

            GlassCardElevated(tint = HealthGraphColors.Warning.copy(alpha = 0.15f)) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Text("Top Priority", style = HealthGraphTypography.TitleMedium.copy(color = HealthGraphColors.OnSurfaceVariant))
                    Text("Recovery Optimization", style = HealthGraphTypography.HeadlineMedium)
                    Text("Your HRV trend suggests focusing on recovery this week. Reduce high-intensity sessions and prioritize sleep.", style = HealthGraphTypography.BodyMedium.copy(color = HealthGraphColors.OnSurfaceVariant))

                    Row(
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        LiquidButton(onClick = { }, label = "View Recovery Plan", variant = LiquidButtonVariant.FILLED, size = LiquidButtonSize.LARGE)
                        LiquidButton(onClick = { }, label = "Adjust Schedule", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.LARGE)
                    }
                }
            }

            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("This Week's Focus", style = HealthGraphTypography.TitleLarge, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp))
                    PriorityItem("Sleep Consistency", "Maintain 22:30 bedtime", 85, HealthGraphColors.Success)
                    PriorityItem("Zone 2 Training", "3 sessions this week", 60, HealthGraphColors.Primary)
                    PriorityItem("Hydration", "3L daily target", 70, HealthGraphColors.Warning)
                    PriorityItem("Stress Management", "Daily 10 min meditation", 45, HealthGraphColors.Error)
                }
            }
        }
    }
}

data class PriorityItem(
    val title: String,
    val description: String,
    val progress: Int,
    val color: Color
)

@Composable
fun PriorityItem(title: String, description: String, progress: Int, color: Color) {
    val s = rememberGlassAnimationState()
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, color.copy(alpha = 0.05f), timeMs = s.timeMs)
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp)
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.SpaceBetween) {
                Text(title, style = HealthGraphTypography.BodyLarge)
                Text("$progress%", style = HealthGraphTypography.TitleMedium.copy(color = color))
            }
            Text(description, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(6.dp)
                    .background(HealthGraphColors.SurfaceVariant.copy(alpha = 0.3f))
                    .clip(androidx.compose.foundation.shape.RoundedCornerShape(3.dp))
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(progress / 100f)
                        .height(6.dp)
                        .background(color)
                        .clip(androidx.compose.foundation.shape.RoundedCornerShape(3.dp))
                )
            }
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
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
            ScreenHeader("Settings", "App preferences")

            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    SettingsRow(Icons.Default.Person, "Account", "Profile, security, notifications")
                    SettingsRow(Icons.Default.Settings, "Units & Display", "Metric/Imperial, theme, language")
                    SettingsRow(Icons.Default.Sync, "Data & Sync", "Backup, export, integrations")
                    SettingsRow(Icons.Default.PrivacyTip, "Privacy", "Data usage, permissions, deletion")
                    SettingsRow(Icons.Default.Help, "Support", "Help center, feedback, about")
                }
            }

            GlassCard {
                LiquidButton(
                    onClick = { /* sign out */ },
                    label = "Sign Out",
                    variant = LiquidButtonVariant.OUTLINE,
                    size = LiquidButtonSize.LARGE,
                    modifier = Modifier.fillMaxWidth().padding(16.dp)
                )
            }
        }
    }
}

data class SettingsRowItem(val icon: androidx.compose.ui.graphics.vector.ImageVector, val title: String, val subtitle: String)

@Composable
fun SettingsRow(icon: androidx.compose.ui.graphics.vector.ImageVector, title: String, subtitle: String) {
    val s = rememberGlassAnimationState()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, HealthGraphColors.RefractionTint.copy(alpha = 0.05f), timeMs = s.timeMs)
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier.size(44.dp).liquidGlass(GlassCorner.Full, GlassElevation.Level1, HealthGraphColors.Primary.copy(alpha = 0.15f)).clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.Full)),
            contentAlignment = Alignment.Center
        ) {
            Icon(imageVector = icon, contentDescription = null, tint = HealthGraphColors.Primary, modifier = Modifier.size(22.dp))
        }
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = HealthGraphTypography.BodyLarge)
            Text(subtitle, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
        }
        Icon(Icons.Default.ChevronRight, contentDescription = null, tint = HealthGraphColors.OnSurfaceVariant, modifier = Modifier.size(24.dp))
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
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.XL))
            .padding(20.dp),
        content = content
    )
}

@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun GlassCard(cornerRadius: androidx.compose.ui.unit.Dp = GlassCorner.LG, elevation: GlassElevation = GlassElevation.Level2, content: @Composable () -> Unit) {
    val s = rememberGlassAnimationState()
    Box(
        Modifier
            .fillMaxWidth()
            .liquidGlass(cornerRadius, elevation, timeMs = s.timeMs)
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(cornerRadius))
            .padding(16.dp),
        content = content
    )
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun PlaceholderScreen(title: String, modifier: androidx.compose.ui.Modifier = androidx.compose.ui.Modifier) {
    val state = rememberGlassAnimationState()

    Box(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp)
            .liquidGlass(
                cornerRadius = 0.dp,
                elevation = 0.dp,
                tint = Color.Transparent,
                timeMs = state.timeMs
            )
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            GlassCard(
                cornerRadius = GlassCorner.XL,
                elevation = GlassElevation.Level3
            ) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(32.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(title, style = HealthGraphTypography.HeadlineLarge, textAlign = TextAlign.Center)
                    Text("$title screen - Implementation pending", style = HealthGraphTypography.BodyMedium.copy(color = HealthGraphColors.OnSurfaceVariant), textAlign = TextAlign.Center)
                    LiquidButton(onClick = {}, label = "Back to Dashboard", variant = LiquidButtonVariant.PRIMARY)
                }
            }
        }
    }
}