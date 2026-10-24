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

            LazyColumn(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 100.dp)
            ) {
                items(healthAreas) { area ->
                    HealthAreaCard(area = area)
                }
            }
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun ScreenHeader(title: String, subtitle: String? = null, action: (@Composable () -> Unit)? = null) {
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
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(text = title, style = HealthGraphTypography.HeadlineMedium)
            subtitle?.let {
                Text(text = it, style = HealthGraphTypography.BodyMedium.copy(color = HealthGraphColors.OnSurfaceVariant))
            }
        }

        action?.invoke()
    }
}

data class HealthArea(
    val id: String,
    val name: String,
    val description: String,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
    val color: Color,
    val score: Int,
    val trend: Trend,
    val engines: List<String>
)

enum class Trend {
    UP(HealthGraphColors.Success),
    DOWN(HealthGraphColors.Error),
    STABLE(HealthGraphColors.Warning);

    val color: Color
    constructor(color: Color) { this.color = color }
}

val healthAreas = listOf(
    HealthArea("heart", "Cardiovascular", "Heart health & circulation", androidx.compose.material.icons.Icons.Default.Favorite, HealthGraphColors.Secondary, 87, Trend.UP, listOf("HRV", "Resting HR", "BP")),
    HealthArea("sleep", "Sleep & Recovery", "Sleep quality & restoration", androidx.compose.material.icons.Icons.Default.Bedtime, HealthGraphColors.Primary, 72, Trend.STABLE, listOf("Duration", "Efficiency", "Stages")),
    HealthArea("fitness", "Fitness & Movement", "Activity & exercise capacity", androidx.compose.material.icons.Icons.Default.DirectionsRun, HealthGraphColors.Accent, 79, Trend.UP, listOf("VO2 Max", "Strength", "Flexibility")),
    HealthArea("nutrition", "Nutrition & Metabolism", "Diet & metabolic health", androidx.compose.material.icons.Icons.Default.Restaurant, HealthGraphColors.Warning, 68, Trend.DOWN, listOf("Macros", "Micros", "Timing")),
    HealthArea("mental", "Mental Wellbeing", "Stress & cognitive health", androidx.compose.material.icons.Icons.Default.Psychology, HealthGraphColors.AccentVariant, 75, Trend.STABLE, listOf("Mood", "Focus", "Resilience")),
    HealthArea("weight", "Weight & Body Comp", "Body composition tracking", androidx.compose.material.icons.Icons.Default.MonitorWeight, HealthGraphColors.Primary, 82, Trend.UP, listOf("Weight", "Body Fat", "Muscle")),
    HealthArea("cycle", "Cycle Health", "Hormonal & reproductive", androidx.compose.material.icons.Icons.Default.CalendarMonth, HealthGraphColors.Secondary, 71, Trend.STABLE, listOf("Regularity", "Symptoms", "Fertility")),
    HealthArea("immunity", "Immune & Resilience", "Illness resistance & recovery", androidx.compose.material.icons.Icons.Default.Shield, HealthGraphColors.Success, 77, Trend.UP, listOf("Inflammation", "Recovery", "Adaptation"))
)

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun HealthAreaCard(area: HealthArea) {
    val state = rememberGlassAnimationState()

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(
                cornerRadius = GlassCorner.LG,
                elevation = GlassElevation.Level2,
                tint = area.color.copy(alpha = 0.15f),
                timeMs = state.timeMs
            )
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.LG))
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(56.dp)
                            .liquidGlass(
                                cornerRadius = GlassCorner.Full,
                                elevation = GlassElevation.Level1,
                                tint = area.color.copy(alpha = 0.2f),
                                timeMs = state.timeMs
                            )
                            .clip(androidx.compose.foundation.shape.CircleShape)
                    ) {
                        Icon(
                            imageVector = area.icon,
                            contentDescription = area.name,
                            tint = area.color,
                            modifier = Modifier
                                .size(28.dp)
                                .align(Alignment.Center)
                        )
                    }

                    Column(
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text(text = area.name, style = HealthGraphTypography.TitleLarge)
                        Text(text = area.description, style = HealthGraphTypography.BodyMedium.copy(color = HealthGraphColors.OnSurfaceVariant))
                    }
                }

                Column(
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                    horizontalAlignment = Alignment.End
                ) {
                    Text(
                        text = "${area.score}%",
                        style = HealthGraphTypography.NumberLarge.copy(color = area.color)
                    )

                    Row(
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            imageVector = when (area.trend) {
                                Trend.UP -> androidx.compose.material.icons.Icons.Default.TrendingUp
                                Trend.DOWN -> androidx.compose.material.icons.Icons.Default.TrendingDown
                                Trend.STABLE -> androidx.compose.material.icons.Icons.Default.Remove
                            },
                            contentDescription = "Trend",
                            tint = area.trend.color,
                            modifier = Modifier.size(16.dp)
                        )
                        Text(
                            text = when (area.trend) {
                                Trend.UP -> "Improving"
                                Trend.DOWN -> "Declining"
                                Trend.STABLE -> "Stable"
                            },
                            style = HealthGraphTypography.LabelSmall.copy(color = area.trend.color)
                        )
                    }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                area.engines.forEach { engine ->
                    Box(
                        modifier = Modifier
                            .liquidGlass(
                                cornerRadius = GlassCorner.Full,
                                elevation = GlassElevation.Level1,
                                tint = area.color.copy(alpha = 0.1f),
                                timeMs = state.timeMs
                            )
                            .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.Full))
                            .padding(horizontal = 12.dp, vertical = 6.dp)
                    ) {
                        Text(text = engine, style = HealthGraphTypography.LabelSmall.copy(color = area.color))
                    }
                }
            }

            LiquidButton(
                onClick = {},
                label = "Explore ${area.name}",
                variant = LiquidButtonVariant.OUTLINE,
                size = LiquidButtonSize.MEDIUM
            )
        }
    }
}