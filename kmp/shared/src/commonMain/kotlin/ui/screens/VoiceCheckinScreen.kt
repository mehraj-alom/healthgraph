package com.healthgraph.shared.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
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
import com.healthgraph.shared.ui.components.LiquidButton
import com.healthgraph.shared.ui.components.LiquidButtonVariant
import com.healthgraph.shared.ui.components.LiquidButtonSize
import com.healthgraph.shared.ui.components.CatChip

@Composable
fun VoiceCheckinScreen(modifier: androidx.compose.ui.Modifier = androidx.compose.ui.Modifier) {
    val s = rememberGlassAnimationState()
    val selectedMood by remember { mutableStateOf("calm" ) }
    val voiceLevel by remember { mutableStateOf(50) }
    val transcript by remember { mutableStateOf("") }
    val lastCheckin by remember { LocalDateTime.now() }

    Box(modifier.fillMaxWidth().padding(16.dp).liquidGlass(0.dp, 0.dp, Color.Transparent, s.timeMs)) {
        Column(Modifier.fillMaxWidth(), Arrangement.spacedBy(20.dp)) {
            ScreenHeader("Voice Check-in", "Daily voice recording")

            GlassCardElevated(HealthGraphColors.Primary.copy(alpha=0.1f)) {
                Column(verticalArrangement = Arrangement.spacedBy(24.dp), horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.padding(24.dp)) {
                    // Voice level indicator
    Row(horizontalArrangement = Arrangement.SpaceBetween) {
        Text("Voice Level", style = HealthGraphTypography.BodyMedium)
        Text("${voiceLevel}%", style = HealthGraphTypography.BodyMedium.copy(color=HealthGraphColors.Primary))
    }
                    androidx.compose.foundation.BarGraph(Modifier.size(200.dp, 8.dp).background(HealthGraphColors.SurfaceVariant.copy(alpha=0.3f)), value = voiceLevel, max = 100, barColor = HealthGraphColors.Primary, backgroundColor = HealthGraphColors.SurfaceVariant)

                    // Mood selector
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        CatChip("Happy", "happy", selectedMood == "happy", { selectedMood = "happy" })
                        CatChip("Calm", "calm", selectedMood == "calm", { selectedMood = "calm" })
                        CatChip("Energized", "energized", selectedMood == "energized", { selectedMood = "energized" })
                        CatChip("Stressed", "stressed", selectedMood == "stressed", { selectedMood = "stressed" })
                    }

                    Text("Current: ${selectedMood}", style = HealthGraphTypography.BodyMedium.copy(color=HealthGraphColors.OnSurfaceVariant), modifier = Modifier.padding(horizontal = 24.dp))

                    Spacer(Modifier.weight(1f))

                    // Record button
                    LiquidButton(onClick={ /* record voice */ }, label="Record Voice Check-in", variant=LiquidButtonVariant.FILLED, size=LiquidButtonSize.LARGE, modifier = Modifier.fillMaxWidth().padding(24.dp))

                    Spacer(Modifier.weight(0.5f))

                    Text("Last check-in: ${lastCheckin.format("h:mm a")}", style = HealthGraphTypography.Caption.copy(color=HealthGraphColors.OnSurfaceVariant))
                }
            }

            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Recent Transcripts", style = HealthGraphTypography.TitleLarge)
                    androidx.compose.foundation.lazy.LazyColumn { items(recentTranscripts) { t -> VoiceTranscriptRow(t) } }
                }
            }
        }
    }
}

data class VoiceTranscript(val time: String, val transcript: String, val mood: String, val detectedStress: Int)

val recentTranscripts = listOf(
    VoiceTranscript("12:30 PM", "I feel good today, things are going well", "calm", 20),
    VoiceTranscript("10:15 AM", "Running late, traffic was bad", "stressed", 75),
    VoiceTranscript("08:00 AM", "Morning routine is set", "calm", 15),
    VoiceTranscript("07:00 AM", "Can't find my keys", "stressed", 60)
)

@Composable
fun VoiceTranscriptRow(t: VoiceTranscript) {
    val s = rememberGlassAnimationState()
    Row(Modifier.fillMaxWidth().liquidGlass(GlassCorner.MD, GlassElevation.Level1, HealthGraphColors.RefractionTint.copy(alpha=0.1f)).clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.MD)).padding(12.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
        Column { Text(t.time, style = HealthGraphTypography.BodyMedium); Text(t.transcript, style = HealthGraphTypography.BodySmall.copy(color=HealthGraphColors.OnSurfaceVariant).maxLines(2).overflow = androidx.compose.ui.unit.LineThrough) }
        Text(t.mood, style = HealthGraphTypography.Caption.copy(color=CatChip.getColor(t.mood)))
        Text("${t.detectedStress}% stress", style = HealthGraphTypography.BodySmall.copy(color=HealthGraphColors.Warning))
    }
}

@Composable
fun CatChip(text: String, value: String, selected: Boolean, onClick: () -> Unit) {
    val bg = if (selected) HealthGraphColors.Primary else HealthGraphColors.Surface
    val txt = if (selected) Color.White else HealthGraphColors.OnSurface
    LiquidButton(onClick = onClick, label = text, variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.SMALL, modifier = Modifier.padding(2.dp).background(bg).foregroundColor(txt))
}