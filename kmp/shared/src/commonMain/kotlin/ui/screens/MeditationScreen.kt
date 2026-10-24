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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import androidx.compose.material.icons.filled.SelfImprovement
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material.icons.filled.Air
import androidx.compose.material.icons.filled.Headphones
import androidx.compose.foundation.shape.RoundedCornerShape

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun MeditationScreen(
    modifier: androidx.compose.ui.Modifier = androidx.compose.ui.Modifier
) {
    val state = rememberGlassAnimationState()
    val selectedSession by remember { mutableStateOf(meditationSessions[0]) }
    val isPlaying by remember { mutableStateOf(false) }
    val currentTime by remember { mutableStateOf(0) }

    Box(
        modifier = modifier
            .fillMaxSize()
            .liquidGlass(cornerRadius = 0.dp, elevation = 0.dp, tint = Color.Transparent, timeMs = state.timeMs)
    ) {
        Column(
            modifier = Modifier.fillMaxSize().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            ScreenHeader("Meditation", "Sessions, breathing, mindfulness stats")

            // Featured Session
            GlassCardElevated(tint = HealthGraphColors.Accent.copy(alpha = 0.15f)) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp)
                ) {
                    Text("Today's Recommendation", style = HealthGraphTypography.TitleMedium.copy(color = HealthGraphColors.OnSurfaceVariant))
                    Text(selectedSession.name, style = HealthGraphTypography.HeadlineMedium)
                    Text(selectedSession.description, style = HealthGraphTypography.BodyMedium.copy(color = HealthGraphColors.OnSurfaceVariant))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        SessionTag("${selectedSession.duration} min", Icons.Default.Timer, HealthGraphColors.Primary)
                        SessionTag(selectedSession.type, Icons.Default.SelfImprovement, HealthGraphColors.Success)
                        SessionTag(selectedSession.level, Icons.Default.TrendingUp, HealthGraphColors.Warning)
                    }

                    // Player
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        LiquidButton(
                            onClick = { /* play/pause */ },
                            label = if (isPlaying) "Pause" : "Start Session",
                            variant = LiquidButtonVariant.FILLED,
                            size = LiquidButtonSize.LARGE,
                            modifier = Modifier.weight(1f),
                            icon = if (isPlaying) Icons.Default.PauseCircle else Icons.Default.PlayCircle
                        )
                        LiquidButton(
                            onClick = { /* next */ },
                            label = "Next",
                            variant = LiquidButtonVariant.OUTLINE,
                            size = LiquidButtonSize.LARGE,
                            icon = Icons.Default.SkipNext
                        )
                    }

                    // Progress
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(6.dp)
                            .background(HealthGraphColors.SurfaceVariant.copy(alpha = 0.3f))
                            .clip(RoundedCornerShape(3.dp))
                    ) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .weight(if (selectedSession.duration > 0) currentTime.toFloat() / selectedSession.duration else 0f)
                                .height(6.dp)
                                .background(HealthGraphColors.Accent)
                                .clip(RoundedCornerShape(3.dp))
                        )
                    }
                    Text("${currentTime}:00 / ${selectedSession.duration}:00", style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
                }
            }

            // Session Library
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("All Sessions", style = HealthGraphTypography.TitleLarge, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp))
                    LazyColumn {
                        items(meditationSessions) { session ->
                            SessionRow(session, session == selectedSession) { selectedSession = session }
                            if (session != meditationSessions.last()) {
                                androidx.compose.foundation.layout.Divider(color = HealthGraphColors.Outline.copy(alpha = 0.1f), modifier = Modifier.fillMaxWidth().padding(16.dp))
                            }
                        }
                    }
                }
            }

            // Stats
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("This Week", style = HealthGraphTypography.TitleLarge, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp))
                    StatRow("Sessions", "5", HealthGraphColors.Primary)
                    StatRow("Total Time", "65 min", HealthGraphColors.Success)
                    StatRow("Streak", "3 days", HealthGraphColors.Accent)
                    StatRow("Avg Duration", "13 min", HealthGraphColors.Warning)
                }
            }

            // Breathing Exercise Quick Access
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Breathing Exercises", style = HealthGraphTypography.TitleLarge, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(16.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        BreathingExercise("Box Breathing", "4-4-4-4", "4 min", Icons.Default.Air, HealthGraphColors.Primary)
                        BreathingExercise("4-7-8", "4-7-8", "5 min", Icons.Default.SelfImprovement, HealthGraphColors.Success)
                        BreathingExercise("Coherent", "5.5-5.5", "5 min", Icons.Default.Favorite, HealthGraphColors.Accent)
                    }
                }
            }
        }
    }
}

data class MeditationSession(
    val name: String,
    val description: String,
    val duration: Int,
    val type: String,
    val level: String,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
    val color: Color
)

val meditationSessions = listOf(
    MeditationSession("Morning Clarity", "Start your day with focus", 10, "Mindfulness", "Beginner", Icons.Default.SelfImprovement, HealthGraphColors.Primary),
    MeditationSession("Stress Relief", "Release tension and anxiety", 15, "Guided", "All Levels", Icons.Default.Favorite, HealthGraphColors.Success),
    MeditationSession("Sleep Preparation", "Wind down for better sleep", 20, "Body Scan", "All Levels", Icons.Default.Nightlight, HealthGraphColors.Accent),
    MeditationSession("Focus Boost", "Sharpen concentration", 10, "Concentration", "Intermediate", Icons.Default.Psychology, HealthGraphColors.Warning),
    MeditationSession("Gratitude Practice", "Cultivate appreciation", 10, "Heart-centered", "Beginner", Icons.Default.SentimentSatisfied, HealthGraphColors.Error),
)

data class SessionTagItem(val text: String, val icon: androidx.compose.ui.graphics.vector.ImageVector, val color: Color)

@Composable
fun SessionTag(text: String, icon: androidx.compose.ui.graphics.vector.ImageVector, color: Color) {
    val s = rememberGlassAnimationState()
    Box(
        modifier = Modifier
            .weight(1f)
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, color.copy(alpha = 0.12f))
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(12.dp)
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(imageVector = icon, contentDescription = null, tint = color, modifier = Modifier.size(16.dp))
            Text(text, style = HealthGraphTypography.LabelMedium.copy(color = color))
        }
    }
}

data class StatItem(val label: String, val value: String, val color: Color)

@Composable
fun StatRow(label: String, value: String, color: Color) {
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
        Text(label, style = HealthGraphTypography.BodyMedium)
        Text(value, style = HealthGraphTypography.TitleMedium.copy(color = color))
    }
}

data class BreathingExerciseItem(
    val name: String,
    val pattern: String,
    val duration: String,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
    val color: Color
)

@Composable
fun BreathingExercise(name: String, pattern: String, duration: String, icon: androidx.compose.ui.graphics.vector.ImageVector, color: Color) {
    val s = rememberGlassAnimationState()
    Box(
        modifier = Modifier
            .weight(1f)
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, color.copy(alpha = 0.12f))
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp)
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Box(
                modifier = Modifier.size(48.dp).liquidGlass(GlassCorner.Full, GlassElevation.Level1, color.copy(alpha = 0.15f)).clip(RoundedCornerShape(GlassCorner.Full)),
                contentAlignment = Alignment.Center
            ) {
                Icon(imageVector = icon, contentDescription = null, tint = color, modifier = Modifier.size(24.dp))
            }
            Text(name, style = HealthGraphTypography.LabelMedium.copy(color = color))
            Text(pattern, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
            Text(duration, style = HealthGraphTypography.Caption.copy(color = color))
        }
    }
}

@Composable
fun SessionRow(session: MeditationSession, selected: Boolean, onClick: () -> Unit) {
    val s = rememberGlassAnimationState()
    val bg = if (selected) session.color.copy(alpha = 0.1f) else HealthGraphColors.RefractionTint.copy(alpha = 0.03f)

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, if (selected) GlassElevation.Level2 else GlassElevation.Level1, bg, timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp)
            .onClick(onClick),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier.size(44.dp).liquidGlass(GlassCorner.Full, GlassElevation.Level1, session.color.copy(alpha = 0.15f)).clip(RoundedCornerShape(GlassCorner.Full)),
            contentAlignment = Alignment.Center
        ) {
            Icon(imageVector = session.icon, contentDescription = null, tint = session.color, modifier = Modifier.size(22.dp))
        }

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(session.name, style = HealthGraphTypography.BodyLarge.copy(color = if (selected) session.color else HealthGraphColors.OnSurface))
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("${session.duration} min", style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
                Text(session.type, style = HealthGraphTypography.Caption.copy(color = session.color))
                Text(session.level, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
            }
        }

        if (selected) {
            Icon(Icons.Default.CheckCircle, contentDescription = null, tint = session.color, modifier = Modifier.size(24.dp))
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