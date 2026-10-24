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
fun PriorityScreen(
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
            PriorityHeader()

            PriorityWorldCard()

            LazyColumn(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 100.dp)
            ) {
                items(priorityLayers) { layer ->
                    PriorityLayerCard(layer = layer)
                }
            }
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun PriorityHeader() {
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
                Text("Priority Engine", style = HealthGraphTypography.HeadlineMedium)
                Text("Your personalized action queue", style = HealthGraphTypography.BodyMedium.copy(color = HealthGraphColors.OnSurfaceVariant))
            }

            LiquidButton(
                onClick = {},
                label = "Refresh",
                variant = LiquidButtonVariant.OUTLINE,
                size = LiquidButtonSize.SMALL,
                leadingIcon = { Icon(androidx.compose.material.icons.Icons.Default.Refresh, "Refresh") }
            )
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun PriorityWorldCard() {
    val state = rememberGlassAnimationState()

    GlassCardElevated(
        cornerRadius = GlassCorner.XL,
        elevation = GlassElevation.Level3,
        tint = HealthGraphColors.RefractionTintCool
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text("Today's Priority Score", style = HealthGraphTypography.TitleMedium.copy(color = HealthGraphColors.OnSurfaceVariant))
                    Text("94%", style = HealthGraphTypography.NumberDisplay.copy(color = HealthGraphColors.Primary))
                }

                Box(
                    modifier = Modifier
                        .size(80.dp)
                        .liquidGlass(
                            cornerRadius = GlassCorner.Full,
                            elevation = GlassElevation.Level2,
                            tint = HealthGraphColors.Primary.copy(alpha = 0.2f),
                            timeMs = state.timeMs
                        )
                        .clip(androidx.compose.foundation.shape.CircleShape)
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(12.dp)
                    ) {
                        androidx.compose.foundation.Canvas(modifier = Modifier.fillMaxSize()) {
                            val center = androidx.compose.ui.geometry.Offset(size.width / 2, size.height / 2)
                            val radius = min(size.width, size.height) / 2 - 4

                            drawCircle(
                                color = HealthGraphColors.GlassStroke,
                                center = center,
                                radius = radius,
                                style = androidx.compose.ui.draw.Stroke(width = 4.dp.toPx())
                            )

                            drawArc(
                                color = HealthGraphColors.Primary,
                                startAngle = -90f,
                                sweepAngle = 360f * 0.94f,
                                useCenter = false,
                                topLeft = androidx.compose.ui.geometry.Offset(center.x - radius, center.y - radius),
                                size = androidx.compose.ui.geometry.Size(radius * 2, radius * 2),
                                style = androidx.compose.ui.draw.Stroke(width = 4.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round)
                            )

                            drawText(
                                text = "94%",
                                fontSize = 24.sp,
                                color = HealthGraphColors.OnBackground,
                                fontWeight = FontWeight.Bold,
                                topLeft = center - androidx.compose.ui.geometry.Offset(30f, 12f)
                            )
                        }
                    }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                PriorityStatItem("Actions Done", "7/8", HealthGraphColors.Success)
                PriorityStatItem("Time Saved", "45 min", HealthGraphColors.Primary)
                PriorityStatItem("Impact", "High", HealthGraphColors.Accent)
            }
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun PriorityStatItem(label: String, value: String, color: Color) {
    val state = rememberGlassAnimationState()

    Box(
        modifier = Modifier
            .weight(1f)
            .liquidGlass(
                cornerRadius = GlassCorner.MD,
                elevation = GlassElevation.Level1,
                tint = color.copy(alpha = 0.15f),
                timeMs = state.timeMs
            )
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp)
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(4.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(text = value, style = HealthGraphTypography.TitleLarge.copy(color = color))
            Text(text = label, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant), textAlign = TextAlign.Center)
        }
    }
}

data class PriorityLayer(
    val id: String,
    val name: String,
    val description: String,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
    val color: Color,
    val priority: Int,
    val actions: List<PriorityAction>,
    val isActive: Boolean
)

data class PriorityAction(
    val id: String,
    val title: String,
    val description: String,
    val estimatedTime: String,
    val impact: Impact,
    val isCompleted: Boolean
)

enum class Impact(val color: Color) {
    HIGH(HealthGraphColors.Error),
    MEDIUM(HealthGraphColors.Warning),
    LOW(HealthGraphColors.Success)
}

val priorityLayers = listOf(
    PriorityLayer(
        "immediate",
        "Immediate",
        "Do now — highest leverage",
        androidx.compose.material.icons.Icons.Default.FlashOn,
        HealthGraphColors.Error,
        1,
        listOf(
            PriorityAction("1", "Take morning medication", "BP meds + supplements", "2 min", Impact.HIGH, false),
            PriorityAction("2", "Log weight", "72.5 kg this morning", "30 sec", Impact.HIGH, true)
        ),
        true
    ),
    PriorityLayer(
        "today",
        "Today",
        "Complete by end of day",
        androidx.compose.material.icons.Icons.Default.Today,
        HealthGraphColors.Warning,
        2,
        listOf(
            PriorityAction("3", "30 min cardio", "Zone 2 run or bike", "30 min", Impact.HIGH, false),
            PriorityAction("4", "Meal prep lunch", "Salmon + quinoa + greens", "15 min", Impact.MEDIUM, false),
            PriorityAction("5", "Evening walk", "3 km post-dinner", "25 min", Impact.MEDIUM, false)
        ),
        true
    ),
    PriorityLayer(
        "this_week",
        "This Week",
        "Schedule this week",
        androidx.compose.material.icons.Icons.Default.DateRange,
        HealthGraphColors.Primary,
        3,
        listOf(
            PriorityAction("6", "Blood work", "Lipid panel + hormones", "1 hr", Impact.HIGH, false),
            PriorityAction("7", "Mobility session", "Hip & thoracic focus", "20 min", Impact.MEDIUM, false),
            PriorityAction("8", "Sleep optimization", "Cool room, no screens 1hr before", "Ongoing", Impact.LOW, false)
        ),
        false
    ),
    PriorityLayer(
        "this_month",
        "This Month",
        "Monthly goals & check-ins",
        androidx.compose.material.icons.Icons.Default.CalendarMonth,
        HealthGraphColors.Accent,
        4,
        listOf(
            PriorityAction("9", "DEXA scan", "Body composition analysis", "1 hr", Impact.HIGH, false),
            PriorityAction("10", "VO2 max test", "Cardio fitness benchmark", "45 min", Impact.MEDIUM, false),
            PriorityAction("11", "Supplement review", "Adjust based on blood work", "30 min", Impact.LOW, false)
        ),
        false
    )
)

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun PriorityLayerCard(layer: PriorityLayer) {
    val state = rememberGlassAnimationState()
    val expanded by remember { mutableStateOf(layer.isActive) }

    GlassCard(
        cornerRadius = GlassCorner.LG,
        elevation = if (layer.isActive) GlassElevation.Level3 else GlassElevation.Level2,
        tint = layer.color.copy(alpha = 0.15f)
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Box(
                        modifier = Modifier
                            .size(44.dp)
                            .liquidGlass(
                                cornerRadius = GlassCorner.Full,
                                elevation = GlassElevation.Level1,
                                tint = layer.color.copy(alpha = 0.2f),
                                timeMs = state.timeMs
                            )
                            .clip(androidx.compose.foundation.shape.CircleShape)
                    ) {
                        Icon(
                            imageVector = layer.icon,
                            contentDescription = layer.name,
                            tint = layer.color,
                            modifier = Modifier
                                .size(22.dp)
                                .align(Alignment.Center)
                        )
                    }

                    Column(
                        verticalArrangement = Arrangement.spacedBy(2.dp)
                    ) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(text = layer.name, style = HealthGraphTypography.TitleLarge)
                            Text(text = "Priority ${layer.priority}", style = HealthGraphTypography.LabelSmall.copy(color = layer.color, fontWeight = FontWeight.Bold))
                        }
                        Text(text = layer.description, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
                    }
                }

                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "${layer.actions.count { it.isCompleted }}/${layer.actions.size}",
                        style = HealthGraphTypography.NumberMedium.copy(color = layer.color)
                    )

                    Icon(
                        imageVector = if (expanded)
                            androidx.compose.material.icons.Icons.Default.KeyboardArrowUp
                        else
                            androidx.compose.material.icons.Icons.Default.KeyboardArrowDown,
                        contentDescription = "Expand",
                        tint = HealthGraphColors.OnSurfaceVariant,
                        modifier = Modifier
                            .size(20.dp)
                            .combinedClickable(onClick = { /* toggle expanded */ })
                    )
                }
            }

            if (expanded) {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    layer.actions.forEach { action ->
                        PriorityActionItem(action = action, layerColor = layer.color)
                    }

                    LiquidButton(
                        onClick = {},
                        label = "Add Action",
                        variant = LiquidButtonVariant.GHOST,
                        size = LiquidButtonSize.SMALL,
                        leadingIcon = { Icon(androidx.compose.material.icons.Icons.Default.Add, "Add") }
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun PriorityActionItem(action: PriorityAction, layerColor: Color) {
    val state = rememberGlassAnimationState()

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(
                cornerRadius = GlassCorner.MD,
                elevation = GlassElevation.Level1,
                tint = layerColor.copy(alpha = if (action.isCompleted) 0.05f else 0.1f),
                timeMs = state.timeMs
            )
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.MD))
            .padding(12.dp)
            .alpha(if (action.isCompleted) 0.6f else 1f)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .size(24.dp)
                        .border(
                            width = 2.dp,
                            color = if (action.isCompleted) layerColor else action.impact.color,
                            shape = androidx.compose.foundation.shape.CircleShape
                        )
                ) {
                    if (action.isCompleted) {
                        Icon(
                            imageVector = androidx.compose.material.icons.Icons.Default.Check,
                            contentDescription = "Completed",
                            tint = layerColor,
                            modifier = Modifier
                                .size(14.dp)
                                .align(Alignment.Center)
                        )
                    }
                }

                Column(
                    verticalArrangement = Arrangement.spacedBy(2.dp)
                ) {
                    Text(
                        text = action.title,
                        style = HealthGraphTypography.BodyMedium.copy(
                            color = if (action.isCompleted) HealthGraphColors.OnSurfaceMuted else HealthGraphColors.OnBackground,
                            textDecoration = if (action.isCompleted) androidx.compose.ui.text.style.TextDecoration.LineThrough else null
                        )
                    )
                    Text(text = action.description, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
                }
            }

            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .padding(horizontal = 8.dp, vertical = 4.dp)
                        .background(action.impact.color.copy(alpha = 0.2f))
                        .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.Full))
                ) {
                    Text(text = action.impact.name, style = HealthGraphTypography.LabelSmall.copy(color = action.impact.color))
                }

                Text(text = action.estimatedTime, style = HealthGraphTypography.LabelSmall.copy(color = HealthGraphColors.OnSurfaceMuted))
            }
        }
    }
}