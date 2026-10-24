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
import com.healthgraph.shared.ui.components.LiquidButtonToggle

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
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
            SettingsHeader()
            
            LazyColumn(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 100.dp)
            ) {
                items(settingsSections) { section ->
                    SettingsSection(section = section)
                }
            }
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun SettingsHeader() {
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
                Text("Settings", style = HealthGraphTypography.HeadlineMedium)
                Text("Customize your experience", style = HealthGraphTypography.BodyMedium.copy(color = HealthGraphColors.OnSurfaceVariant))
            }
            
            Box(
                modifier = Modifier
                    .size(44.dp)
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
                        .size(22.dp)
                        .align(Alignment.Center)
                )
            }
        }
    }
}

data class SettingsSection(
    val title: String,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
    val color: Color,
    val items: List<SettingsItem>
)

data class SettingsItem(
    val title: String,
    val subtitle: String?,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
    val action: SettingsAction
)

enum class SettingsAction {
    NAVIGATE,
    TOGGLE,
    SELECT,
    INFO
}

var themeDark by remember { mutableStateOf(true) }
var notificationsEnabled by remember { mutableStateOf(true) }
var healthConnectEnabled by remember { mutableStateOf(false) }
var biometricEnabled by remember { mutableStateOf(true) }
var dataSyncEnabled by remember { mutableStateOf(true) }

val settingsSections = listOf(
    SettingsSection(
        "Account & Profile",
        androidx.compose.material.icons.Icons.Default.Person,
        HealthGraphColors.Primary,
        listOf(
            SettingsItem("Profile", "Edit your profile", androidx.compose.material.icons.Icons.Default.Edit, SettingsAction.NAVIGATE),
            SettingsItem("Subscription", "Premium active", androidx.compose.material.icons.Icons.Default.Diamond, SettingsAction.INFO),
            SettingsItem("Family Sharing", "Manage family access", androidx.compose.material.icons.Icons.Default.FamilyRestroom, SettingsAction.NAVIGATE),
            SettingsItem("Security", "Password & biometric", androidx.compose.material.icons.Icons.Default.Security, SettingsAction.NAVIGATE)
        )
    ),
    SettingsSection(
        "Appearance",
        androidx.compose.material.icons.Icons.Default.Palette,
        HealthGraphColors.Accent,
        listOf(
            SettingsItem("Dark Mode", "System default", androidx.compose.material.icons.Icons.Default.DarkMode, SettingsAction.TOGGLE),
            SettingsItem("Theme Color", "Teal accent", androidx.compose.material.icons.Icons.Default.ColorLens, SettingsAction.SELECT),
            SettingsItem("Glass Intensity", "High", androidx.compose.material.icons.Icons.Default.Opacity, SettingsAction.SELECT),
            SettingsItem("Animations", "Reduced motion off", androidx.compose.material.icons.Icons.Default.Animation, SettingsAction.TOGGLE)
        )
    ),
    SettingsSection(
        "Health & Data",
        androidx.compose.material.icons.Icons.Default.HealthAndSafety,
        HealthGraphColors.Success,
        listOf(
            SettingsItem("Health Connect", "Sync with Android Health", androidx.compose.material.icons.Icons.Default.Sync, SettingsAction.TOGGLE),
            SettingsItem("Apple Health", "Sync with iOS Health", androidx.compose.material.icons.Icons.Default.Favorite, SettingsAction.TOGGLE),
            SettingsItem("Data Export", "Export all health data", androidx.compose.material.icons.Icons.Default.Download, SettingsAction.NAVIGATE),
            SettingsItem("Data Deletion", "Delete account & data", androidx.compose.material.icons.Icons.Default.DeleteForever, SettingsAction.NAVIGATE)
        )
    ),
    SettingsSection(
        "Notifications",
        androidx.compose.material.icons.Icons.Default.Notifications,
        HealthGraphColors.Warning,
        listOf(
            SettingsItem("Push Notifications", "Enabled", androidx.compose.material.icons.Icons.Default.NotificationsActive, SettingsAction.TOGGLE),
            SettingsItem("Medication Reminders", "Daily at 8 AM", androidx.compose.material.icons.Icons.Default.Medication, SettingsAction.TOGGLE),
            SettingsItem("Activity Reminders", "Movement prompts", androidx.compose.material.icons.Icons.Default.DirectionsRun, SettingsAction.TOGGLE),
            SettingsItem("Weekly Report", "Sunday 9 AM", androidx.compose.material.icons.Icons.Default.Assessment, SettingsAction.TOGGLE)
        )
    ),
    SettingsSection(
        "Privacy & Security",
        androidx.compose.material.icons.Icons.Default.Shield,
        HealthGraphColors.Error,
        listOf(
            SettingsItem("Biometric Lock", "Face ID / Fingerprint", androidx.compose.material.icons.Icons.Default.Fingerprint, SettingsAction.TOGGLE),
            SettingsItem("Auto-Lock", "After 5 minutes", androidx.compose.material.icons.Icons.Default.Timer, SettingsAction.SELECT),
            SettingsItem("Data Encryption", "AES-256 enabled", androidx.compose.material.icons.Icons.Default.Lock, SettingsAction.INFO),
            SettingsItem("Analytics", "Anonymous usage data", androidx.compose.material.icons.Icons.Default.Analytics, SettingsAction.TOGGLE)
        )
    ),
    SettingsSection(
        "Advanced",
        androidx.compose.material.icons.Icons.Default.Settings,
        HealthGraphColors.OnSurfaceMuted,
        listOf(
            SettingsItem("Developer Options", "Debug features", androidx.compose.material.icons.Icons.Default.BugReport, SettingsAction.NAVIGATE),
            SettingsItem("Beta Program", "Join early access", androidx.compose.material.icons.Icons.Default.Science, SettingsAction.NAVIGATE),
            SettingsItem("Reset App", "Clear cache & reset", androidx.compose.material.icons.Icons.Default.RestartAlt, SettingsAction.NAVIGATE),
            SettingsItem("About", "Version 1.0.0", androidx.compose.material.icons.Icons.Default.Info, SettingsAction.INFO)
        )
    )
)

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun SettingsSection(section: SettingsSection) {
    val state = rememberGlassAnimationState()
    
    GlassCard(
        cornerRadius = GlassCorner.LG,
        elevation = GlassElevation.Level2,
        tint = section.color.copy(alpha = 0.1f)
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(0.dp)
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .size(36.dp)
                        .liquidGlass(
                            cornerRadius = GlassCorner.Full,
                            elevation = GlassElevation.Level1,
                            tint = section.color.copy(alpha = 0.2f),
                            timeMs = state.timeMs
                        )
                        .clip(androidx.compose.foundation.shape.CircleShape)
                ) {
                    Icon(
                        imageVector = section.icon,
                        contentDescription = section.title,
                        tint = section.color,
                        modifier = Modifier
                            .size(18.dp)
                            .align(Alignment.Center)
                    )
                }
                
                Text(text = section.title, style = HealthGraphTypography.TitleLarge)
            }
            
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(0.dp)
            ) {
                section.items.forEachIndexed { index, item ->
                    SettingsItemRow(
                        item = item,
                        isFirst = index == 0,
                        isLast = index == section.items.lastIndex,
                        sectionColor = section.color
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun SettingsItemRow(
    item: SettingsItem,
    isFirst: Boolean,
    isLast: Boolean,
    sectionColor: Color
) {
    val state = rememberGlassAnimationState()
    val cornerRadius = when {
        isFirst && isLast -> GlassCorner.MD
        isFirst -> GlassCorner.MD.copy(topStart = GlassCorner.MD.value, topEnd = GlassCorner.MD.value)
        isLast -> GlassCorner.MD.copy(bottomStart = GlassCorner.MD.value, bottomEnd = GlassCorner.MD.value)
        else -> 0.dp
    }
    
    val shape = when {
        isFirst && isLast -> androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.MD)
        isFirst -> androidx.compose.foundation.shape.RoundedCornerShape(topStart = GlassCorner.MD, topEnd = GlassCorner.MD)
        isLast -> androidx.compose.foundation.shape.RoundedCornerShape(bottomStart = GlassCorner.MD, bottomEnd = GlassCorner.MD)
        else -> androidx.compose.foundation.shape.RoundedCornerShape(0.dp)
    }
    
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(
                cornerRadius = if (isFirst && isLast) GlassCorner.MD else 0.dp,
                elevation = GlassElevation.Level1,
                tint = sectionColor.copy(alpha = 0.05f),
                timeMs = state.timeMs
            )
            .clip(shape)
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .combinedClickable(
                onClick = { handleAction(item.action) },
                enabled = item.action != SettingsAction.INFO
            )
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    modifier = Modifier
                        .size(40.dp)
                        .liquidGlass(
                            cornerRadius = GlassCorner.Full,
                            elevation = GlassElevation.Level1,
                            tint = sectionColor.copy(alpha = 0.15f),
                            timeMs = state.timeMs
                        )
                        .clip(androidx.compose.foundation.shape.CircleShape)
                ) {
                    Icon(
                        imageVector = item.icon,
                        contentDescription = item.title,
                        tint = sectionColor,
                        modifier = Modifier
                            .size(20.dp)
                            .align(Alignment.Center)
                    )
                }
                
                Column(
                    verticalArrangement = Arrangement.spacedBy(2.dp)
                ) {
                    Text(text = item.title, style = HealthGraphTypography.BodyMedium)
                    item.subtitle?.let {
                        Text(text = it, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
                    }
                }
            }
            
            when (item.action) {
                SettingsAction.NAVIGATE -> {
                    Icon(
                        imageVector = androidx.compose.material.icons.Icons.Default.ChevronRight,
                        contentDescription = "Navigate",
                        tint = HealthGraphColors.OnSurfaceMuted,
                        modifier = Modifier.size(20.dp)
                    )
                }
                SettingsAction.TOGGLE -> {
                    LiquidButtonToggle(
                        checked = getToggleState(item.title),
                        onCheckedChange = { setToggleState(item.title, it) },
                        variant = LiquidButtonVariant.PRIMARY,
                        size = LiquidButtonSize.SMALL
                    )
                }
                SettingsAction.SELECT -> {
                    Box(
                        modifier = Modifier
                            .padding(horizontal = 8.dp, vertical = 4.dp)
                            .liquidGlass(
                                cornerRadius = GlassCorner.Full,
                                elevation = GlassElevation.Level1,
                                tint = sectionColor.copy(alpha = 0.1f),
                                timeMs = state.timeMs
                            )
                            .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.Full))
                    ) {
                        Text(text = item.subtitle ?: "Select", style = HealthGraphTypography.LabelSmall.copy(color = sectionColor), modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp))
                    }
                }
                SettingsAction.INFO -> {
                    Icon(
                        imageVector = androidx.compose.material.icons.Icons.Default.Info,
                        contentDescription = "Info",
                        tint = HealthGraphColors.OnSurfaceMuted,
                        modifier = Modifier.size(20.dp)
                    )
                }
            }
        }
    }
}

fun getToggleState(title: String): Boolean {
    return when (title) {
        "Dark Mode" -> themeDark
        "Notifications" -> notificationsEnabled
        "Health Connect" -> healthConnectEnabled
        "Biometric Lock" -> biometricEnabled
        "Data Sync" -> dataSyncEnabled
        "Medication Reminders" -> true
        "Activity Reminders" -> true
        "Weekly Report" -> true
        "Auto-Lock" -> true
        "Analytics" -> false
        else -> false
    }
}

fun setToggleState(title: String, value: Boolean) {
    when (title) {
        "Dark Mode" -> themeDark = value
        "Notifications" -> notificationsEnabled = value
        "Health Connect" -> healthConnectEnabled = value
        "Biometric Lock" -> biometricEnabled = value
        "Data Sync" -> dataSyncEnabled = value
        "Medication Reminders" -> {}
        "Activity Reminders" -> {}
        "Weekly Report" -> {}
        "Auto-Lock" -> {}
        "Analytics" -> {}
    }
}

fun handleAction(action: SettingsAction) {
    when (action) {
        SettingsAction.NAVIGATE -> { /* Navigate */ }
        SettingsAction.TOGGLE -> { /* Toggle handled in row */ }
        SettingsAction.SELECT -> { /* Show picker */ }
        SettingsAction.INFO -> { /* Show info */ }
    }
}