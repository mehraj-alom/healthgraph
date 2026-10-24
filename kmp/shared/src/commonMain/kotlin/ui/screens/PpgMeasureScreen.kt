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
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.PlayCircle
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Help
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.Canvas

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun PpgMeasureScreen(
    modifier: androidx.compose.ui.Modifier = androidx.compose.ui.Modifier,
    onBack: () -> Unit = {}
) {
    val state = rememberGlassAnimationState()
    val measurementState by remember { mutableStateOf(MeasurementState.IDLE) }
    val heartRate by remember { mutableStateOf(0) }
    val progress by remember { mutableStateOf(0f) }
    val pulsePoints by remember { mutableStateOf(mutableListOf<Float>()) }

    Box(
        modifier = modifier
            .fillMaxSize()
            .liquidGlass(cornerRadius = 0.dp, elevation = 0.dp, tint = Color.Transparent, timeMs = state.timeMs)
    ) {
        Column(
            modifier = Modifier.fillMaxSize().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)
        ) {
            ScreenHeader("PPG Measurement", "Camera-based heart rate", onBack = onBack)

            // Camera Preview Area
            GlassCardElevated(tint = HealthGraphColors.Error.copy(alpha = 0.15f)) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    // Camera preview placeholder
                    Box(
                        modifier = Modifier
                            .size(200.dp)
                            .background(HealthGraphColors.SurfaceVariant.copy(alpha = 0.3f))
                            .clip(RoundedCornerShape(GlassCorner.LG))
                    ) {
                        Column(modifier = Modifier.fillMaxSize(), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                            when (measurementState) {
                                MeasurementState.IDLE -> {
                                    Icon(Icons.Default.Favorite, contentDescription = null, tint = HealthGraphColors.Error.copy(alpha = 0.5f), modifier = Modifier.size(64.dp))
                                    androidx.compose.foundation.layout.Spacer(modifier = Modifier.height(12.dp))
                                    Text("Place finger over camera", style = HealthGraphTypography.TitleMedium.copy(color = HealthGraphColors.OnSurfaceVariant))
                                    Text("Cover camera & flash completely", style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant.copy(alpha = 0.7f)))
                                }
                                MeasurementState.MEASURING -> {
                                    // Live pulse wave
                                    Box(modifier = Modifier.fillMaxSize()) {
                                        androidx.compose.foundation.Canvas(Modifier.fillMaxSize()) {
                                            val centerY = size.height / 2f
                                            val waveHeight = size.height * 0.3f
                                            
                                            // Draw grid
                                            for (i in 0..10) {
                                                val y = centerY + (i - 5) * (waveHeight / 5f)
                                                drawLine(
                                                    HealthGraphColors.GlassStroke.copy(alpha = 0.3f),
                                                    androidx.compose.ui.geometry.Offset(0f, y),
                                                    androidx.compose.ui.geometry.Offset(size.width, y),
                                                    strokeWidth = 1.dp.toPx()
                                                )
                                            }
                                            
                                            // Draw pulse wave
                                            val points = pulsePoints.mapIndexed { i, v ->
                                                val x = (i / (pulsePoints.size - 1).toFloat()) * size.width
                                                val y = centerY - v * waveHeight
                                                androidx.compose.ui.geometry.Offset(x, y)
                                            }
                                            
                                            for (j in 1 until points.size) {
                                                drawLine(
                                                    HealthGraphColors.Error,
                                                    points[j - 1],
                                                    points[j],
                                                    strokeWidth = 2.dp.toPx(),
                                                    cap = androidx.compose.ui.graphics.StrokeCap.Round
                                                )
                                            }
                                        }
                                    }
                                    
                                    // Heart rate display
                                    Column(
                                        modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 16.dp),
                                        horizontalAlignment = Alignment.CenterHorizontally
                                    ) {
                                        if (heartRate > 0) {
                                            Text("$heartRate", style = HealthGraphTypography.NumberXLarge.copy(color = HealthGraphColors.Error, fontSize = 72.sp))
                                            Text("BPM", style = HealthGraphTypography.TitleMedium.copy(color = HealthGraphColors.OnSurfaceVariant))
                                        } else {
                                            Text("--", style = HealthGraphTypography.NumberXLarge.copy(color = HealthGraphColors.OnSurfaceVariant.copy(alpha = 0.5f), fontSize = 72.sp))
                                            Text("BPM", style = HealthGraphTypography.TitleMedium.copy(color = HealthGraphColors.OnSurfaceVariant))
                                        }
                                    }
                                }
                                MeasurementState.COMPLETE -> {
                                    Icon(Icons.Default.CheckCircle, contentDescription = null, tint = HealthGraphColors.Success, modifier = Modifier.size(64.dp))
                                    androidx.compose.foundation.layout.Spacer(modifier = Modifier.height(12.dp))
                                    if (heartRate > 0) {
                                        Text("$heartRate BPM", style = HealthGraphTypography.NumberXLarge.copy(color = HealthGraphColors.Success))
                                    }
                                    Text("Measurement complete", style = HealthGraphTypography.BodyMedium.copy(color = HealthGraphColors.OnSurfaceVariant))
                                }
                                MeasurementState.ERROR -> {
                                    Icon(Icons.Default.Error, contentDescription = null, tint = HealthGraphColors.Error, modifier = Modifier.size(64.dp))
                                    androidx.compose.foundation.layout.Spacer(modifier = Modifier.height(12.dp))
                                    Text("Measurement failed", style = HealthGraphTypography.TitleMedium.copy(color = HealthGraphColors.Error))
                                    Text("Try again with steady pressure", style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
                                }
                            }
                        }
                    }

                    // Progress bar during measurement
                    if (measurementState == MeasurementState.MEASURING) {
                        Column(
                            modifier = Modifier.fillMaxWidth(),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(8.dp)
                                    .background(HealthGraphColors.SurfaceVariant.copy(alpha = 0.3f))
                                    .clip(RoundedCornerShape(4.dp))
                            ) {
                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .weight(progress)
                                        .height(8.dp)
                                        .background(HealthGraphColors.Error)
                                        .clip(RoundedCornerShape(4.dp))
                                )
                            }
                            Text("${(progress * 100).toInt()}%", style = HealthGraphTypography.LabelMedium.copy(color = HealthGraphColors.Error))
                        }
                    }

                    // Action button
                    when (measurementState) {
                        MeasurementState.IDLE -> {
                            LiquidButton(
                                onClick = { startMeasurement() },
                                label = "Start Measurement",
                                variant = LiquidButtonVariant.FILLED,
                                size = LiquidButtonSize.LARGE,
                                modifier = Modifier.fillMaxWidth().padding(24.dp),
                                icon = Icons.Default.PlayCircle
                            )
                        }
                        MeasurementState.MEASURING -> {
                            LiquidButton(
                                onClick = { cancelMeasurement() },
                                label = "Cancel",
                                variant = LiquidButtonVariant.OUTLINE,
                                size = LiquidButtonSize.LARGE,
                                modifier = Modifier.fillMaxWidth().padding(24.dp)
                            )
                        }
                        MeasurementState.COMPLETE -> {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.spacedBy(12.dp)
                            ) {
                                LiquidButton(
                                    onClick = { saveMeasurement() },
                                    label = "Save",
                                    variant = LiquidButtonVariant.FILLED,
                                    size = LiquidButtonSize.LARGE,
                                    modifier = Modifier.weight(1f),
                                    icon = Icons.Default.CheckCircle
                                )
                                LiquidButton(
                                    onClick = { resetMeasurement() },
                                    label = "Retake",
                                    variant = LiquidButtonVariant.OUTLINE,
                                    size = LiquidButtonSize.LARGE,
                                    modifier = Modifier.weight(1f)
                                )
                            }
                        }
                        MeasurementState.ERROR -> {
                            LiquidButton(
                                onClick = { resetMeasurement() },
                                label = "Try Again",
                                variant = LiquidButtonVariant.FILLED,
                                size = LiquidButtonSize.LARGE,
                                modifier = Modifier.fillMaxWidth().padding(24.dp)
                            )
                        }
                    }
                }
            }

            // Tips
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Tips for Accurate Reading", style = HealthGraphTypography.TitleLarge, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp))
                    TipRow("Cover both camera lens and flash completely")
                    TipRow("Press gently - don't press too hard")
                    TipRow("Keep finger still during measurement")
                    TipRow("Ensure good lighting in the room")
                    TipRow("Warm your hands if they're cold")
                }
            }

            // History
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp, bottom = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Recent Measurements", style = HealthGraphTypography.TitleLarge)
                        LiquidButton(onClick = { /* view all */ }, label = "View All", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.SMALL)
                    }
                    LazyColumn {
                        items(recentMeasurements) { m ->
                            MeasurementHistoryRow(m)
                            if (m != recentMeasurements.last()) {
                                androidx.compose.foundation.layout.Divider(color = HealthGraphColors.Outline.copy(alpha = 0.1f), modifier = Modifier.fillMaxWidth().padding(16.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}

enum class MeasurementState { IDLE, MEASURING, COMPLETE, ERROR }

data class MeasurementHistoryItem(
    val bpm: Int,
    val date: String,
    val time: String,
    val quality: MeasurementQuality
)

enum class MeasurementQuality { GOOD, FAIR, POOR }

val recentMeasurements = listOf(
    MeasurementHistoryItem(72, "Jan 15", "07:30", MeasurementQuality.GOOD),
    MeasurementHistoryItem(68, "Jan 14", "19:45", MeasurementQuality.GOOD),
    MeasurementHistoryItem(75, "Jan 13", "07:15", MeasurementQuality.FAIR),
    MeasurementHistoryItem(70, "Jan 12", "20:00", MeasurementQuality.GOOD),
    MeasurementHistoryItem(69, "Jan 11", "07:00", MeasurementQuality.GOOD),
)

fun startMeasurement() {
    // Implementation would start camera preview and PPG processing
}

fun cancelMeasurement() {
    // Implementation would stop camera preview
}

fun saveMeasurement() {
    // Implementation would save to database
}

fun resetMeasurement() {
    // Implementation would reset state
}

@Composable
fun TipRow(tip: String) {
    val s = rememberGlassAnimationState()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, HealthGraphColors.RefractionTint.copy(alpha = 0.03f), timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp, 12.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(Icons.Default.CheckCircle, contentDescription = null, tint = HealthGraphColors.Success, modifier = Modifier.size(20.dp))
        Text(tip, style = HealthGraphTypography.BodyMedium)
    }
}

@Composable
fun MeasurementHistoryRow(m: MeasurementHistoryItem) {
    val s = rememberGlassAnimationState()
    val qualityColor = when (m.quality) {
        MeasurementQuality.GOOD -> HealthGraphColors.Success
        MeasurementQuality.FAIR -> HealthGraphColors.Warning
        MeasurementQuality.POOR -> HealthGraphColors.Error
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, HealthGraphColors.RefractionTint.copy(alpha = 0.05f), timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier.size(44.dp).liquidGlass(GlassCorner.Full, GlassElevation.Level1, HealthGraphColors.Error.copy(alpha = 0.15f)).clip(RoundedCornerShape(GlassCorner.Full)),
            contentAlignment = Alignment.Center
        ) {
            Icon(Icons.Default.Favorite, contentDescription = null, tint = HealthGraphColors.Error, modifier = Modifier.size(22.dp))
        }

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text("${m.bpm} BPM", style = HealthGraphTypography.TitleMedium)
            Text("${m.date} at ${m.time}", style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
        }

        Text(m.quality.name, style = HealthGraphTypography.LabelMedium.copy(color = qualityColor))
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
fun ScreenHeader(title: String, subtitle: String? = null, onBack: () -> Unit = {}) {
    val s = rememberGlassAnimationState()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, HealthGraphColors.RefractionTint, timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = HealthGraphTypography.HeadlineMedium)
            subtitle?.let { Text(it, style = HealthGraphTypography.BodyMedium.copy(color = HealthGraphColors.OnSurfaceVariant)) }
        }
        if (onBack != null) {
            LiquidButton(onClick = onBack, label = "", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.SMALL, icon = Icons.Default.ArrowBack)
        }
    }
}