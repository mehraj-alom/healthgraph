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

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun TimelineScreen(
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
            TimelineHeader()

            LazyColumn(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 100.dp)
            ) {
                items(timelineEntries) { entry ->
                    TimelineEntryCard(entry = entry)
                }
            }
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun TimelineHeader() {
    val state = rememberGlassAnimationState()

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(
                cornerRadius = GlassCorner.MD,
                elevation = GlassElevation.Level1,
                tint = HealthGraphColors.RefractionTint,
                timeMs = state.timeMs
            )
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(
                verticalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                Text("Timeline", style = HealthGraphTypography.HeadlineMedium)
                Text("Your health journey", style = HealthGraphTypography.BodyMedium.copy(color = HealthGraphColors.OnSurfaceVariant))
            }

            LiquidButton(
                onClick = {},
                label = "Add Entry",
                variant = LiquidButtonVariant.PRIMARY,
                size = LiquidButtonSize.SMALL,
                leadingIcon = { Icon(androidx.compose.material.icons.Icons.Default.Add, "Add") }
            )
        }
    }
}

data class TimelineEntry(
    val id: String,
    val timestamp: String,
    val category: String,
    val title: String,
    val description: String,
    val value: String?,
    val color: Color,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
    val type: EntryType
)

enum class EntryType {
    MEASUREMENT,
    SYMPTOM,
    MEDICATION,
    ACTIVITY,
    NOTE,
    REPORT
}

val timelineEntries = listOf(
    TimelineEntry("1", "08:30 AM", "Vitals", "Blood Pressure", "Morning reading", "118/76 mmHg", HealthGraphColors.Primary, androidx.compose.material.icons.Icons.Default.MonitorHeart, EntryType.MEASUREMENT),
    TimelineEntry("2", "08:15 AM", "Weight", "Weight Logged", "Daily weigh-in", "72.5 kg", HealthGraphColors.Accent, androidx.compose.material.icons.Icons.Default.MonitorWeight, EntryType.MEASUREMENT),
    TimelineEntry("3", "07:30 AM", "Activity", "Morning Run", "5.2 km at 6:15/km", "32 min", HealthGraphColors.Secondary, androidx.compose.material.icons.Icons.Default.DirectionsRun, EntryType.ACTIVITY),
    TimelineEntry("4", "07:00 AM", "Medication", "Morning Supplements", "Omega-3, Vitamin D3, Magnesium", null, HealthGraphColors.Warning, androidx.compose.material.icons.Icons.Default.Medication, EntryType.MEDICATION),
    TimelineEntry("5", "10:00 PM", "Sleep", "Sleep Session", "7h 32m • 85% efficiency", "7.5h", HealthGraphColors.Primary, androidx.compose.material.icons.Icons.Default.Bedtime, EntryType.MEASUREMENT),
    TimelineEntry("6", "06:30 PM", "Activity", "Evening Walk", "3.1 km leisure walk", "28 min", HealthGraphColors.Accent, androidx.compose.material.icons.Icons.Default.DirectionsWalk, EntryType.ACTIVITY),
    TimelineEntry("7", "01:00 PM", "Nutrition", "Lunch Logged", "Grilled salmon, quinoa, vegetables", "650 kcal", HealthGraphColors.Warning, androidx.compose.material.icons.Icons.Default.Restaurant, EntryType.NOTE),
    TimelineEntry("8", "11:00 AM", "Symptom", "Mild Headache", "Tension-type, resolved with hydration", null, HealthGraphColors.Error, androidx.compose.material.icons.Icons.Default.Healing, EntryType.SYMPTOM)
)

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun TimelineEntryCard(entry: TimelineEntry) {
    val state = rememberGlassAnimationState()

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(
                cornerRadius = GlassCorner.MD,
                elevation = GlassElevation.Level1,
                tint = entry.color.copy(alpha = 0.1f),
                timeMs = state.timeMs
            )
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.MD))
            .padding(horizontal = 4.dp, vertical = 4.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalAlignment = Alignment.Top
        ) {
            Box(
                modifier = Modifier
                    .width(4.dp)
                    .fillMaxHeight()
                    .background(entry.color)
                    .clip(androidx.compose.foundation.shape.RoundedCornerShape(2.dp))
            )

            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(top = 4.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            modifier = Modifier
                                .size(32.dp)
                                .liquidGlass(
                                    cornerRadius = GlassCorner.Full,
                                    elevation = GlassElevation.Level1,
                                    tint = entry.color.copy(alpha = 0.15f),
                                    timeMs = state.timeMs
                                )
                                .clip(androidx.compose.foundation.shape.CircleShape)
                        ) {
                            Icon(
                                imageVector = entry.icon,
                                contentDescription = entry.category,
                                tint = entry.color,
                                modifier = Modifier
                                    .size(16.dp)
                                    .align(Alignment.Center)
                            )
                        }

                        Column(
                            verticalArrangement = Arrangement.spacedBy(2.dp)
                        ) {
                            Text(text = entry.category, style = HealthGraphTypography.LabelSmall.copy(color = entry.color))
                            Text(text = entry.timestamp, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceMuted))
                        }
                    }

                    Text(text = entry.title, style = HealthGraphTypography.TitleMedium)
                }

                Text(text = entry.description, style = HealthGraphTypography.BodyMedium.copy(color = HealthGraphColors.OnSurfaceVariant))

                entry.value?.let { value ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text(text = value, style = HealthGraphTypography.NumberMedium.copy(color = entry.color))

                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            LiquidButton(
                                onClick = {},
                                label = "Edit",
                                variant = LiquidButtonVariant.GHOST,
                                size = LiquidButtonSize.SMALL
                            )
                            LiquidButton(
                                onClick = {},
                                label = "Share",
                                variant = LiquidButtonVariant.GHOST,
                                size = LiquidButtonSize.SMALL
                            )
                        }
                    }
                }
            }
        }
    }
}