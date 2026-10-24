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
import androidx.compose.material.icons.filled.Medication
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.Add
import androidx.compose.foundation.shape.RoundedCornerShape
import java.time.LocalTime

@Composable
fun MedicationsScreen(
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
            ScreenHeader("Medications", "Med list, reminders, adherence")

            // Adherence Score
            GlassCardElevated(tint = HealthGraphColors.Primary.copy(alpha = 0.15f)) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text("30-Day Adherence", style = HealthGraphTypography.TitleMedium.copy(color = HealthGraphColors.OnSurfaceVariant))
                    Text("94%", style = HealthGraphTypography.NumberXLarge.copy(color = HealthGraphColors.Success))
                    Text("Excellent", style = HealthGraphTypography.BodyLarge.copy(color = HealthGraphColors.Success))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        AdherenceStat("Taken", "142/150", HealthGraphColors.Success)
                        AdherenceStat("Missed", "8", HealthGraphColors.Warning)
                        AdherenceStat("Streak", "23 days", HealthGraphColors.Primary)
                    }
                }
            }

            // Today's Schedule
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp, bottom = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Today's Schedule", style = HealthGraphTypography.TitleLarge)
                        LiquidButton(onClick = { /* add */ }, label = "Add Med", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.SMALL, icon = Icons.Default.Add)
                    }
                    LazyColumn {
                        items(todayMeds) { med ->
                            MedicationRow(med)
                            if (med != todayMeds.last()) {
                                androidx.compose.foundation.layout.Divider(color = HealthGraphColors.Outline.copy(alpha = 0.1f), modifier = Modifier.fillMaxWidth().padding(16.dp))
                            }
                        }
                    }
                }
            }

            // All Medications
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("All Medications", style = HealthGraphTypography.TitleLarge, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp))
                    LazyColumn {
                        items(allMeds) { med ->
                            MedicationListRow(med)
                            if (med != allMeds.last()) {
                                androidx.compose.foundation.layout.Divider(color = HealthGraphColors.Outline.copy(alpha = 0.1f), modifier = Modifier.fillMaxWidth().padding(16.dp))
                            }
                        }
                    }
                }
            }

            // Interactions Warning
            GlassCard {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(
                        modifier = Modifier.size(44.dp).liquidGlass(GlassCorner.Full, GlassElevation.Level1, HealthGraphColors.Warning.copy(alpha = 0.15f)).clip(RoundedCornerShape(GlassCorner.Full)),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(Icons.Default.Warning, contentDescription = null, tint = HealthGraphColors.Warning, modifier = Modifier.size(22.dp))
                    }
                    Column {
                        Text("Interaction Check", style = HealthGraphTypography.BodyLarge)
                        Text("No known interactions detected", style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
                    }
                }
            }
        }
    }
}

data class AdherenceStat(val label: String, val value: String, val color: Color)

@Composable
fun AdherenceStat(label: String, value: String, color: Color) {
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

data class MedicationScheduleItem(
    val name: String,
    val dosage: String,
    val time: LocalTime,
    val taken: Boolean,
    val color: Color
)

val todayMeds = listOf(
    MedicationScheduleItem("Vitamin D3", "2000 IU", LocalTime.of(8, 0), true, HealthGraphColors.Success),
    MedicationScheduleItem("Omega-3", "1000 mg", LocalTime.of(8, 0), true, HealthGraphColors.Success),
    MedicationScheduleItem("Magnesium", "400 mg", LocalTime.of(20, 0), false, HealthGraphColors.Primary),
    MedicationScheduleItem("Probiotic", "10B CFU", LocalTime.of(8, 0), true, HealthGraphColors.Success),
)

@Composable
fun MedicationRow(med: MedicationScheduleItem) {
    val s = rememberGlassAnimationState()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, if (med.taken) HealthGraphColors.Success.copy(alpha = 0.08f) else HealthGraphColors.RefractionTint.copy(alpha = 0.05f), timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier.size(44.dp).liquidGlass(GlassCorner.Full, GlassElevation.Level1, med.color.copy(alpha = 0.15f)).clip(RoundedCornerShape(GlassCorner.Full)),
            contentAlignment = Alignment.Center
        ) {
            Icon(Icons.Default.Medication, contentDescription = null, tint = med.color, modifier = Modifier.size(22.dp))
        }

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(med.name, style = HealthGraphTypography.BodyLarge)
            Text("${med.dosage}  •  ${med.time.format(java.time.format.DateTimeFormatter.ofPattern("h:mm a"))}", style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
        }

        if (med.taken) {
            Icon(Icons.Default.CheckCircle, contentDescription = null, tint = HealthGraphColors.Success, modifier = Modifier.size(24.dp))
        } else {
            LiquidButton(onClick = { /* mark taken */ }, label = "Take", variant = LiquidButtonVariant.FILLED, size = LiquidButtonSize.SMALL)
        }
    }
}

data class MedicationListItem(
    val name: String,
    val dosage: String,
    val schedule: String,
    val purpose: String,
    val refills: Int,
    val color: Color
)

val allMeds = listOf(
    MedicationListItem("Vitamin D3", "2000 IU", "Daily 8:00 AM", "Deficiency prevention", 2, HealthGraphColors.Success),
    MedicationListItem("Omega-3", "1000 mg", "Daily 8:00 AM", "Heart health", 1, HealthGraphColors.Success),
    MedicationListItem("Magnesium Glycinate", "400 mg", "Daily 8:00 PM", "Sleep & recovery", 3, HealthGraphColors.Primary),
    MedicationListItem("Probiotic", "10B CFU", "Daily 8:00 AM", "Gut health", 0, HealthGraphColors.Success),
    MedicationListItem("Creatine", "5g", "Daily", "Performance", 1, HealthGraphColors.Accent),
)

@Composable
fun MedicationListRow(med: MedicationListItem) {
    val s = rememberGlassAnimationState()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, med.color.copy(alpha = 0.05f), timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier.size(44.dp).liquidGlass(GlassCorner.Full, GlassElevation.Level1, med.color.copy(alpha = 0.15f)).clip(RoundedCornerShape(GlassCorner.Full)),
            contentAlignment = Alignment.Center
        ) {
            Icon(Icons.Default.Medication, contentDescription = null, tint = med.color, modifier = Modifier.size(22.dp))
        }

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(med.name, style = HealthGraphTypography.BodyLarge)
            Text("${med.dosage}  •  ${med.schedule}", style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
            Text(med.purpose, style = HealthGraphTypography.Caption.copy(color = med.color))
        }

        Column(horizontalAlignment = Alignment.End) {
            Text("${med.refills} refills", style = HealthGraphTypography.Caption.copy(color = if (med.refills > 0) HealthGraphColors.Success else HealthGraphColors.Warning))
            LiquidButton(onClick = { /* refill */ }, label = "Refill", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.SMALL)
        }
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