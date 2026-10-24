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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Code
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.foundation.shape.RoundedCornerShape

@Composable
fun ReportScreen(
    modifier: androidx.compose.ui.Modifier = androidx.compose.ui.Modifier
) {
    val state = rememberGlassAnimationState()
    val selectedReportType by remember { mutableStateOf(ReportType.HEALTH_SUMMARY) }
    val selectedFormat by remember { mutableStateOf(ReportFormat.PDF) }

    Box(
        modifier = modifier
            .fillMaxSize()
            .liquidGlass(cornerRadius = 0.dp, elevation = 0.dp, tint = Color.Transparent, timeMs = state.timeMs)
    ) {
        Column(
            modifier = Modifier.fillMaxSize().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            ScreenHeader("Reports", "Generate & share health reports")

            // Report Type Selector
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Report Type", style = HealthGraphTypography.TitleMedium, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp, bottom = 4.dp))
                    ReportType.values().forEach { type ->
                        ReportTypeRow(type, type == selectedReportType) { selectedReportType = type }
                        if (type != ReportType.values().last()) {
                            androidx.compose.foundation.layout.Divider(color = HealthGraphColors.Outline.copy(alpha = 0.1f), modifier = Modifier.fillMaxWidth().padding(16.dp))
                        }
                    }
                }
            }

            // Format & Options
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text("Format & Options", style = HealthGraphTypography.TitleMedium, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp))

                    Row(
                        modifier = Modifier.fillMaxWidth().padding(16.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        ReportFormat.values().forEach { format ->
                            FormatChip(format, format == selectedFormat) { selectedFormat = format }
                        }
                    }

                    // Schedule options
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        ScheduleOption("Weekly (Mondays)", true)
                        ScheduleOption("Monthly (1st)", false)
                        ScheduleOption("Quarterly", false)
                    }
                }
            }

            // Generate Button
            GlassCard {
                LiquidButton(
                    onClick = { /* generate report */ },
                    label = "Generate ${selectedReportType.label} (${selectedFormat.label})",
                    variant = LiquidButtonVariant.FILLED,
                    size = LiquidButtonSize.LARGE,
                    modifier = Modifier.fillMaxWidth().padding(16.dp)
                )
            }

            // Recent Reports
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Recent Reports", style = HealthGraphTypography.TitleMedium, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp, bottom = 4.dp))
                    LazyColumn {
                        items(recentReports) { report ->
                            ReportHistoryRow(report)
                            if (report != recentReports.last()) {
                                androidx.compose.foundation.layout.Divider(color = HealthGraphColors.Outline.copy(alpha = 0.1f), modifier = Modifier.fillMaxWidth().padding(16.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}

enum class ReportType(val label: String, val description: String, val icon: androidx.compose.ui.graphics.vector.ImageVector, val color: Color) {
    HEALTH_SUMMARY("Health Summary", "Comprehensive overview of all metrics", Icons.Default.PictureAsPdf, HealthGraphColors.Primary),
    FITNESS("Fitness Report", "Workouts, VO₂ Max, strength progress", Icons.Default.DirectionsRun, HealthGraphColors.Success),
    SLEEP("Sleep Analysis", "Sleep stages, efficiency, patterns", Icons.Default.Bedtime, HealthGraphColors.Accent),
    HEART("Cardiovascular", "HRV, resting HR, cardio fitness", Icons.Default.Favorite, HealthGraphColors.Error),
    NUTRITION("Nutrition Log", "Macros, micros, hydration", Icons.Default.Restaurant, HealthGraphColors.Warning),
    WELLBEING("Wellbeing", "Stress, mood, resilience", Icons.Default.SelfImprovement, HealthGraphColors.Primary),
    CUSTOM("Custom Report", "Build your own metric selection", Icons.Default.Edit, HealthGraphColors.Primary)
}

enum class ReportFormat(val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector) {
    PDF("PDF", Icons.Default.PictureAsPdf),
    HTML("HTML", Icons.Default.Code),
    CSV("CSV", Icons.Default.TableChart)
}

data class ScheduleOption(val label: String, val enabled: Boolean)

@Composable
fun ScheduleOption(label: String, enabled: Boolean) {
    val s = rememberGlassAnimationState()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, HealthGraphColors.RefractionTint.copy(alpha = 0.05f))
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, style = HealthGraphTypography.BodyMedium.copy(color = if (enabled) HealthGraphColors.OnSurface else HealthGraphColors.OnSurfaceVariant.copy(alpha = 0.5f)))
        androidx.compose.material3.Switch(
            checked = enabled,
            onCheckedChange = { /* toggle */ },
            enabled = true,
            colors = androidx.compose.material3.SwitchDefaults.colors(thumbColor = HealthGraphColors.Primary, trackColor = HealthGraphColors.Primary.copy(alpha = 0.3f))
        )
    }
}

data class ReportTypeItem(val type: ReportType, val selected: Boolean, val onClick: () -> Unit)

@Composable
fun ReportTypeRow(type: ReportType, selected: Boolean, onClick: () -> Unit) {
    val s = rememberGlassAnimationState()
    val bg = if (selected) type.color.copy(alpha = 0.12f) else HealthGraphColors.RefractionTint.copy(alpha = 0.03f)

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
            modifier = Modifier.size(40.dp).liquidGlass(GlassCorner.Full, GlassElevation.Level1, type.color.copy(alpha = 0.15f)).clip(RoundedCornerShape(GlassCorner.Full)),
            contentAlignment = Alignment.Center
        ) {
            Icon(imageVector = type.icon, contentDescription = null, tint = type.color, modifier = Modifier.size(20.dp))
        }

        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(type.label, style = HealthGraphTypography.BodyLarge.copy(color = if (selected) type.color else HealthGraphColors.OnSurface))
            Text(type.description, style = HealthGraphTypography.BodySmall.copy(color = HealthGraphColors.OnSurfaceVariant))
        }

        if (selected) {
            Icon(Icons.Default.CheckCircle, contentDescription = null, tint = type.color, modifier = Modifier.size(24.dp))
        }
    }
}

data class FormatChipItem(val format: ReportFormat, val selected: Boolean, val onClick: () -> Unit)

@Composable
fun FormatChip(format: ReportFormat, selected: Boolean, onClick: () -> Unit) {
    val s = rememberGlassAnimationState()
    val bg = if (selected) HealthGraphColors.Primary.copy(alpha = 0.15f) else HealthGraphColors.RefractionTint.copy(alpha = 0.05f)
    val txt = if (selected) HealthGraphColors.Primary else HealthGraphColors.OnSurface

    Box(
        modifier = Modifier
            .weight(1f)
            .liquidGlass(GlassCorner.MD, if (selected) GlassElevation.Level2 else GlassElevation.Level1, bg, timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp, 12.dp)
            .fillMaxWidth()
            .onClick(onClick)
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Icon(format.icon, contentDescription = null, tint = txt, modifier = Modifier.size(24.dp))
            Text(format.label, style = HealthGraphTypography.LabelLarge.copy(color = txt))
        }
    }
}

data class ReportHistoryItem(
    val name: String,
    val date: String,
    val format: ReportFormat,
    val size: String
)

val recentReports = listOf(
    ReportHistoryItem("Health Summary - January 2025", "Jan 15, 2025", ReportFormat.PDF, "2.4 MB"),
    ReportHistoryItem("Fitness Report - Q4 2024", "Dec 1, 2024", ReportFormat.PDF, "3.1 MB"),
    ReportHistoryItem("Sleep Analysis - November", "Nov 15, 2024", ReportFormat.HTML, "1.8 MB"),
    ReportHistoryItem("Cardiovascular - October", "Oct 1, 2024", ReportFormat.PDF, "2.0 MB"),
    ReportHistoryItem("Custom Export - All Data", "Sep 15, 2024", ReportFormat.CSV, "15.6 MB")
)

@Composable
fun ReportHistoryRow(report: ReportHistoryItem) {
    val s = rememberGlassAnimationState()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, HealthGraphColors.RefractionTint.copy(alpha = 0.05f))
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(report.name, style = HealthGraphTypography.BodyLarge)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(report.date, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
                Text(report.format.label, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.Primary))
                Text(report.size, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LiquidButton(onClick = { /* view */ }, label = "", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.SMALL, icon = Icons.Default.Visibility, modifier = Modifier.padding(4.dp))
            LiquidButton(onClick = { /* share */ }, label = "", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.SMALL, icon = Icons.Default.Share, modifier = Modifier.padding(4.dp))
            LiquidButton(onClick = { /* delete */ }, label = "", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.SMALL, icon = Icons.Default.Delete, modifier = Modifier.padding(4.dp))
        }
    }
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