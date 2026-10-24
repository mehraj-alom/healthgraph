package com.healthgraph.shared.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.healthgraph.shared.theme.GlassCorner
import com.healthgraph.shared.theme.GlassElevation
import com.healthgraph.shared.theme.HealthGraphColors
import com.healthgraph.shared.theme.HealthGraphTypography
import com.healthgraph.shared.theme.interactiveGlass
import com.healthgraph.shared.theme.liquidGlass
import com.healthgraph.shared.theme.rememberGlassAnimationState

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun GlassCard(
    modifier: Modifier = Modifier,
    cornerRadius: androidx.compose.ui.unit.Dp = GlassCorner.MD,
    elevation: androidx.compose.ui.unit.Dp = GlassElevation.Level2,
    tint: Color = HealthGraphColors.RefractionTint,
    padding: PaddingValues = PaddingValues(16.dp),
    onClick: (() -> Unit)? = null,
    enabled: Boolean = true,
    content: @Composable () -> Unit
) {
    val state = rememberGlassAnimationState()
    
    Box(
        modifier = modifier
            .interactiveGlass(
                cornerRadius = cornerRadius,
                elevation = elevation,
                tint = tint,
                onClick = onClick,
                enabled = enabled
            )
            .padding(padding)
    ) {
        content()
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun GlassCardElevated(
    modifier: Modifier = Modifier,
    cornerRadius: androidx.compose.ui.unit.Dp = GlassCorner.LG,
    elevation: androidx.compose.ui.unit.Dp = GlassElevation.Level3,
    tint: Color = HealthGraphColors.RefractionTintCool,
    padding: PaddingValues = PaddingValues(20.dp),
    content: @Composable () -> Unit
) {
    GlassCard(
        modifier = modifier,
        cornerRadius = cornerRadius,
        elevation = elevation,
        tint = tint,
        padding = padding,
        content = content
    )
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun GlassCardSectioned(
    modifier: Modifier = Modifier,
    cornerRadius: androidx.compose.ui.unit.Dp = GlassCorner.MD,
    elevation: androidx.compose.ui.unit.Dp = GlassElevation.Level1,
    tint: Color = HealthGraphColors.RefractionTint,
    header: @Composable (() -> Unit)? = null,
    footer: @Composable (() -> Unit)? = null,
    content: @Composable () -> Unit
) {
    val state = rememberGlassAnimationState()
    
    Box(
        modifier = modifier
            .liquidGlass(
                cornerRadius = cornerRadius,
                elevation = elevation,
                tint = tint,
                timeMs = state.timeMs
            )
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(0.dp)
        ) {
            header?.let {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp)
                        .clip(RoundedCornerShape(topStart = cornerRadius, topEnd = cornerRadius))
                ) {
                    it()
                }
            }
            
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp)
                    .weight(1f)
            ) {
                content()
            }
            
            footer?.let {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp)
                        .clip(RoundedCornerShape(bottomStart = cornerRadius, bottomEnd = cornerRadius))
                ) {
                    it()
                }
            }
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun GlassCardMedia(
    modifier: Modifier = Modifier,
    cornerRadius: androidx.compose.ui.unit.Dp = GlassCorner.LG,
    elevation: androidx.compose.ui.unit.Dp = GlassElevation.Level3,
    tint: Color = HealthGraphColors.RefractionTint,
    imageUrl: String? = null,
    imagePainter: androidx.compose.ui.graphics.painter.Painter? = null,
    contentDescription: String? = null,
    aspectRatio: Float = 16f / 9f,
    title: String? = null,
    subtitle: String? = null,
    action: @Composable (() -> Unit)? = null
) {
    val state = rememberGlassAnimationState()
    
    Box(
        modifier = modifier
            .liquidGlass(
                cornerRadius = cornerRadius,
                elevation = elevation,
                tint = tint,
                timeMs = state.timeMs
            )
            .aspectRatio(aspectRatio)
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            if (imagePainter != null) {
                androidx.compose.foundation.Image(
                    painter = imagePainter,
                    contentDescription = contentDescription ?? "",
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize()
                )
            } else if (imageUrl != null) {
                androidx.compose.foundation.Image(
                    painter = androidx.compose.foundation.rememberImagePainter(imageUrl),
                    contentDescription = contentDescription ?? "",
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize()
                )
            } else {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .liquidGlass(cornerRadius = 0.dp, elevation = 0.dp, tint = Color.Transparent)
                ) {
                    Icon(
                        androidx.compose.material.icons.Icons.Default.Image,
                        contentDescription = contentDescription ?? "",
                        tint = HealthGraphColors.OnSurfaceMuted,
                        modifier = Modifier.size(48.dp).align(Alignment.Center)
                    )
                }
            }
            
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        brush = androidx.compose.ui.graphics.Brush.verticalGradient(
                            colors = listOf(
                                HealthGraphColors.Transparent,
                                HealthGraphColors.Background.copy(alpha = 0.7f),
                                HealthGraphColors.Background.copy(alpha = 0.9f)
                            )
                        )
                    )
                    .padding(16.dp),
                contentAlignment = Alignment.BottomStart
            ) {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    title?.let {
                        Text(
                            text = it,
                            style = HealthGraphTypography.TitleLarge.copy(color = HealthGraphColors.OnBackground),
                            maxLines = 2,
                            overflow = androidx.compose.ui.text.TextOverflow.Ellipsis
                        )
                    }
                    subtitle?.let {
                        Text(
                            text = it,
                            style = HealthGraphTypography.BodyMedium.copy(color = HealthGraphColors.OnSurfaceVariant),
                            maxLines = 1,
                            overflow = androidx.compose.ui.text.TextOverflow.Ellipsis
                        )
                    }
                    action?.let {
                        Box(modifier = Modifier.padding(top = 8.dp)) {
                            it()
                        }
                    }
                }
            }
        }
    }
}