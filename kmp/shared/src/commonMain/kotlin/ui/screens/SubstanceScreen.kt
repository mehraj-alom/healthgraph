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
import androidx.compose.material.icons.filled.LocalCafe
import androidx.compose.material.icons.filled.LocalBar
import androidx.compose.material.icons.filled.Medication
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.foundation.shape.RoundedCornerShape

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun SubstanceScreen(
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
            ScreenHeader("Substance Tracking", "Caffeine, alcohol, supplements")

            // Caffeine
            GlassCardElevated(tint = HealthGraphColors.Warning.copy(alpha = 0.15f)) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column {
                            Text("Caffeine Today", style = HealthGraphTypography.TitleMedium)
                            Text("280 mg", style = HealthGraphTypography.NumberLarge.copy(color = HealthGraphColors.Warning))
                        }
                        Box(
                            modifier = Modifier.size(60.dp).liquidGlass(GlassCorner.Full, GlassElevation.Level2, HealthGraphColors.Warning.copy(alpha = 0.2f)).clip(RoundedCornerShape(GlassCorner.Full))
                        ) {
                            androidx.compose.foundation.Canvas(Modifier.fillMaxSize()) {
                                val center = androidx.compose.ui.geometry.Offset(size.width/2f, size.height/2f)
                                val radius = min(size.width, size.height)/2f - 6
                                drawCircle(HealthGraphColors.GlassStroke, center, radius, style = androidx.compose.ui.draw.Stroke(6.dp.toPx()))
                                drawArc(HealthGraphColors.Warning, -90f, 360f * 0.7f, false, androidx.compose.ui.geometry.Offset(center.x - radius, center.y - radius), androidx.compose.ui.geometry.Size(radius*2, radius*2), style = androidx.compose.ui.draw.Stroke(6.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round))
                                drawText("70%", 18.sp, HealthGraphColors.OnBackground, FontWeight.Bold, center - androidx.compose.ui.geometry.Offset(16f, 9f))
                            }
                        }
                    }

                    Text("Limit: 400 mg/day", style = HealthGraphTypography.BodyMedium.copy(color = HealthGraphColors.OnSurfaceVariant))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        LiquidButton(onClick = { /* +coffee */ }, label = "+ Coffee (95mg)", variant = LiquidButtonVariant.FILLED, size = LiquidButtonSize.SMALL, icon = Icons.Default.LocalCafe)
                        LiquidButton(onClick = { /* +tea */ }, label = "+ Tea (47mg)", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.SMALL)
                        LiquidButton(onClick = { /* +preworkout */ }, label = "+ Pre-workout (200mg)", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.SMALL)
                    }
                }
            }

            // Alcohol
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp, bottom = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Alcohol This Week", style = HealthGraphTypography.TitleLarge)
                        Text("2 drinks", style = HealthGraphTypography.TitleMedium.copy(color = HealthGraphColors.Accent))
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth().padding(16.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        LiquidButton(onClick = { /* +drink */ }, label = "Log Drink", variant = LiquidButtonVariant.FILLED, size = LiquidButtonSize.SMALL, icon = Icons.Default.LocalBar)
                        LiquidButton(onClick = { /* view */ }, label = "View History", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.SMALL)
                    }
                }
            }

            // Supplements
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp, bottom = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Daily Supplements", style = HealthGraphTypography.TitleLarge)
                        LiquidButton(onClick = { /* add */ }, label = "Add", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.SMALL, icon = Icons.Default.Add)
                    }
                    LazyColumn {
                        items(supplements) { supp ->
                            SupplementRow(supp)
                            if (supp != supplements.last()) {
                                androidx.compose.foundation.layout.Divider(color = HealthGraphColors.Outline.copy(alpha = 0.1f), modifier = Modifier.fillMaxWidth().padding(16.dp))
                            }
                        }
                    }
                }
            }

            // Weekly Summary
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Weekly Summary", style = HealthGraphTypography.TitleLarge, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp))
                    SummaryRow("Avg Caffeine", "265 mg/day", "Target: <400mg", HealthGraphColors.Success)
                    SummaryRow("Alcohol", "2 drinks", "Target: <7/week", HealthGraphColors.Success)
                    SummaryRow("Supplements", "14/14 taken", "100% adherence", HealthGraphColors.Success)
                }
            }
        }
    }
}

data class SupplementItem(
    val name: String,
    val dosage: String,
    val time: String,
    val taken: Boolean,
    val category: String,
    val color: Color
)

val supplements = listOf(
    SupplementItem("Vitamin D3", "2000 IU", "Morning", true, "Vitamin", HealthGraphColors.Success),
    SupplementItem("Omega-3", "1000 mg", "Morning", true, "Fatty Acid", HealthGraphColors.Success),
    SupplementItem("Magnesium", "400 mg", "Evening", false, "Mineral", HealthGraphColors.Primary),
    SupplementItem("Creatine", "5g", "Anytime", true, "Performance", HealthGraphColors.Accent),
    SupplementItem("Probiotic", "10B CFU", "Morning", true, "Gut Health", HealthGraphColors.Success),
    SupplementItem("Zinc", "15 mg", "Evening", false, "Mineral", HealthGraphColors.Warning),
)

@Composable
fun SupplementRow(supp: SupplementItem) {
    val s = rememberGlassAnimationState()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, supp.color.copy(alpha = 0.05f), timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier.size(44.dp).liquidGlass(GlassCorner.Full, GlassElevation.Level1, supp.color.copy(alpha = 0.15f)).clip(RoundedCornerShape(GlassCorner.Full)),
            contentAlignment = Alignment.Center
        ) {
            Icon(Icons.Default.Medication, contentDescription = null, tint = supp.color, modifier = Modifier.size(22.dp))
        }

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(supp.name, style = HealthGraphTypography.BodyLarge)
            Text("${supp.dosage}  •  ${supp.time}  •  ${supp.category}", style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
        }

        if (supp.taken) {
            Icon(Icons.Default.CheckCircle, contentDescription = null, tint = HealthGraphColors.Success, modifier = Modifier.size(24.dp))
        } else {
            LiquidButton(onClick = { /* take */ }, label = "Take", variant = LiquidButtonVariant.FILLED, size = LiquidButtonSize.SMALL)
        }
    }
}

data class SummaryItem(val label: String, val value: String, val target: String, val color: Color)

@Composable
fun SummaryRow(label: String, value: String, target: String, color: Color) {
    val s = rememberGlassAnimationState()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, color.copy(alpha = 0.05f), timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column {
            Text(label, style = HealthGraphTypography.BodyMedium)
            Text(target, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
        }
        Text(value, style = HealthGraphTypography.TitleMedium.copy(color = color))
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