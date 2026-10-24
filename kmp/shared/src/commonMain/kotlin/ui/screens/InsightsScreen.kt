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
import androidx.compose.material.icons.filled.TrendingUp
import androidx.compose.material.icons.filled.TrendingDown
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.Insights
import androidx.compose.material.icons.filled.Favorite

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun InsightsScreen(
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
            ScreenHeader("Insights", "AI-powered correlations & predictions")

            // AI Insight Cards
            LazyColumn(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(insights) { insight ->
                    InsightCard(insight)
                }
            }
        }
    }
}

data class Insight(
    val title: String,
    val description: String,
    val type: InsightType,
    val confidence: Int,
    val action: String?,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
    val color: Color
)

enum class InsightType { CORRELATION, PREDICTION, WARNING, ACHIEVEMENT, RECOMMENDATION }

val insights = listOf(
    Insight(
        "Sleep → Recovery Correlation",
        "Your HRV increases 12% on nights with 7.5h+ sleep. Prioritize sleep for better recovery.",
        InsightType.CORRELATION,
        87,
        "View sleep tips",
        Icons.Default.Psychology,
        HealthGraphColors.Primary
    ),
    Insight(
        "VO₂ Max Trend",
        "Current trajectory suggests 44.1 ml/kg/min in 4 weeks if training consistency maintains.",
        InsightType.PREDICTION,
        72,
        "Adjust plan",
        Icons.Default.TrendingUp,
        HealthGraphColors.Success
    ),
    Insight(
        "Late Caffeine Impact",
        "Caffeine after 2 PM correlates with 23 min less deep sleep. Consider cutoff at noon.",
        InsightType.WARNING,
        91,
        "Set caffeine limit",
        Icons.Default.Warning,
        HealthGraphColors.Warning
    ),
    Insight(
        "Strength Milestone",
        "Bench press 1RM projected to hit 225 lbs this month. 3 sessions away.",
        InsightType.ACHIEVEMENT,
        78,
        "Log workout",
        Icons.Default.CheckCircle,
        HealthGraphColors.Accent
    ),
    Insight(
        "Stress → HRV Pattern",
        "High stress days show 18% HRV drop next morning. Try evening meditation.",
        InsightType.RECOMMENDATION,
        84,
        "Try meditation",
        Icons.Default.Favorite,
        HealthGraphColors.Error
    ),
    Insight(
        "Hydration & Performance",
        "Days with 3L+ water show 15% better workout RPE. Current avg: 2.2L.",
        InsightType.CORRELATION,
        79,
        "Set water goal",
        Icons.Default.Insights,
        HealthGraphColors.Primary
    )
)

@Composable
fun InsightCard(insight: Insight) {
    val s = rememberGlassAnimationState()
    val bgColor = insight.color.copy(alpha = 0.12f)

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.LG, GlassElevation.Level2, bgColor, timeMs = s.timeMs)
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.LG))
            .padding(16.dp)
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier.size(44.dp).liquidGlass(GlassCorner.Full, GlassElevation.Level1, insight.color.copy(alpha = 0.15f)).clip(androidx.compose.foundation.shape.CircleShape),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(imageVector = insight.icon, contentDescription = null, tint = insight.color, modifier = Modifier.size(22.dp))
                }

                Column(
                    modifier = Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(2.dp)
                ) {
                    Row(horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(insight.title, style = HealthGraphTypography.TitleMedium)
                        Box(
                            modifier = Modifier.padding(8.dp, 4.dp).background(insight.color.copy(alpha = 0.15f)).clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.SM))
                        ) {
                            Text("${insight.confidence}%", style = HealthGraphTypography.LabelSmall.copy(color = insight.color), modifier = Modifier.padding(8.dp, 2.dp))
                        }
                    }
                    Text(insight.type.name.capitalize(), style = HealthGraphTypography.LabelMedium.copy(color = insight.color))
                }
            }

            Text(insight.description, style = HealthGraphTypography.BodyMedium.copy(color = HealthGraphColors.OnSurfaceVariant))

            insight.action?.let { action ->
                LiquidButton(
                    onClick = { /* handle action */ },
                    label = action,
                    variant = LiquidButtonVariant.OUTLINE,
                    size = LiquidButtonSize.SMALL,
                    modifier = Modifier.align(Alignment.End)
                )
            }
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun GlassCard(content: @Composable () -> Unit) {
    val s = rememberGlassAnimationState()
    Box(
        Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.LG, GlassElevation.Level2, timeMs = s.timeMs)
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.LG))
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
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp)
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = HealthGraphTypography.HeadlineMedium)
            subtitle?.let { Text(it, style = HealthGraphTypography.BodyMedium.copy(color = HealthGraphColors.OnSurfaceVariant)) }
        }
    }
}