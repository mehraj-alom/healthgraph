package com.healthgraph.shared.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.unit.Dp
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
fun DashboardScreen(
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
        LazyColumn(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 100.dp)
        ) {
            item {
                DashboardHeader()
            }
            item {
                QuickActionsRow()
            }
            item {
                HealthSummaryCard()
            }
            item {
                TodayMetricsRow()
            }
            item {
                RecentActivityCard()
            }
            item {
                UpcomingRemindersCard()
            }
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun DashboardHeader() {
    val state = rememberGlassAnimationState()
    
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(
                text = "Good morning",
                style = HealthGraphTypography.BodyMedium.copy(color = HealthGraphColors.OnSurfaceVariant)
            )
            Text(
                text = "Welcome back",
                style = HealthGraphTypography.HeadlineLarge
            )
        }
        
        Box(
            modifier = Modifier
                .size(48.dp)
                .liquidGlass(
                    cornerRadius = GlassCorner.Full,
                    elevation = GlassElevation.Level2,
                    tint = HealthGraphColors.RefractionTintCool,
                    timeMs = state.timeMs
                )
                .clip(androidx.compose.foundation.shape.CircleShape)
        ) {
            Icon(
                imageVector = androidx.compose.material.icons.Icons.Default.Person,
                contentDescription = "Profile",
                tint = HealthGraphColors.Primary,
                modifier = Modifier
                    .size(24.dp)
                    .align(Alignment.Center)
            )
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun QuickActionsRow() {
    val actions = listOf(
        QuickAction("Heart Rate", androidx.compose.material.icons.Icons.Default.Favorite, HealthGraphColors.Secondary) {},
        QuickAction("Weight", androidx.compose.material.icons.Icons.Default.MonitorWeight, HealthGraphColors.Accent) {},
        QuickAction("Sleep", androidx.compose.material.icons.Icons.Default.Bedtime, HealthGraphColors.Primary) {},
        QuickAction("Activity", androidx.compose.material.icons.Icons.Default.DirectionsRun, HealthGraphColors.Warning) {}
    )
    
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        actions.forEach { action ->
            QuickActionCard(action = action)
        }
    }
}

data class QuickAction(
    val title: String,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
    val color: Color,
    val onClick: () -> Unit
)

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun QuickActionCard(action: QuickAction) {
    val state = rememberGlassAnimationState()
    
    Box(
        modifier = Modifier
            .weight(1f)
            .height(100.dp)
            .liquidGlass(
                cornerRadius = GlassCorner.MD,
                elevation = GlassElevation.Level2,
                tint = action.color.copy(alpha = 0.2f),
                timeMs = state.timeMs
            )
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.MD))
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .liquidGlass(
                        cornerRadius = GlassCorner.Full,
                        elevation = GlassElevation.Level1,
                        tint = action.color.copy(alpha = 0.15f),
                        timeMs = state.timeMs
                    )
                    .clip(androidx.compose.foundation.shape.CircleShape)
            ) {
                Icon(
                    imageVector = action.icon,
                    contentDescription = action.title,
                    tint = action.color,
                    modifier = Modifier
                        .size(20.dp)
                        .align(Alignment.Center)
                )
            }
            
            Text(
                text = action.title,
                style = HealthGraphTypography.LabelMedium.copy(color = HealthGraphColors.OnSurface),
                textAlign = TextAlign.Center
            )
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun HealthSummaryCard() {
    GlassCardElevated(
        cornerRadius = GlassCorner.LG,
        elevation = GlassElevation.Level3,
        tint = HealthGraphColors.RefractionTintCool
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text("Health Score", style = HealthGraphTypography.TitleLarge)
                Text("87%", style = HealthGraphTypography.NumberLarge.copy(color = HealthGraphColors.Primary))
            }
            
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                HealthMetricItem("Heart", "72 bpm", HealthGraphColors.Secondary)
                HealthMetricItem("Sleep", "7.5h", HealthGraphColors.Primary)
                HealthMetricItem("Steps", "8,432", HealthGraphColors.Accent)
                HealthMetricItem("Stress", "Low", HealthGraphColors.Success)
            }
            
            LiquidButton(
                onClick = {},
                label = "View Details",
                variant = LiquidButtonVariant.OUTLINE,
                size = LiquidButtonSize.MEDIUM
            )
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun HealthMetricItem(title: String, value: String, color: Color) {
    val state = rememberGlassAnimationState()
    
    Box(
        modifier = Modifier
            .weight(1f)
            .liquidGlass(
                cornerRadius = GlassCorner.SM,
                elevation = GlassElevation.Level1,
                tint = color.copy(alpha = 0.15f),
                timeMs = state.timeMs
            )
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.SM))
            .padding(12.dp)
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(4.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(text = title, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
            Text(text = value, style = HealthGraphTypography.TitleMedium.copy(color = color))
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun TodayMetricsRow() {
    GlassCard(
        cornerRadius = GlassCorner.LG,
        elevation = GlassElevation.Level2
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text("Today's Metrics", style = HealthGraphTypography.TitleLarge)
            
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                MetricCard("Calories", "2,140 / 2,500", "85%", HealthGraphColors.Warning)
                MetricCard("Water", "1.8 / 3.0 L", "60%", HealthGraphColors.Primary)
                MetricCard("Protein", "120 / 150g", "80%", HealthGraphColors.Accent)
            }
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun MetricCard(title: String, current: String, progress: String, color: Color) {
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
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(text = title, style = HealthGraphTypography.LabelMedium.copy(color = HealthGraphColors.OnSurfaceVariant))
                Text(text = progress, style = HealthGraphTypography.LabelLarge.copy(color = color))
            }
            
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(6.dp)
                    .liquidGlass(cornerRadius = GlassCorner.Full, elevation = 0.dp, tint = color)
                    .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.Full))
            ) {
                Box(
                    modifier = Modifier
                        .width("85%") // Parse from progress string in real implementation
                        .fillMaxHeight()
                        .background(color)
                        .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.Full))
                )
            }
            
            Text(text = current, style = HealthGraphTypography.BodySmall.copy(color = HealthGraphColors.OnSurfaceMuted))
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun RecentActivityCard() {
    GlassCard(
        cornerRadius = GlassCorner.LG,
        elevation = GlassElevation.Level2
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text("Recent Activity", style = HealthGraphTypography.TitleLarge)
                LiquidButton(
                    onClick = {},
                    label = "View All",
                    variant = LiquidButtonVariant.GHOST,
                    size = LiquidButtonSize.SMALL
                )
            }
            
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                ActivityItem("Morning Run", "5.2 km • 32 min", "07:30 AM", HealthGraphColors.Secondary)
                ActivityItem("Weight Logged", "72.5 kg", "08:15 AM", HealthGraphColors.Accent)
                ActivityItem("Supplements Taken", "Omega-3, Vitamin D", "08:30 AM", HealthGraphColors.Primary)
            }
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun ActivityItem(title: String, description: String, time: String, color: Color) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(12.dp)
                    .background(color)
                    .clip(androidx.compose.foundation.shape.CircleShape)
            )
            
            Column(
                verticalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                Text(text = title, style = HealthGraphTypography.BodyMedium)
                Text(text = description, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
            }
        }
        
        Text(text = time, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceMuted))
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun UpcomingRemindersCard() {
    GlassCard(
        cornerRadius = GlassCorner.LG,
        elevation = GlassElevation.Level2
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text("Upcoming Reminders", style = HealthGraphTypography.TitleLarge)
                LiquidButton(
                    onClick = {},
                    label = "Manage",
                    variant = LiquidButtonVariant.GHOST,
                    size = LiquidButtonSize.SMALL
                )
            }
            
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                ReminderItem("Morning Medication", "09:00 AM", true, HealthGraphColors.Secondary)
                ReminderItem("Evening Walk", "06:30 PM", false, HealthGraphColors.Primary)
                ReminderItem("Hydration Check", "Every 2 hours", false, HealthGraphColors.Accent)
            }
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun ReminderItem(title: String, time: String, isUrgent: Boolean, color: Color) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .background(if (isUrgent) color else HealthGraphColors.OnSurfaceMuted)
                    .clip(androidx.compose.foundation.shape.CircleShape)
            )
            
            Column(
                verticalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                Text(
                    text = title,
                    style = HealthGraphTypography.BodyMedium.copy(
                        color = if (isUrgent) HealthGraphColors.OnBackground else HealthGraphColors.OnSurface
                    )
                )
                Text(text = time, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
            }
        }
        
        if (isUrgent) {
            LiquidButton(
                onClick = {},
                label = "Take Now",
                variant = LiquidButtonVariant.PRIMARY,
                size = LiquidButtonSize.SMALL
            )
        }
    }
}