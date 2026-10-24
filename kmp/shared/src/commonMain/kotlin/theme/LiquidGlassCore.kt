package com.healthgraph.shared.theme

import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.shader.Shader
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

object LiquidGlassShaders {

    @OptIn(ExperimentalComposeUiApi::class)
    fun glassSurfaceShader(
        bounds: Rect,
        cornerRadius: Dp,
        elevation: Dp,
        tint: Color = HealthGraphColors.RefractionTint,
        timeMs: Float = 0f
    ): Shader {
        val agsl = """
            uniform half2 resolution;
            uniform half2 cornerRadius;
            uniform half elevation;
            uniform half4 tint;
            uniform half time;

            half4 main(float2 fragCoord) {
                float2 uv = fragCoord / resolution;
                float2 center = float2(0.5, 0.5);
                
                float dist = length(uv - center);
                float radius = min(resolution.x, resolution.y) * 0.5 - cornerRadius.x;
                
                float edge = smoothstep(radius - 2.0, radius + 2.0, dist);
                
                float3 specular = float3(0.0);
                float3 lightDir = normalize(float3(
                    cos(time * 0.001) * 0.707,
                    sin(time * 0.001) * 0.707,
                    0.707
                ));
                float3 viewDir = float3(0.0, 0.0, 1.0);
                float3 halfDir = normalize(lightDir + viewDir);
                float NdotH = max(dot(float3(0.0, 0.0, 1.0), halfDir), 0.0);
                specular = pow(NdotH, 128.0) * float3(1.0, 1.0, 1.0) * elevation * 0.5;
                
                float3 refraction = tint.rgb * (1.0 - uv.y) * 0.15;
                
                float3 color = mix(
                    float3(0.0, 0.0, 0.0),
                    refraction + specular,
                    1.0 - edge
                );
                
                float alpha = mix(0.15, 0.05, uv.y) * (1.0 - edge) + edge * 0.02;
                
                return half4(color, alpha);
            }
        """
        return RuntimeShader(agsl).apply {
            setFloatUniform("resolution", bounds.width.toFloat(), bounds.height.toFloat())
            setFloatUniform("cornerRadius", cornerRadius.value, cornerRadius.value)
            setFloatUniform("elevation", elevation.value)
            setFloatUniform("tint", tint.red, tint.green, tint.blue, tint.alpha)
            setFloatUniform("time", timeMs)
        }
    }

    @OptIn(ExperimentalComposeUiApi::class)
    fun glassHighlightShader(
        bounds: Rect,
        cornerRadius: Dp,
        angleDegrees: Float = 45f,
        intensity: Float = 1.0f
    ): Shader {
        val agsl = """
            uniform half2 resolution;
            uniform half2 cornerRadius;
            uniform half angle;
            uniform half intensity;

            half4 main(float2 fragCoord) {
                float2 uv = fragCoord / resolution;
                float angleRad = radians(angle);
                float2 lightVec = normalize(float2(cos(angleRad), sin(angleRad)));
                float highlight = max(dot(uv - 0.5, lightVec), 0.0);
                highlight = pow(highlight, 8.0) * intensity;
                
                float2 center = float2(0.5, 0.5);
                float dist = length(uv - center);
                float radius = min(resolution.x, resolution.y) * 0.5 - cornerRadius.x;
                float edge = smoothstep(radius - 4.0, radius + 4.0, dist);
                
                float alpha = highlight * (1.0 - edge) * 0.3;
                
                return half4(1.0, 1.0, 1.0, alpha);
            }
        """
        return RuntimeShader(agsl).apply {
            setFloatUniform("resolution", bounds.width.toFloat(), bounds.height.toFloat())
            setFloatUniform("cornerRadius", cornerRadius.value, cornerRadius.value)
            setFloatUniform("angle", angleDegrees)
            setFloatUniform("intensity", intensity)
        }
    }

    @OptIn(ExperimentalComposeUiApi::class)
    fun glassRefractionShader(
        bounds: Rect,
        cornerRadius: Dp,
        backgroundTexture: Shader? = null,
        distortionStrength: Float = 0.02f
    ): Shader {
        val agsl = """
            uniform half2 resolution;
            uniform half2 cornerRadius;
            uniform half distortion;
            uniform shader background;

            half4 main(float2 fragCoord) {
                float2 uv = fragCoord / resolution;
                float2 center = float2(0.5, 0.5);
                float dist = length(uv - center);
                float radius = min(resolution.x, resolution.y) * 0.5 - cornerRadius.x;
                
                float edge = smoothstep(radius - 2.0, radius + 2.0, dist);
                float2 normal = normalize(uv - center);
                float2 offset = normal * distortion * (1.0 - edge) * 10.0;
                float2 sampleUv = clamp(uv + offset, 0.0, 1.0);
                
                half4 bg = background.eval(sampleUv * resolution);
                half4 color = bg * (1.0 - edge) + half4(0.0, 0.0, 0.0, 0.0) * edge;
                
                return color;
            }
        """
        val shader = RuntimeShader(agsl).apply {
            setFloatUniform("resolution", bounds.width.toFloat(), bounds.height.toFloat())
            setFloatUniform("cornerRadius", cornerRadius.value, cornerRadius.value)
            setFloatUniform("distortion", distortionStrength)
        }
        backgroundTexture?.let { shader.setInputShader("background", it) }
        return shader
    }
}

@OptIn(ExperimentalComposeUiApi::class)
fun Modifier.liquidGlass(
    cornerRadius: Dp = GlassCorner.MD,
    elevation: Dp = GlassElevation.Level2,
    tint: Color = HealthGraphColors.RefractionTint,
    enableHighlight: Boolean = true,
    enableRefraction: Boolean = false,
    backgroundShader: Shader? = null,
    timeMs: Float = 0f
) = this.then(
    Modifier
        .graphicsLayer {
            this.clip = true
            this.shape = RoundRectCornerShape(cornerRadius)
        }
        .drawBehind {
            val bounds = Rect(Offset.Zero, Size(this.size.width.toFloat(), this.size.height.toFloat()))
            val r = cornerRadius

            drawRect(
                brush = Brush.shader(
                    LiquidGlassShaders.glassSurfaceShader(bounds, r, elevation, tint, timeMs)
                ),
                shape = RoundRectCornerShape(r)
            )

            if (enableHighlight) {
                drawRect(
                    brush = Brush.shader(
                        LiquidGlassShaders.glassHighlightShader(bounds, r, 45f, 1.0f)
                    ),
                    shape = RoundRectCornerShape(r)
                )
            }

            if (enableRefraction && backgroundShader != null) {
                drawRect(
                    brush = Brush.shader(
                        LiquidGlassShaders.glassRefractionShader(bounds, r, backgroundShader)
                    ),
                    shape = RoundRectCornerShape(r)
                )
            }
        }
        .border(
            width = 1.dp,
            brush = Brush.horizontalGradient(
                colors = listOf(
                    HealthGraphColors.GlassStroke,
                    HealthGraphColors.GlassStrokeStrong,
                    HealthGraphColors.GlassStroke
                ),
                startX = 0f,
                endX = 1f
            ),
            shape = RoundRectCornerShape(cornerRadius)
        )
        .shadow(elevation.value, RoundRectCornerShape(cornerRadius), HealthGraphColors.GlassShadow)
)

@OptIn(ExperimentalComposeUiApi::class)
fun Modifier.glassCard(
    cornerRadius: Dp = GlassCorner.MD,
    elevation: Dp = GlassElevation.Level2,
    tint: Color = HealthGraphColors.RefractionTint,
    onClick: (() -> Unit)? = null,
    enabled: Boolean = true
) = this
    .liquidGlass(cornerRadius, elevation, tint)
    .fillMaxWidth()
    .clip(RoundRectCornerShape(cornerRadius))
    .combinedClickable(
        onClick = onClick,
        enabled = enabled,
        onLongClick = null
    ) { pressed ->
    }

fun RoundRectCornerShape(cornerRadius: Dp) = androidx.compose.foundation.shape.RoundedCornerShape(cornerRadius)

@OptIn(ExperimentalComposeUiApi::class)
class GlassAnimationState(
    val timeMs: Float = 0f,
    val hoverProgress: Float = 0f,
    val pressProgress: Float = 0f
) {
    companion object {
        val Initial = GlassAnimationState()
    }
}

@OptIn(ExperimentalComposeUiApi::class)
@Composable
fun rememberGlassAnimationState(): GlassAnimationState {
    val timeMs = remember { mutableStateOf(0f) }
    val hoverProgress = remember { mutableStateOf(0f) }
    val pressProgress = remember { mutableStateOf(0f) }

    LaunchedEffect(Unit) {
        val startTime = System.currentTimeMillis()
        while (true) {
            timeMs.value = (System.currentTimeMillis() - startTime).toFloat()
            delay(16)
        }
    }

    return GlassAnimationState(
        timeMs = timeMs.value,
        hoverProgress = hoverProgress.value,
        pressProgress = pressProgress.value
    )
}

@OptIn(ExperimentalComposeUiApi::class)
fun Modifier.interactiveGlass(
    cornerRadius: Dp = GlassCorner.MD,
    elevation: Dp = GlassElevation.Level2,
    tint: Color = HealthGraphColors.RefractionTint,
    onClick: (() -> Unit)? = null,
    enabled: Boolean = true
) = composed(
    factory = {
        val state = rememberGlassAnimationState()
        Modifier
            .liquidGlass(
                cornerRadius = cornerRadius,
                elevation = elevation + (state.pressProgress * 8).dp,
                tint = tint,
                timeMs = state.timeMs
            )
            .fillMaxWidth()
            .clip(RoundRectCornerShape(cornerRadius))
            .combinedClickable(
                onClick = onClick,
                enabled = enabled,
                onLongClick = null,
                onHover = { isHovering ->
                    animateFloatAsState(
                        targetValue = if (isHovering) 1f else 0f,
                        animationSpec = tween(200)
                    ).value.also { state.hoverProgress = it }
                },
                onPress = { isPressed ->
                    animateFloatAsState(
                        targetValue = if (isPressed) 1f else 0f,
                        animationSpec = tween(100)
                    ).value.also { state.pressProgress = it }
                }
            )
    }
)