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
import androidx.compose.material.icons.filled.MonitorHeart
import androidx.compose.material.icons.filled.Bloodtype
import androidx.compose.material.icons.filled.Thermostat
import androidx.compose.material.icons.filled.Air
import androidx.compose.material.icons.filled.Add
import androidx.compose.foundation.shape.RoundedCornerShape

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun VitalsLoggerScreen(
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
            ScreenHeader("Vitals Logger", "BP, glucose, temp, SpO₂ logging")

            // Quick Add Vitals
            GlassCardElevated(tint = HealthGraphColors.Error.copy(alpha = 0.15f)) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Text("Log New Vitals", style = HealthGraphTypography.TitleLarge)

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        VitalQuickAdd("BP", "120/80", Icons.Default.MonitorHeart, HealthGraphColors.Error) { }
                        VitalQuickAdd("Glucose", "95 mg/dL", Icons.Default.Bloodtype, HealthGraphColors.Warning) { }
                        VitalQuickAdd("Temp", "36.8°C", Icons.Default.Thermostat, HealthGraphColors.Primary) { }
                        VitalQuickAdd("SpO₂", "98%", Icons.Default.Air, HealthGraphColors.Success) { }
                    }
                }
            }

            // Current Vitals
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Current Values", style = HealthGraphTypography.TitleLarge, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp))
                    VitalRow("Blood Pressure", "118/76 mmHg", "Normal", HealthGraphColors.Success, "Jan 15, 07:30")
                    VitalRow("Glucose", "92 mg/dL", "Normal", HealthGraphColors.Success, "Jan 15, 07:15")
                    VitalRow("Temperature", "36.7°C", "Normal", HealthGraphColors.Success, "Jan 15, 07:00")
                    VitalRow("SpO₂", "99%", "Normal", HealthGraphColors.Success, "Jan 14, 20:00")
                    VitalRow("Heart Rate", "58 bpm", "Normal", HealthGraphColors.Success, "Jan 15, 07:30")
                    VitalRow("Respiratory Rate", "14 rpm", "Normal", HealthGraphColors.Primary, "Jan 14, 20:00")
                }
            }

            // Trends
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("7-Day Trends", style = HealthGraphTypography.TitleLarge, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp))
                    TrendMiniChart("Systolic BP", listOf(122, 119, 124, 118, 121, 117, 118), "mmHg", HealthGraphColors.Error)
                    TrendMiniChart("Glucose", listOf(95, 92, 98, 89, 94, 91, 92), "mg/dL", HealthGraphColors.Warning)
                    TrendMiniChart("Temperature", listOf(36.8, 36.7, 36.9, 36.6, 36.8, 36.7, 36.7), "°C", HealthGraphColors.Primary)
                }
            }
        }
    }
}

data class VitalQuickAddItem(
    val label: String,
    val value: String,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
    val color: Color,
    val onClick: () -> Unit
)

@Composable
fun VitalQuickAdd(item: VitalQuickAddItem) {
    val s = rememberGlassAnimationState()
    Box(
        modifier = Modifier
            .weight(1f)
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, item.color.copy(alpha = 0.12f))
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(12.dp)
            .fillMaxWidth()
            .onClick(item.onClick)
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Box(
                modifier = Modifier.size(40.dp).liquidGlass(GlassCorner.Full, GlassElevation.Level1, item.color.copy(alpha = 0.15f)).clip(RoundedCornerShape(GlassCorner.Full)),
                contentAlignment = Alignment.Center
            ) {
                Icon(imageVector = item.icon, contentDescription = null, tint = item.color, modifier = Modifier.size(20.dp))
            }
            Text(item.value, style = HealthGraphTypography.LabelMedium.copy(color = item.color))
            Text(item.label, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
        }
    }
}

data class VitalRowItem(
    val label: String,
    val value: String,
    val status: String,
    val statusColor: Color,
    val timestamp: String
)

@Composable
fun VitalRow(label: String, value: String, status: String, statusColor: Color, timestamp: String) {
    val s = rememberGlassAnimationState()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, statusColor.copy(alpha = 0.05f), timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(label, style = HealthGraphTypography.BodyLarge)
            Text(timestamp, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
        }

        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(value, style = HealthGraphTypography.TitleMedium)
            Text(status, style = HealthGraphTypography.LabelMedium.copy(color = statusColor))
        }
    }
}

data class TrendChartData(val label: String, val values: List<Number>, val unit: String, val color: Color)

@Composable
fun TrendMiniChart(label: String, values: List<Number>, unit: String, color: Color) {
    val s = rememberGlassAnimationState()
    val minVal = values.minOrNull()?.toDouble() ?: 0.0
    val maxVal = values.maxOrNull()?.toDouble() ?: 100.0
    val range = if (maxVal > minVal) maxVal - minVal else 1.0

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, color.copy(alpha = 0.05f), timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp)
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(horizontalArrangement = Arrangement.SpaceBetween) {
                Text(label, style = HealthGraphTypography.BodyLarge)
                Text("${values.last()} $unit", style = HealthGraphTypography.TitleMedium.copy(color = color))
            }

            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(80.dp)
            ) {
                androidx.compose.foundation.Canvas(Modifier.fillMaxSize()) {
                    val points = values.mapIndexed { i, v ->
                        val x = (i / (values.size - 1).toFloat()) * size.width
                        val normalized = (v.toDouble() - minVal) / range
                        val y = size.height - (normalized * (size.height - 20) + 10)
                        androidx.compose.ui.geometry.Offset(x, (y).toFloat())
                    }

                    // Draw area
                    val path = androidx.compose.ui.graphics.Path()
                    path.moveTo(points.first().x, size.height)
                    points.forEach { path.lineTo(it.x, it.y) }
                    path.lineTo(points.last().x, size.height)
                    path.close()
                    drawPath(
                        androidx.compose.ui.graphics.Color(color.value).copy(alpha = 0.15f),
                        path
                    )

                    // Draw line
                    for (i in 1 until points.size) {
                        drawLine(
                            color,
                            points[i - 1],
                            points[i],
                            strokeWidth = 3.dp.toPx(),
                            cap = androidx.compose.ui.graphics.StrokeCap.Round
                        )
                    }

                    // Draw points
                    points.forEach { point ->
                        drawCircle(color, point, 4.dp.toPx())
                    }
                }
            }
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