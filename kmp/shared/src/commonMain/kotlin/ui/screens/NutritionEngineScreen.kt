@file:OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
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
import androidx.compose.material.icons.filled.Restaurant
import androidx.compose.material.icons.filled.LocalDrink
import androidx.compose.material.icons.filled.Add
import androidx.compose.foundation.shape.RoundedCornerShape

@Composable
fun NutritionEngineScreen(
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
            ScreenHeader("Nutrition Engine", "Macros, micros, meal logging, hydration")

            // Daily Macro Summary
            GlassCardElevated(tint = HealthGraphColors.Warning.copy(alpha = 0.15f)) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp)
                ) {
                    Text("Today's Macros", style = HealthGraphTypography.TitleMedium.copy(color = HealthGraphColors.OnSurfaceVariant))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        MacroRing("Protein", "142g", "180g", 0.79, HealthGraphColors.Primary)
                        MacroRing("Carbs", "285g", "300g", 0.95, HealthGraphColors.Success)
                        MacroRing("Fat", "78g", "85g", 0.92, HealthGraphColors.Accent)
                    }

                    Text("Calories: 2,340 / 2,500 kcal", style = HealthGraphTypography.BodyLarge.copy(color = HealthGraphColors.OnSurfaceVariant), modifier = Modifier.fillMaxWidth())
                }
            }

            // Hydration
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp, bottom = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Hydration", style = HealthGraphTypography.TitleLarge)
                        Text("2.4L / 3.0L", style = HealthGraphTypography.TitleMedium.copy(color = HealthGraphColors.Primary))
                    }

                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(12.dp)
                            .padding(16.dp)
                            .background(HealthGraphColors.SurfaceVariant.copy(alpha = 0.3f))
                            .clip(RoundedCornerShape(6.dp))
                    ) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .weight(0.8f)
                                .height(12.dp)
                                .background(HealthGraphColors.Primary)
                                .clip(RoundedCornerShape(6.dp))
                        )
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth().padding(16.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        LiquidButton(onClick = { /* +250ml */ }, label = "+250 ml", variant = LiquidButtonVariant.FILLED, size = LiquidButtonSize.SMALL, icon = Icons.Default.Add)
                        LiquidButton(onClick = { /* +500ml */ }, label = "+500 ml", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.SMALL)
                    }
                }
            }

            // Meals
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp, bottom = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Meals", style = HealthGraphTypography.TitleLarge)
                        LiquidButton(onClick = { /* log meal */ }, label = "Log Meal", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.SMALL, icon = Icons.Default.Add)
                    }
                    LazyColumn {
                        items(todayMeals) { meal ->
                            MealRow(meal)
                            if (meal != todayMeals.last()) {
                                androidx.compose.foundation.layout.Divider(color = HealthGraphColors.Outline.copy(alpha = 0.1f), modifier = Modifier.fillMaxWidth().padding(16.dp))
                            }
                        }
                    }
                }
            }

            // Quick Actions
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Quick Log", style = HealthGraphTypography.TitleLarge, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp, bottom = 4.dp))
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

data class MacroRing(
    val label: String,
    val current: String,
    val target: String,
    val progress: Float,
    val color: Color
)

@Composable
fun MacroRing(ring: MacroRing) {
    val s = rememberGlassAnimationState()
    Box(
        Modifier
            .weight(1f)
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, ring.color.copy(alpha = 0.12f))
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp)
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Box(
                modifier = Modifier.size(80.dp)
            ) {
                androidx.compose.foundation.Canvas(Modifier.fillMaxSize()) {
                    val center = androidx.compose.ui.geometry.Offset(size.width/2f, size.height/2f)
                    val radius = min(size.width, size.height)/2f - 8
                    drawCircle(HealthGraphColors.GlassStroke, center, radius, style = androidx.compose.ui.draw.Stroke(8.dp.toPx()))
                    drawArc(ring.color, -90f, 360f * ring.progress, false, androidx.compose.ui.geometry.Offset(center.x - radius, center.y - radius), androidx.compose.ui.geometry.Size(radius*2, radius*2), style = androidx.compose.ui.draw.Stroke(8.dp.toPx(), cap = androidx.compose.ui.graphics.StrokeCap.Round))
                    drawText("${(ring.progress * 100).toInt()}%", 18.sp, HealthGraphColors.OnBackground, FontWeight.Bold, center - androidx.compose.ui.geometry.Offset(20f, 9f))
                }
            }
            Text(ring.label, style = HealthGraphTypography.LabelMedium)
            Text("${ring.current} / ${ring.target}", style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
        }
    }
}

data class Meal(
    val name: String,
    val time: String,
    val calories: Int,
    val protein: Int,
    val carbs: Int,
    val fat: Int,
    val icon: androidx.compose.ui.graphics.vector.ImageVector
)

val todayMeals = listOf(
    Meal("Breakfast", "07:30", 420, 32, 48, 12, Icons.Default.FreeBreakfast),
    Meal("Lunch", "12:45", 680, 42, 75, 22, Icons.Default.LunchDining),
    Meal("Snack", "15:30", 180, 8, 22, 8, Icons.Default.Fastfood),
    Meal("Dinner", "19:00", 720, 50, 85, 26, Icons.Default.DinnerDining),
    Meal("Late Snack", "21:15", 140, 10, 15, 5, Icons.Default.Cookie),
)

@Composable
fun MealRow(meal: Meal) {
    val s = rememberGlassAnimationState()
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
            modifier = Modifier.size(44.dp).liquidGlass(GlassCorner.Full, GlassElevation.Level1, HealthGraphColors.Warning.copy(alpha = 0.15f)).clip(RoundedCornerShape(GlassCorner.Full)),
            contentAlignment = Alignment.Center
        ) {
            Icon(imageVector = meal.icon, contentDescription = null, tint = HealthGraphColors.Warning, modifier = Modifier.size(22.dp))
        }

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(meal.name, style = HealthGraphTypography.BodyLarge)
                Text(meal.time, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
            }
            Text("P: ${meal.protein}g  C: ${meal.carbs}g  F: ${meal.fat}g", style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
        }

        Text("${meal.calories} kcal", style = HealthGraphTypography.TitleMedium.copy(color = HealthGraphColors.Warning))
    }
}

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