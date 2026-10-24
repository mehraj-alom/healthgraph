package com.healthgraph.shared.theme

import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp

object HealthGraphTypography {

    val FontFamilyPrimary = FontFamily(
        Font(R.font.poppins_regular, FontWeight.Normal),
        Font(R.font.poppins_medium, FontWeight.Medium),
        Font(R.font.poppins_semibold, FontWeight.SemiBold),
        Font(R.font.poppins_bold, FontWeight.Bold)
    )

    val FontFamilyMono = FontFamily.DefaultMono

    val DisplayLarge = TextStyle(
        fontFamily = FontFamilyPrimary,
        fontWeight = FontWeight.Bold,
        fontSize = 57.sp,
        lineHeight = 64.sp,
        letterSpacing = -0.25.sp,
        textAlign = TextAlign.Start,
        color = HealthGraphColors.OnBackground
    )

    val DisplayMedium = TextStyle(
        fontFamily = FontFamilyPrimary,
        fontWeight = FontWeight.Bold,
        fontSize = 45.sp,
        lineHeight = 52.sp,
        letterSpacing = 0.sp,
        textAlign = TextAlign.Start,
        color = HealthGraphColors.OnBackground
    )

    val DisplaySmall = TextStyle(
        fontFamily = FontFamilyPrimary,
        fontWeight = FontWeight.Bold,
        fontSize = 36.sp,
        lineHeight = 44.sp,
        letterSpacing = 0.sp,
        textAlign = TextAlign.Start,
        color = HealthGraphColors.OnBackground
    )

    val HeadlineLarge = TextStyle(
        fontFamily = FontFamilyPrimary,
        fontWeight = FontWeight.SemiBold,
        fontSize = 32.sp,
        lineHeight = 40.sp,
        letterSpacing = 0.sp,
        textAlign = TextAlign.Start,
        color = HealthGraphColors.OnBackground
    )

    val HeadlineMedium = TextStyle(
        fontFamily = FontFamilyPrimary,
        fontWeight = FontWeight.SemiBold,
        fontSize = 28.sp,
        lineHeight = 36.sp,
        letterSpacing = 0.sp,
        textAlign = TextAlign.Start,
        color = HealthGraphColors.OnBackground
    )

    val HeadlineSmall = TextStyle(
        fontFamily = FontFamilyPrimary,
        fontWeight = FontWeight.SemiBold,
        fontSize = 24.sp,
        lineHeight = 32.sp,
        letterSpacing = 0.sp,
        textAlign = TextAlign.Start,
        color = HealthGraphColors.OnBackground
    )

    val TitleLarge = TextStyle(
        fontFamily = FontFamilyPrimary,
        fontWeight = FontWeight.SemiBold,
        fontSize = 22.sp,
        lineHeight = 28.sp,
        letterSpacing = 0.sp,
        textAlign = TextAlign.Start,
        color = HealthGraphColors.OnBackground
    )

    val TitleMedium = TextStyle(
        fontFamily = FontFamilyPrimary,
        fontWeight = FontWeight.Medium,
        fontSize = 16.sp,
        lineHeight = 24.sp,
        letterSpacing = 0.15.sp,
        textAlign = TextAlign.Start,
        color = HealthGraphColors.OnBackground
    )

    val TitleSmall = TextStyle(
        fontFamily = FontFamilyPrimary,
        fontWeight = FontWeight.Medium,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.1.sp,
        textAlign = TextAlign.Start,
        color = HealthGraphColors.OnBackground
    )

    val BodyLarge = TextStyle(
        fontFamily = FontFamilyPrimary,
        fontWeight = FontWeight.Normal,
        fontSize = 16.sp,
        lineHeight = 24.sp,
        letterSpacing = 0.5.sp,
        textAlign = TextAlign.Start,
        color = HealthGraphColors.OnSurface
    )

    val BodyMedium = TextStyle(
        fontFamily = FontFamilyPrimary,
        fontWeight = FontWeight.Normal,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.25.sp,
        textAlign = TextAlign.Start,
        color = HealthGraphColors.OnSurface
    )

    val BodySmall = TextStyle(
        fontFamily = FontFamilyPrimary,
        fontWeight = FontWeight.Normal,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        letterSpacing = 0.4.sp,
        textAlign = TextAlign.Start,
        color = HealthGraphColors.OnSurfaceVariant
    )

    val LabelLarge = TextStyle(
        fontFamily = FontFamilyPrimary,
        fontWeight = FontWeight.Medium,
        fontSize = 14.sp,
        lineHeight = 20.sp,
        letterSpacing = 0.1.sp,
        textAlign = TextAlign.Start,
        color = HealthGraphColors.OnSurface
    )

    val LabelMedium = TextStyle(
        fontFamily = FontFamilyPrimary,
        fontWeight = FontWeight.Medium,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        letterSpacing = 0.5.sp,
        textAlign = TextAlign.Start,
        color = HealthGraphColors.OnSurfaceVariant
    )

    val LabelSmall = TextStyle(
        fontFamily = FontFamilyPrimary,
        fontWeight = FontWeight.Medium,
        fontSize = 11.sp,
        lineHeight = 16.sp,
        letterSpacing = 0.5.sp,
        textAlign = TextAlign.Start,
        color = HealthGraphColors.OnSurfaceMuted
    )

    val Caption = TextStyle(
        fontFamily = FontFamilyPrimary,
        fontWeight = FontWeight.Normal,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        letterSpacing = 0.4.sp,
        textAlign = TextAlign.Start,
        color = HealthGraphColors.OnSurfaceMuted
    )

    val Overline = TextStyle(
        fontFamily = FontFamilyPrimary,
        fontWeight = FontWeight.Medium,
        fontSize = 10.sp,
        lineHeight = 16.sp,
        letterSpacing = 1.5.sp,
        textAlign = TextAlign.Start,
        color = HealthGraphColors.OnSurfaceMuted
    )

    val NumberDisplay = TextStyle(
        fontFamily = FontFamilyMono,
        fontWeight = FontWeight.Bold,
        fontSize = 48.sp,
        lineHeight = 56.sp,
        letterSpacing = -0.5.sp,
        textAlign = TextAlign.Center,
        color = HealthGraphColors.OnBackground
    )

    val NumberLarge = TextStyle(
        fontFamily = FontFamilyMono,
        fontWeight = FontWeight.SemiBold,
        fontSize = 32.sp,
        lineHeight = 40.sp,
        letterSpacing = -0.25.sp,
        textAlign = TextAlign.Center,
        color = HealthGraphColors.OnBackground
    )

    val NumberMedium = TextStyle(
        fontFamily = FontFamilyMono,
        fontWeight = FontWeight.Medium,
        fontSize = 24.sp,
        lineHeight = 32.sp,
        letterSpacing = 0.sp,
        textAlign = TextAlign.Center,
        color = HealthGraphColors.OnSurface
    )
}

data class GlassTextStyles(
    val displayLarge: TextStyle = HealthGraphTypography.DisplayLarge,
    val displayMedium: TextStyle = HealthGraphTypography.DisplayMedium,
    val displaySmall: TextStyle = HealthGraphTypography.DisplaySmall,
    val headlineLarge: TextStyle = HealthGraphTypography.HeadlineLarge,
    val headlineMedium: TextStyle = HealthGraphTypography.HeadlineMedium,
    val headlineSmall: TextStyle = HealthGraphTypography.HeadlineSmall,
    val titleLarge: TextStyle = HealthGraphTypography.TitleLarge,
    val titleMedium: TextStyle = HealthGraphTypography.TitleMedium,
    val titleSmall: TextStyle = HealthGraphTypography.TitleSmall,
    val bodyLarge: TextStyle = HealthGraphTypography.BodyLarge,
    val bodyMedium: TextStyle = HealthGraphTypography.BodyMedium,
    val bodySmall: TextStyle = HealthGraphTypography.BodySmall,
    val labelLarge: TextStyle = HealthGraphTypography.LabelLarge,
    val labelMedium: TextStyle = HealthGraphTypography.LabelMedium,
    val labelSmall: TextStyle = HealthGraphTypography.LabelSmall,
    val caption: TextStyle = HealthGraphTypography.Caption,
    val overline: TextStyle = HealthGraphTypography.Overline,
    val numberDisplay: TextStyle = HealthGraphTypography.NumberDisplay,
    val numberLarge: TextStyle = HealthGraphTypography.NumberLarge,
    val numberMedium: TextStyle = HealthGraphTypography.NumberMedium,
) {
    companion object {
        val Default = GlassTextStyles()
    }
}