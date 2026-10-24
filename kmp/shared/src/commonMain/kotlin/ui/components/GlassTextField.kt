package com.healthgraph.shared.ui.components

import androidx.compose.animation.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.KeyboardType
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardAction
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shader
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.awaitPointerEventScope
import androidx.compose.ui.input.pointer.awaitFirstDown
import androidx.compose.ui.input.pointer.awaitRelease
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.input.VisualTransformation
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
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.TextFieldState
import androidx.compose.foundation.text.rememberTextFieldState
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TextInputService
import androidx.compose.ui.text.input.TextInputSession
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.input.VisualTransformation

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
enum class GlassTextFieldVariant {
    OUTLINED,
    FILLED,
    GLASS
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun GlassTextField(
    modifier: Modifier = Modifier,
    value: String,
    onValueChange: (String) -> Unit,
    label: String? = null,
    placeholder: String? = null,
    leadingIcon: (@Composable () -> Unit)? = null,
    trailingIcon: (@Composable () -> Unit)? = null,
    isError: Boolean = false,
    errorMessage: String? = null,
    helperText: String? = null,
    variant: GlassTextFieldVariant = GlassTextFieldVariant.GLASS,
    keyboardOptions: KeyboardOptions = KeyboardOptions.Default,
    keyboardActions: KeyboardActions = KeyboardActions(),
    enabled: Boolean = true,
    readOnly: Boolean = false,
    singleLine: Boolean = true,
    maxLines: Int = 1,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    textStyle: TextStyle = HealthGraphTypography.BodyLarge,
    labelStyle: TextStyle = HealthGraphTypography.LabelSmall,
    placeholderStyle: TextStyle = HealthGraphTypography.BodyLarge.copy(color = HealthGraphColors.OnSurfaceMuted),
    helperStyle: TextStyle = HealthGraphTypography.Caption,
    errorStyle: TextStyle = HealthGraphTypography.Caption.copy(color = HealthGraphColors.Error),
    onFocusChange: ((Boolean) -> Unit)? = null,
    onImeActionPerformed: ((ImeAction, TextFieldState) -> Unit)? = null,
    onKeyboardAction: ((ImeAction) -> Unit)? = null
) {
    val state = rememberGlassAnimationState()
    val textFieldState = rememberTextFieldState(value)
    val (focused, isHovered) = remember { mutableStateOf(false) to mutableStateOf(false) }
    val (focusProgress, hoverProgress, errorProgress) = remember {
        mutableStateOf(0f) to mutableStateOf(0f) to mutableStateOf(0f)
    }
    val keyboardController = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current

    val focusedColor = when {
        isError -> HealthGraphColors.Error
        focused -> HealthGraphColors.Primary
        else -> HealthGraphColors.OnSurfaceVariant
    }

    val borderAlpha = animateFloatAsState(
        targetValue = when {
            isError -> 1f
            focused -> 1f
            isHovered -> 0.7f
            else -> 0.4f
        },
        animationSpec = tween(200)
    )

    val labelProgress = animateFloatAsState(
        targetValue = if (value.isNotBlank() || focused) 1f else 0f,
        animationSpec = tween(150)
    )

    val backgroundColor = when (variant) {
        GlassTextFieldVariant.OUTLINED -> HealthGraphColors.Surface.copy(alpha = if (focused) 1f else 0.5f)
        GlassTextFieldVariant.FILLED -> HealthGraphColors.SurfaceElevated.copy(alpha = if (focused) 1f else 0.7f)
        GlassTextFieldVariant.GLASS -> HealthGraphColors.GlassSurface
    }

    val contentModifier = Modifier
        .fillMaxWidth()
        .padding(horizontal = 16.dp, vertical = 12.dp)

    Box(
        modifier = modifier
            .liquidGlass(
                cornerRadius = GlassCorner.MD,
                elevation = GlassElevation.Level1 + (focusProgress * 4).dp,
                tint = if (isError) HealthGraphColors.RefractionTintWarm else HealthGraphColors.RefractionTint,
                timeMs = state.timeMs
            )
            .clip(RoundedCornerShape(GlassCorner.MD))
            .fillMaxWidth()
            .pointerInput(Unit) {
                awaitPointerEventScope {
                    if (enabled && !readOnly) {
                        awaitFirstDown()
                        hoverProgress = 1f
                        if (!focused) {
                            keyboardController?.show()
                        }
                        awaitRelease()
                        hoverProgress = 0f
                    }
                }
            }
            .onFocusChanged { focusState ->
                focused = focusState.isFocused
                focusProgress = if (focusState.isFocused) 1f else 0f
                onFocusChange?.invoke(focusState.isFocused)
            }
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            Box(
                modifier = Modifier.fillMaxWidth(),
                contentAlignment = Alignment.CenterStart
            ) {
                Row(
                    modifier = contentModifier,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    leadingIcon?.let {
                        Box(
                            modifier = Modifier
                                .size(24.dp)
                                .padding(end = 12.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            it()
                        }
                    }

                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxWidth()
                            .padding(top = if (label != null) 8.dp else 0.dp, bottom = if (label != null) 0.dp else 0.dp),
                        verticalArrangement = Arrangement.spacedBy(0.dp)
                    ) {
                        if (label != null) {
                            AnimatedLabel(
                                label = label,
                                progress = labelProgress.value,
                                style = labelStyle.copy(color = focusedColor),
                                placeholderStyle = placeholderStyle
                            )
                        }

                        BasicTextField(
                            state = textFieldState,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(if (singleLine) 24.dp else (maxLines * 24).dp),
                            keyboardOptions = keyboardOptions,
                            keyboardActions = keyboardActions,
                            enabled = enabled,
                            readOnly = readOnly,
                            singleLine = singleLine,
                            maxLines = maxLines,
                            visualTransformation = visualTransformation,
                            textStyle = textStyle.copy(color = HealthGraphColors.OnBackground),
                            onValueChange = onValueChange,
                            onImeActionPerformed = onImeActionPerformed
                        )
                    }

                    trailingIcon?.let {
                        Box(
                            modifier = Modifier
                                .size(24.dp)
                                .padding(start = 12.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            it()
                        }
                    }
                }
            }

            if (isError && errorMessage != null) {
                Text(
                    text = errorMessage,
                    style = errorStyle,
                    modifier = Modifier.padding(start = 16.dp, end = 16.dp)
                )
            } else if (helperText != null && !isError) {
                Text(
                    text = helperText,
                    style = helperStyle.copy(color = HealthGraphColors.OnSurfaceMuted),
                    modifier = Modifier.padding(start = 16.dp, end = 16.dp)
                )
            }
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun AnimatedLabel(
    label: String,
    progress: Float,
    style: TextStyle,
    placeholderStyle: TextStyle
) {
    val opacity = progress
    val scale = 1f - (progress * 0.25f)
    val translateY = -8.dp * progress

    Text(
        text = label,
        style = style.copy(
            fontSize = (placeholderStyle.fontSize!!.value * scale).sp,
            color = style.color?.copy(alpha = opacity) ?: HealthGraphColors.OnSurfaceVariant.copy(alpha = opacity)
        ),
        modifier = Modifier
            .padding(start = 16.dp, top = translateY)
            .graphicsLayer {
                translationY = translateY.value
                scaleX = scale
                scaleY = scale
                transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0f, 0f)
            }
    )
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun GlassTextFieldSecure(
    modifier: Modifier = Modifier,
    value: String,
    onValueChange: (String) -> Unit,
    label: String? = null,
    placeholder: String = "Password",
    variant: GlassTextFieldVariant = GlassTextFieldVariant.GLASS,
    enabled: Boolean = true,
    onFocusChange: ((Boolean) -> Unit)? = null,
    onImeActionPerformed: ((ImeAction, TextFieldState) -> Unit)? = null
) {
    var showPassword by remember { mutableStateOf(false) }
    val visualTransformation = remember { if (showPassword) VisualTransformation.None else PasswordVisualTransformation() }
    val trailingIcon = {
        Icon(
            imageVector = if (showPassword) 
                androidx.compose.material.icons.Icons.Default.VisibilityOff 
            else 
                androidx.compose.material.icons.Icons.Default.Visibility,
            contentDescription = if (showPassword) "Hide password" else "Show password",
            tint = HealthGraphColors.OnSurfaceVariant,
            modifier = Modifier
                .size(24.dp)
                .fillMaxHeight()
                .pointerInput(Unit) {
                    awaitPointerEventScope {
                        awaitFirstDown()
                        showPassword = true
                        awaitRelease()
                        showPassword = false
                    }
                }
        )
    }

    GlassTextField(
        modifier = modifier,
        value = value,
        onValueChange = onValueChange,
        label = label,
        placeholder = placeholder,
        trailingIcon = trailingIcon,
        variant = variant,
        enabled = enabled,
        visualTransformation = visualTransformation,
        keyboardOptions = KeyboardOptions.Default.copy(keyboardType = KeyboardType.Password),
        onFocusChange = onFocusChange,
        onImeActionPerformed = onImeActionPerformed
    )
}

class PasswordVisualTransformation : VisualTransformation {
    override fun filter(text: AnnotatedString): AnnotatedString {
        return AnnotatedString("●".repeat(text.length))
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun GlassTextFieldSearch(
    modifier: Modifier = Modifier,
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String = "Search...",
    onSearch: (() -> Unit)? = null,
    onClear: (() -> Unit)? = null,
    enabled: Boolean = true
) {
    val state = rememberGlassAnimationState()
    
    val leadingIcon = {
        Icon(
            imageVector = androidx.compose.material.icons.Icons.Default.Search,
            contentDescription = "Search",
            tint = HealthGraphColors.OnSurfaceMuted,
            modifier = Modifier.size(24.dp)
        )
    }
    
    val trailingIcon = if (value.isNotBlank()) {
        {
            Icon(
                imageVector = androidx.compose.material.icons.Icons.Default.Close,
                contentDescription = "Clear",
                tint = HealthGraphColors.OnSurfaceVariant,
                modifier = Modifier
                    .size(24.dp)
                    .fillMaxHeight()
                    .pointerInput(Unit) {
                        awaitPointerEventScope {
                            awaitFirstDown()
                            onClear?.invoke()
                            awaitRelease()
                        }
                    }
            )
        }
    } else null

    GlassTextField(
        modifier = modifier,
        value = value,
        onValueChange = onValueChange,
        placeholder = placeholder,
        leadingIcon = leadingIcon,
        trailingIcon = trailingIcon,
        variant = GlassTextFieldVariant.GLASS,
        enabled = enabled,
        singleLine = true,
        keyboardOptions = KeyboardOptions.Default.copy(
            keyboardType = KeyboardType.Text,
            imeAction = ImeAction.Search
        ),
        keyboardActions = KeyboardActions(
            onSearch = { onSearch?.invoke(); keyboardController?.hide() }
        )
    )
}