package com.healthgraph.shared.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

object HealthGraphColors {

    val Background = Color(0xFF0A0A0F)
    val Surface = Color(0xFF12121A)
    val SurfaceElevated = Color(0xFF1A1A24)
    val SurfaceOverlay = Color(0xFF1E1E2A)

    val Primary = Color(0xFF00D4AA)
    val PrimaryVariant = Color(0xFF00B894)
    val PrimaryOn = Color(0xFF0A0A0F)

    val Secondary = Color(0xFFFF6B6B)
    val SecondaryVariant = Color(0xFFFF4757)
    val SecondaryOn = Color(0xFFFFFFFF)

    val Accent = Color(0xFF7C5CFF)
    val AccentVariant = Color(0xFF6A4DFF)
    val AccentOn = Color(0xFFFFFFFF)

    val Success = Color(0xFF00D4AA)
    val Warning = Color(0xFFFFA502)
    val Error = Color(0xFFFF4757)
    val Info = Color(0xFF7C5CFF)

    val OnBackground = Color(0xFFFFFFFF)
    val OnSurface = Color(0xFFE8E8F0)
    val OnSurfaceVariant = Color(0xFF9A9AB8)
    val OnSurfaceMuted = Color(0xFF6A6A8A)

    val Outline = Color(0xFF2A2A3A)
    val OutlineVariant = Color(0xFF3A3A4A)

    val GlassSurface = Color(0x1AFFFFFF)
    val GlassSurfaceElevated = Color(0x2AFFFFFF)
    val GlassStroke = Color(0x33FFFFFF)
    val GlassStrokeStrong = Color(0x4DFFFFFF)

    val GlassHighlight = Color(0x33FFFFFF)
    val GlassHighlightStrong = Color(0x4DFFFFFF)
    val GlassShadow = Color(0x1A000000)
    val GlassShadowStrong = Color(0x33000000)

    val SpecularLight = Color(0x4DFFFFFF)
    val SpecularLightStrong = Color(0x66FFFFFF)

    val RefractionTint = Color(0x0D00D4AA)
    val RefractionTintWarm = Color(0x0DFF6B6B)
    val RefractionTintCool = Color(0x0D7C5CFF)

    val Scrim = Color(0x99000000)

    val Transparent = Color.Transparent
}

object GlassElevation {
    val Level0 = 0.dp
    val Level1 = 4.dp
    val Level2 = 8.dp
    val Level3 = 16.dp
    val Level4 = 24.dp
    val Level5 = 32.dp
}

object GlassCorner {
    val XS = 8.dp
    val SM = 12.dp
    val MD = 16.dp
    val LG = 24.dp
    val XL = 32.dp
    val Full = 9999.dp
    val Squircle = 0.618f
}