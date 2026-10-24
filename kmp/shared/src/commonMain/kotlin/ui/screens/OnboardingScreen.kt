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

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun OnboardingScreen(
    modifier: androidx.compose.ui.Modifier = androidx.compose.ui.Modifier,
    onComplete: () -> Unit = {}
) {
    val state = rememberGlassAnimationState()
    val currentStep by remember { mutableStateOf(0) }
    
    val steps = listOf(
        OnboardingStep("Welcome", "Your health journey starts here", Icons.Default.Favorite, HealthGraphColors.Primary),
        OnboardingStep("Permissions", "Grant access for accurate tracking", Icons.Default.Security, HealthGraphColors.Accent),
        OnboardingStep("Goals", "Set your personal health targets", Icons.Default.Flag, HealthGraphColors.Success),
        OnboardingStep("Ready", "All set! Let's begin", Icons.Default.CheckCircle, HealthGraphColors.Primary),
    )

    Box(
        modifier = modifier
            .fillMaxSize()
            .liquidGlass(cornerRadius = 0.dp, elevation = 0.dp, tint = Color.Transparent, timeMs = state.timeMs)
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // Progress indicator
            Row(
                modifier = Modifier.fillMaxWidth().padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                steps.indices.forEach { index ->
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .height(4.dp)
                            .background(
                                if (index <= currentStep) steps[index].color 
                                else HealthGraphColors.SurfaceVariant.copy(alpha = 0.3f)
                            )
                            .clip(androidx.compose.foundation.shape.RoundedCornerShape(2.dp))
                    )
                }
            }

            // Step content
            val step = steps[currentStep]
            GlassCardElevated(tint = step.color.copy(alpha = 0.15f)) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(32.dp),
                    verticalArrangement = Arrangement.spacedBy(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Box(
                        modifier = Modifier
                            .size(120.dp)
                            .liquidGlass(GlassCorner.Full, GlassElevation.Level2, step.color.copy(alpha = 0.2f))
                            .clip(androidx.compose.foundation.shape.CircleShape)
                    ) {
                        Icon(
                            imageVector = step.icon,
                            contentDescription = null,
                            modifier = Modifier.align(Alignment.Center).size(48.dp),
                            tint = step.color
                        )
                    }

                    Text(step.title, style = HealthGraphTypography.HeadlineLarge, textAlign = TextAlign.Center)
                    Text(step.description, style = HealthGraphTypography.BodyLarge.copy(color = HealthGraphColors.OnSurfaceVariant), textAlign = TextAlign.Center)

                    // Action buttons
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        if (currentStep > 0) {
                            LiquidButton(
                                onClick = { currentStep-- },
                                label = "Back",
                                variant = LiquidButtonVariant.OUTLINE,
                                size = LiquidButtonSize.LARGE,
                                modifier = Modifier.weight(1f)
                            )
                        }
                        
                        LiquidButton(
                            onClick = { 
                                if (currentStep < steps.lastIndex) currentStep++ else onComplete() 
                            },
                            label = if (currentStep < steps.lastIndex) "Next" else "Get Started",
                            variant = LiquidButtonVariant.FILLED,
                            size = LiquidButtonSize.LARGE,
                            modifier = Modifier.weight(1f)
                        )
                    }
                }
            }
        }
    }
}

data class OnboardingStep(
    val title: String,
    val description: String,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
    val color: Color
)

@OptIn(ExperimentalComposeUiApi::class)
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