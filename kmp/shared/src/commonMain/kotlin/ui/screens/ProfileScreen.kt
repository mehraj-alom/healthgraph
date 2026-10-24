@file:OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
package com.healthgraph.shared.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Achievement
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Help
import androidx.compose.material.icons.filled.Logout

@Composable
fun ProfileScreen(
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
            ScreenHeader("Profile", "Settings & Achievements")

            // Profile Header Card
            GlassCardElevated(tint = HealthGraphColors.Primary.copy(alpha = 0.15f)) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Box(
                        modifier = Modifier
                            .size(80.dp)
                            .liquidGlass(GlassCorner.Full, GlassElevation.Level2, HealthGraphColors.Primary.copy(alpha = 0.2f))
                            .clip(androidx.compose.foundation.shape.CircleShape)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Person,
                            contentDescription = null,
                            modifier = Modifier.align(Alignment.Center).size(40.dp),
                            tint = HealthGraphColors.Primary
                        )
                    }

                    Text("Alex Morgan", style = HealthGraphTypography.HeadlineMedium)
                    Text("alex.morgan@healthgraph.app", style = HealthGraphTypography.BodyMedium.copy(color = HealthGraphColors.OnSurfaceVariant))
                    Text("Member since January 2024", style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))

                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        ProfileStat("Streak", "47 days", HealthGraphColors.Success)
                        ProfileStat("Workouts", "156", HealthGraphColors.Primary)
                        ProfileStat("Score", "94%", HealthGraphColors.Accent)
                    }
                }
            }

            // Settings Sections
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                SettingsSection("Account", listOf(
                    SettingsItem(Icons.Default.Person, "Personal Info", "Name, email, photo"),
                    SettingsItem(Icons.Default.Security, "Security", "Password, 2FA, sessions"),
                    SettingsItem(Icons.Default.Notifications, "Notifications", "Push, email, reminders"),
                ))

                SettingsSection("Preferences", listOf(
                    SettingsItem(Icons.Default.Settings, "Units", "Metric / Imperial"),
                    SettingsItem(Icons.Default.Language, "Language", "English"),
                    SettingsItem(Icons.Default.DarkMode, "Theme", "System default"),
                ))

                SettingsSection("Data & Privacy", listOf(
                    SettingsItem(Icons.Default.Download, "Export Data", "Download your health data"),
                    SettingsItem(Icons.Default.Delete, "Delete Account", "Permanently remove account"),
                ))

                SettingsSection("Support", listOf(
                    SettingsItem(Icons.Default.Help, "Help Center", "FAQs & guides"),
                    SettingsItem(Icons.Default.BugReport, "Report Issue", "Send feedback"),
                    SettingsItem(Icons.Default.PrivacyTip, "Privacy Policy", "Data usage terms"),
                ))

                // Logout button
                GlassCard {
                    LiquidButton(
                        onClick = { /* logout */ },
                        label = "Sign Out",
                        variant = LiquidButtonVariant.OUTLINE,
                        size = LiquidButtonSize.LARGE,
                        modifier = Modifier.fillMaxWidth().padding(16.dp)
                    )
                }
            }
        }
    }
}

data class ProfileStat(val label: String, val value: String, val color: Color)

@Composable
fun ProfileStat(label: String, value: String, color: Color) {
    val s = rememberGlassAnimationState()
    Box(
        Modifier
            .weight(1f)
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, color.copy(alpha = 0.15f))
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp)
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Text(value, style = HealthGraphTypography.TitleMedium.copy(color = color))
            Text(label, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
        }
    }
}

data class SettingsItem(
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
    val title: String,
    val subtitle: String
)

data class SettingsSection(val title: String, val items: List<SettingsItem>)

@Composable
fun SettingsSection(title: String, items: List<SettingsItem>) {
    GlassCard {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(title, style = HealthGraphTypography.TitleMedium, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp, bottom = 4.dp))
            items.forEach { item ->
                SettingsRow(item)
                if (item != items.last()) {
                    androidx.compose.foundation.layout.Divider(
                        color = HealthGraphColors.Outline.copy(alpha = 0.1f),
                        modifier = Modifier.fillMaxWidth().padding(16.dp)
                    )
                }
            }
        }
    }
}

@Composable
fun SettingsRow(item: SettingsItem) {
    val s = rememberGlassAnimationState()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, HealthGraphColors.RefractionTint.copy(alpha = 0.05f))
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier.size(40.dp).liquidGlass(GlassCorner.Full, GlassElevation.Level1, HealthGraphColors.Primary.copy(alpha = 0.15f)).clip(androidx.compose.foundation.shape.CircleShape),
            contentAlignment = Alignment.Center
        ) {
            Icon(imageVector = item.icon, contentDescription = null, tint = HealthGraphColors.Primary, modifier = Modifier.size(20.dp))
        }
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(item.title, style = HealthGraphTypography.BodyLarge)
            Text(item.subtitle, style = HealthGraphTypography.BodySmall.copy(color = HealthGraphColors.OnSurfaceVariant))
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
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.XL))
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