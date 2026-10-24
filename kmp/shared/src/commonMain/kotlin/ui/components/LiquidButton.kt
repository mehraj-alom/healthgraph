package com.healthgraph.shared.ui.components

import androidx.compose.animation.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
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
import androidx.compose.ui.graphics.Shader
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.awaitPointerEventScope
import androidx.compose.ui.input.pointer.awaitFirstDown
import androidx.compose.ui.input.pointer.awaitRelease
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.Dp
import com.healthgraph.shared.theme.GlassCorner
import com.healthgraph.shared.theme.GlassElevation
import com.healthgraph.shared.theme.HealthGraphColors
import com.healthgraph.shared.theme.HealthGraphTypography
import com.healthgraph.shared.theme.interactiveGlass
import com.healthgraph.shared.theme.liquidGlass
import com.healthgraph.shared.theme.rememberGlassAnimationState

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
enum class LiquidButtonVariant {
    PRIMARY(HealthGraphColors.Primary, HealthGraphColors.PrimaryOn, HealthGraphColors.RefractionTint),
    SECONDARY(HealthGraphColors.Secondary, HealthGraphColors.SecondaryOn, HealthGraphColors.RefractionTintWarm),
    ACCENT(HealthGraphColors.Accent, HealthGraphColors.AccentOn, HealthGraphColors.RefractionTintCool),
    OUTLINE(HealthGraphColors.Transparent, HealthGraphColors.Primary, HealthGraphColors.RefractionTint),
    GHOST(HealthGraphColors.Transparent, HealthGraphColors.OnSurface, HealthGraphColors.RefractionTint);

    val backgroundColor: Color
    val contentColor: Color
    val refractionTint: Color

    constructor(backgroundColor: Color, contentColor: Color, refractionTint: Color) {
        this.backgroundColor = backgroundColor
        this.contentColor = contentColor
        this.refractionTint = refractionTint
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
enum class LiquidButtonSize {
    SMALL(36.dp, 12.sp, GlassCorner.SM, 8.dp),
    MEDIUM(48.dp, 14.sp, GlassCorner.MD, 12.dp),
    LARGE(56.dp, 16.sp, GlassCorner.LG, 16.dp),
    FULL_WIDTH(56.dp, 16.sp, GlassCorner.LG, 16.dp);

    val height: Dp
    val fontSize: Dp
    val cornerRadius: Dp
    val horizontalPadding: Dp

    constructor(height: Dp, fontSize: Dp, cornerRadius: Dp, horizontalPadding: Dp) {
        this.height = height
        this.fontSize = fontSize
        this.cornerRadius = cornerRadius
        this.horizontalPadding = horizontalPadding
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun LiquidButton(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: LiquidButtonVariant = LiquidButtonVariant.PRIMARY,
    size: LiquidButtonSize = LiquidButtonSize.MEDIUM,
    enabled: Boolean = true,
    leadingIcon: (@Composable () -> Unit)? = null,
    trailingIcon: (@Composable () -> Unit)? = null,
    label: String? = null,
    labelStyle: androidx.compose.ui.text.TextStyle = HealthGraphTypography.LabelLarge,
    isLoading: Boolean = false,
    loadingLabel: String = "",
    onLongClick: (() -> Unit)? = null
) {
    val state = rememberGlassAnimationState()
    val (pressProgress, hoverProgress) = remember { mutableStateOf(0f) to mutableStateOf(0f) }
    val scale = animateFloatAsState(
        targetValue = if (pressProgress > 0.5f) 0.96f else 1f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessHigh)
    )
    val borderAlpha = animateFloatAsState(
        targetValue = if (hoverProgress > 0.5f) 1f else 0.5f,
        animationSpec = tween(200)
    )

    val buttonModifier = modifier
        .interactiveGlass(
            cornerRadius = size.cornerRadius,
            elevation = GlassElevation.Level2 + (pressProgress * 4).dp,
            tint = variant.refractionTint,
            onClick = if (enabled && !isLoading) onClick else null,
            enabled = enabled && !isLoading
        )
        .height(size.height)
        .graphicsLayer {
            scaleX = scale.value
            scaleY = scale.value
        }
        .pointerInput(Unit) {
            awaitPointerEventScope {
                if (enabled && !isLoading) {
                    awaitFirstDown()
                    pressProgress = 1f
                    awaitRelease()
                    pressProgress = 0f
                }
            }
        }

    val contentModifier = when (size) {
        LiquidButtonSize.FULL_WIDTH -> Modifier.fillMaxWidth()
        else -> Modifier.padding(horizontal = size.horizontalPadding)
    }

    Box(
        modifier = buttonModifier.then(contentModifier),
        contentAlignment = Alignment.Center
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = size.horizontalPadding),
            horizontalArrangement = if (leadingIcon != null || trailingIcon != null)
                Arrangement.SpaceBetween
            else
                Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically
        ) {
            leadingIcon?.let {
                Box(
                    modifier = Modifier
                        .size(size.height * 0.5)
                        .padding(end = 8.dp),
                    contentAlignment = Alignment.Center
                ) {
                    it()
                }
            }

            Box(modifier = Modifier.weight(1f)) {
                Text(
                    text = if (isLoading) loadingLabel else (label ?: ""),
                    style = labelStyle.copy(
                        fontSize = size.fontSize,
                        fontWeight = FontWeight.SemiBold,
                        color = variant.contentColor,
                        textAlign = TextAlign.Center
                    ),
                    maxLines = 1,
                    overflow = androidx.compose.ui.text.TextOverflow.Ellipsis
                )
            }

            trailingIcon?.let {
                Box(
                    modifier = Modifier
                        .size(size.height * 0.5)
                        .padding(start = 8.dp),
                    contentAlignment = Alignment.Center
                ) {
                    it()
                }
            }

            if (isLoading) {
                Box(
                    modifier = Modifier
                        .size(size.height * 0.5)
                        .padding(start = 8.dp),
                    contentAlignment = Alignment.Center
                ) {
                    androidx.compose.material.icons.Icons.Default.Refresh
                }
            }
        }

        if (variant == LiquidButtonVariant.OUTLINE) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .clip(RoundedCornerShape(size.cornerRadius))
                    .border(
                        width = 1.5.dp,
                        brush = androidx.compose.ui.graphics.Brush.horizontalGradient(
                            colors = listOf(
                                variant.backgroundColor.copy(alpha = borderAlpha.value),
                                variant.contentColor.copy(alpha = borderAlpha.value)
                            )
                        ),
                        shape = RoundedCornerShape(size.cornerRadius)
                    )
            ) {}
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun LiquidButtonIcon(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: LiquidButtonVariant = LiquidButtonVariant.PRIMARY,
    size: LiquidButtonSize = LiquidButtonSize.MEDIUM,
    enabled: Boolean = true,
    icon: @Composable () -> Unit,
    contentDescription: String,
    onLongClick: (() -> Unit)? = null
) {
    val state = rememberGlassAnimationState()
    
    Box(
        modifier = modifier
            .interactiveGlass(
                cornerRadius = size.cornerRadius,
                elevation = GlassElevation.Level2,
                tint = variant.refractionTint,
                onClick = if (enabled) onClick else null,
                enabled = enabled
            )
            .size(size.height)
            .clip(RoundedCornerShape(size.cornerRadius))
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(size.horizontalPadding)
                .align(Alignment.Center),
            contentAlignment = Alignment.Center
        ) {
            icon()
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun LiquidButtonToggle(
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    variant: LiquidButtonVariant = LiquidButtonVariant.PRIMARY,
    size: LiquidButtonSize = LiquidButtonSize.MEDIUM,
    enabled: Boolean = true,
    label: String? = null,
    leadingIcon: (@Composable () -> Unit)? = null,
    trailingIcon: (@Composable () -> Unit)? = null
) {
    val state = rememberGlassAnimationState()
    val effectiveVariant = if (checked) variant else LiquidButtonVariant.GHOST
    
    LiquidButton(
        onClick = { onCheckedChange(!checked) },
        modifier = modifier,
        variant = effectiveVariant,
        size = size,
        enabled = enabled,
        leadingIcon = leadingIcon,
        trailingIcon = trailingIcon,
        label = label
    )
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun LiquidButtonSegmented(
    options: List<String>,
    selectedIndex: Int,
    onSelectedChange: (Int) -> Unit,
    modifier: Modifier = Modifier,
    variant: LiquidButtonVariant = LiquidButtonVariant.PRIMARY,
    size: LiquidButtonSize = LiquidButtonSize.SMALL,
    enabled: Boolean = true
) {
    val state = rememberGlassAnimationState()
    
    Box(
        modifier = modifier
            .liquidGlass(
                cornerRadius = GlassCorner.LG,
                elevation = GlassElevation.Level1,
                tint = HealthGraphColors.RefractionTint,
                timeMs = state.timeMs
            )
            .clip(RoundedCornerShape(GlassCorner.LG))
            .padding(4.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            options.forEachIndexed { index, option ->
                val isSelected = index == selectedIndex
                val buttonVariant = if (isSelected) variant else LiquidButtonVariant.GHOST
                
                LiquidButton(
                    onClick = { onSelectedChange(index) },
                    variant = buttonVariant,
                    size = size.copy(horizontalPadding = 16.dp),
                    enabled = enabled,
                    label = option
                )
            }
        }
    }
}