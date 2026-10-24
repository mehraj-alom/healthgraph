package com.healthgraph.app

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp
import com.adamkobus.voyager.Voyager
import com.adamkobus.voyager.rememberVoyager
import com.healthgraph.shared.navigation.AppNavHost
import com.healthgraph.shared.navigation.BottomNavigationBar
import com.healthgraph.shared.theme.GlassElevation
import com.healthgraph.shared.theme.GlassCorner
import com.healthgraph.shared.theme.HealthGraphColors
import com.healthgraph.shared.theme.HealthGraphTypography
import com.healthgraph.shared.theme.liquidGlass
import com.healthgraph.shared.ui.components.LiquidButton
import com.healthgraph.shared.ui.components.LiquidButtonVariant
import com.healthgraph.shared.ui.components.LiquidButtonSize

@Composable
fun App() {
    MaterialTheme {
        val voyager = rememberVoyager()
        val state = remember { com.healthgraph.shared.theme.rememberGlassAnimationState() }
        
        Surface(
            modifier = Modifier
                .fillMaxSize()
                .liquidGlass(
                    cornerRadius = 0.dp,
                    elevation = 0.dp,
                    tint = Color.Transparent,
                    timeMs = state.timeMs
                ),
            color = HealthGraphColors.Background
        ) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.BottomCenter
            ) {
                AppNavHost(voyager)
                
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 16.dp)
                        .liquidGlass(
                            cornerRadius = GlassCorner.XL,
                            elevation = GlassElevation.Level3,
                            tint = HealthGraphColors.RefractionTint
                        )
                        .clip(androidx.compose.foundation.shape.RoundedCornerShape(topStart = GlassCorner.XL, topEnd = GlassCorner.XL))
                ) {
                    BottomNavigationBar(voyager)
                }
            }
        }
    }
}

@Composable
fun PreviewApp() {
    App()
}