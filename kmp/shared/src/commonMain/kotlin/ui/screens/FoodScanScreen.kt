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
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Restaurant
import androidx.compose.material.icons.filled.Add
import androidx.compose.foundation.shape.RoundedCornerShape

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun FoodScanScreen(
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
            ScreenHeader("Food Scan", "Barcode/photo scanning, nutrition analysis")

            // Scan Options
            GlassCardElevated(tint = HealthGraphColors.Warning.copy(alpha = 0.15f)) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text("Scan Food", style = HealthGraphTypography.HeadlineMedium)
                    Text("Barcode or photo", style = HealthGraphTypography.BodyMedium.copy(color = HealthGraphColors.OnSurfaceVariant))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        ScanOption("Barcode", Icons.Default.QrCodeScanner, HealthGraphColors.Primary) { /* scan barcode */ }
                        ScanOption("Photo", Icons.Default.CameraAlt, HealthGraphColors.Success) { /* scan photo */ }
                        ScanOption("Manual", Icons.Default.Restaurant, HealthGraphColors.Accent) { /* manual entry */ }
                    }
                }
            }

            // Recent Scans
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp, bottom = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Recent Scans", style = HealthGraphTypography.TitleLarge)
                        LiquidButton(onClick = { /* view all */ }, label = "View All", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.SMALL)
                    }
                    LazyColumn {
                        items(recentScans) { scan ->
                            ScanRow(scan)
                            if (scan != recentScans.last()) {
                                androidx.compose.foundation.layout.Divider(color = HealthGraphColors.Outline.copy(alpha = 0.1f), modifier = Modifier.fillMaxWidth().padding(16.dp))
                            }
                        }
                    }
                }
            }

            // Quick Add
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Quick Add", style = HealthGraphTypography.TitleLarge, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(16.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        CatChip("Breakfast", Icons.Default.FreeBreakfast, false, { })
                        CatChip("Lunch", Icons.Default.LunchDining, false, { })
                        CatChip("Dinner", Icons.Default.DinnerDining, false, { })
                        CatChip("Snack", Icons.Default.Fastfood, false, { })
                    }
                }
            }
        }
    }
}

data class ScanOption(
    val label: String,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
    val color: Color,
    val onClick: () -> Unit
)

@Composable
fun ScanOption(option: ScanOption) {
    val s = rememberGlassAnimationState()
    Box(
        modifier = Modifier
            .weight(1f)
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, option.color.copy(alpha = 0.12f))
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp)
            .fillMaxWidth()
            .onClick(option.onClick)
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Box(
                modifier = Modifier.size(48.dp).liquidGlass(GlassCorner.Full, GlassElevation.Level1, option.color.copy(alpha = 0.15f)).clip(RoundedCornerShape(GlassCorner.Full)),
                contentAlignment = Alignment.Center
            ) {
                Icon(imageVector = option.icon, contentDescription = null, tint = option.color, modifier = Modifier.size(24.dp))
            }
            Text(option.label, style = HealthGraphTypography.LabelLarge.copy(color = option.color))
        }
    }
}

data class ScannedFood(
    val name: String,
    val brand: String,
    val calories: Int,
    val protein: Int,
    val carbs: Int,
    val fat: Int,
    val scanType: ScanType,
    val date: String
)

enum class ScanType { BARCODE, PHOTO, MANUAL }

val recentScans = listOf(
    ScannedFood("Greek Yogurt", "Chobani", 120, 20, 8, 0, ScanType.BARCODE, "Jan 15"),
    ScannedFood("Protein Bar", "RXBAR", 210, 12, 23, 9, ScanType.BARCODE, "Jan 14"),
    ScannedFood("Chicken Breast", "Home Cooked", 280, 53, 0, 6, ScanType.PHOTO, "Jan 13"),
    ScannedFood("Banana", "Organic", 105, 1, 27, 0, ScanType.MANUAL, "Jan 12"),
    ScannedFood("Almond Milk", "Silk", 30, 1, 1, 2.5, ScanType.BARCODE, "Jan 11"),
)

@Composable
fun ScanRow(scan: ScannedFood) {
    val s = rememberGlassAnimationState()
    val typeColor = when (scan.scanType) {
        ScanType.BARCODE -> HealthGraphColors.Primary
        ScanType.PHOTO -> HealthGraphColors.Success
        ScanType.MANUAL -> HealthGraphColors.Accent
    }
    val typeIcon = when (scan.scanType) {
        ScanType.BARCODE -> Icons.Default.QrCodeScanner
        ScanType.PHOTO -> Icons.Default.CameraAlt
        ScanType.MANUAL -> Icons.Default.Edit
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, typeColor.copy(alpha = 0.05f), timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier.size(44.dp).liquidGlass(GlassCorner.Full, GlassElevation.Level1, typeColor.copy(alpha = 0.15f)).clip(RoundedCornerShape(GlassCorner.Full)),
            contentAlignment = Alignment.Center
        ) {
            Icon(imageVector = typeIcon, contentDescription = null, tint = typeColor, modifier = Modifier.size(22.dp))
        }

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(scan.name, style = HealthGraphTypography.BodyLarge)
            Text(scan.brand, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
        }

        Column(
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text("${scan.calories} kcal", style = HealthGraphTypography.TitleMedium.copy(color = typeColor))
            Text("P:${scan.protein}g C:${scan.carbs}g F:${scan.fat}g", style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
            Text(scan.date, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
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