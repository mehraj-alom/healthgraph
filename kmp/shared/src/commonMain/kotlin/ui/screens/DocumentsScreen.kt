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
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Image
import androidx.compose.foundation.shape.RoundedCornerShape

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun DocumentsScreen(
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
            ScreenHeader("Documents", "Health records, uploads, categorization")

            // Upload Area
            GlassCardElevated(tint = HealthGraphColors.Primary.copy(alpha = 0.15f)) {
                Column(
                    modifier = Modifier.fillMaxWidth().padding(24.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Box(
                        modifier = Modifier
                            .size(80.dp)
                            .liquidGlass(GlassCorner.Full, GlassElevation.Level2, HealthGraphColors.Primary.copy(alpha = 0.15f))
                            .clip(RoundedCornerShape(GlassCorner.Full))
                    ) {
                        Icon(Icons.Default.UploadFile, contentDescription = null, tint = HealthGraphColors.Primary, modifier = Modifier.align(Alignment.Center).size(40.dp))
                    }

                    Text("Upload Health Document", style = HealthGraphTypography.TitleLarge)
                    Text("PDF, JPG, PNG up to 50MB", style = HealthGraphTypography.BodyMedium.copy(color = HealthGraphColors.OnSurfaceVariant))

                    Row(
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        LiquidButton(onClick = { /* upload */ }, label = "Choose File", variant = LiquidButtonVariant.FILLED, size = LiquidButtonSize.LARGE, modifier = Modifier.weight(1f), icon = Icons.Default.UploadFile)
                        LiquidButton(onClick = { /* camera */ }, label = "Scan Document", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.LARGE, modifier = Modifier.weight(1f), icon = Icons.Default.CameraAlt)
                    }
                }
            }

            // Categories
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Categories", style = HealthGraphTypography.TitleLarge, modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp))
                    CategoryRow("Lab Results", 12, Icons.Default.Biotech, HealthGraphColors.Primary)
                    CategoryRow("Imaging", 5, Icons.Default.Image, HealthGraphColors.Accent)
                    CategoryRow("Prescriptions", 8, Icons.Default.Medication, HealthGraphColors.Success)
                    CategoryRow("Insurance", 3, Icons.Default.Shield, HealthGraphColors.Warning)
                    CategoryRow("Other", 7, Icons.Default.Description, HealthGraphColors.Primary)
                }
            }

            // Recent Documents
            GlassCard {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(16.dp).padding(top = 8.dp, bottom = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Recent Documents", style = HealthGraphTypography.TitleLarge)
                        LiquidButton(onClick = { /* filter */ }, label = "Filter", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.SMALL)
                    }
                    LazyColumn {
                        items(recentDocs) { doc ->
                            DocumentRow(doc)
                            if (doc != recentDocs.last()) {
                                androidx.compose.foundation.layout.Divider(color = HealthGraphColors.Outline.copy(alpha = 0.1f), modifier = Modifier.fillMaxWidth().padding(16.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}

data class CategoryItem(val name: String, val count: Int, val icon: androidx.compose.ui.graphics.vector.ImageVector, val color: Color)

@Composable
fun CategoryRow(name: String, count: Int, icon: androidx.compose.ui.graphics.vector.ImageVector, color: Color) {
    val s = rememberGlassAnimationState()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, color.copy(alpha = 0.05f), timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier.size(44.dp).liquidGlass(GlassCorner.Full, GlassElevation.Level1, color.copy(alpha = 0.15f)).clip(RoundedCornerShape(GlassCorner.Full)),
            contentAlignment = Alignment.Center
        ) {
            Icon(imageVector = icon, contentDescription = null, tint = color, modifier = Modifier.size(22.dp))
        }

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(name, style = HealthGraphTypography.BodyLarge)
            Text("$count documents", style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
        }

        Text("$count", style = HealthGraphTypography.TitleMedium.copy(color = color))
    }
}

data class DocumentItem(
    val name: String,
    val category: String,
    val date: String,
    val size: String,
    val type: DocumentType,
    val color: Color
)

enum class DocumentType { PDF, IMAGE, OTHER }

val recentDocs = listOf(
    DocumentItem("CBC Panel - Jan 2025", "Lab Results", "Jan 15, 2025", "2.4 MB", DocumentType.PDF, HealthGraphColors.Primary),
    DocumentItem("MRI - Knee", "Imaging", "Jan 10, 2025", "45.2 MB", DocumentType.IMAGE, HealthGraphColors.Accent),
    DocumentItem("Vitamin D Prescription", "Prescriptions", "Jan 8, 2025", "1.1 MB", DocumentType.PDF, HealthGraphColors.Success),
    DocumentItem("Insurance Card", "Insurance", "Jan 5, 2025", "890 KB", DocumentType.IMAGE, HealthGraphColors.Warning),
    DocumentItem("Dental Records", "Other", "Dec 20, 2024", "3.5 MB", DocumentType.PDF, HealthGraphColors.Primary),
)

@Composable
fun DocumentRow(doc: DocumentItem) {
    val s = rememberGlassAnimationState()
    val typeIcon = when (doc.type) {
        DocumentType.PDF -> Icons.Default.PictureAsPdf
        DocumentType.IMAGE -> Icons.Default.Image
        else -> Icons.Default.Description
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, doc.color.copy(alpha = 0.05f), timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier.size(44.dp).liquidGlass(GlassCorner.Full, GlassElevation.Level1, doc.color.copy(alpha = 0.15f)).clip(RoundedCornerShape(GlassCorner.Full)),
            contentAlignment = Alignment.Center
        ) {
            Icon(imageVector = typeIcon, contentDescription = null, tint = doc.color, modifier = Modifier.size(22.dp))
        }

        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            Text(doc.name, style = HealthGraphTypography.BodyLarge)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(doc.category, style = HealthGraphTypography.Caption.copy(color = doc.color))
                Text(doc.date, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
                Text(doc.size, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
            }
        }

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LiquidButton(onClick = { /* view */ }, label = "", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.SMALL, icon = Icons.Default.Visibility, modifier = Modifier.padding(4.dp))
            LiquidButton(onClick = { /* download */ }, label = "", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.SMALL, icon = Icons.Default.Download, modifier = Modifier.padding(4.dp))
            LiquidButton(onClick = { /* delete */ }, label = "", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.SMALL, icon = Icons.Default.Delete, modifier = Modifier.padding(4.dp))
        }
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