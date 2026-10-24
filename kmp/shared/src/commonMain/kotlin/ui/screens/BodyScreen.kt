package com.healthgraph.shared.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
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
fun BodyScreen(
    modifier: androidx.compose.ui.Modifier = androidx.compose.ui.Modifier
) {
    val state = rememberGlassAnimationState()
    val selectedSystem by remember { mutableStateOf(BodySystem.CARDIOVASCULAR) }
    val showDetails by remember { mutableStateOf(false) }

    Box(
        modifier = modifier
            .fillMaxSize()
            .liquidGlass(
                cornerRadius = 0.dp,
                elevation = 0.dp,
                tint = Color.Transparent,
                timeMs = state.timeMs
            )
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(0.dp)
        ) {
            BodyHeader(selectedSystem = selectedSystem, onSystemChange = { selectedSystem = it })

            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .weight(1f)
                    .padding(16.dp)
            ) {
                BodyVisualization(
                    system = selectedSystem,
                    onNodeClick = { node ->
                        // Handle node selection
                    }
                )
            }

            BodyBottomSheet(
                system = selectedSystem,
                isExpanded = showDetails,
                onExpandChange = { showDetails = it }
            )
        }
    }
}

enum class BodySystem(
    val name: String,
    val icon: androidx.compose.ui.graphics.vector.ImageVector,
    val color: Color,
    val description: String,
    val nodes: List<BodyNode>
) {
    CARDIOVASCULAR(
        "Cardiovascular",
        androidx.compose.material.icons.Icons.Default.Favorite,
        HealthGraphColors.Secondary,
        "Heart, blood vessels & circulation",
        listOf(
            BodyNode("Heart", "Heart", "Pumping status: Normal", HealthGraphColors.Secondary),
            BodyNode("Aorta", "Aorta", "Flow: Optimal", HealthGraphColors.Primary),
            BodyNode("Coronary", "Coronary Arteries", "Perfusion: Good", HealthGraphColors.Accent)
        )
    ),
    RESPIRATORY(
        "Respiratory",
        androidx.compose.material.icons.Icons.Default.Air,
        HealthGraphColors.Primary,
        "Lungs & airways",
        listOf(
            BodyNode("Lungs", "Lungs", "Capacity: 85%", HealthGraphColors.Primary),
            BodyNode("Bronchi", "Bronchial Tree", "Clear", HealthGraphColors.Accent),
            BodyNode("Alveoli", "Alveoli", "Gas Exchange: Normal", HealthGraphColors.Success)
        )
    ),
    DIGESTIVE(
        "Digestive",
        androidx.compose.material.icons.Icons.Default.Restaurant,
        HealthGraphColors.Warning,
        "GI tract & nutrition",
        listOf(
            BodyNode("Stomach", "Stomach", "Empty", HealthGraphColors.Warning),
            BodyNode("Liver", "Liver", "Function: Normal", HealthGraphColors.Accent),
            BodyNode("Intestines", "Intestines", "Motility: Regular", HealthGraphColors.Success)
        )
    ),
    NERVOUS(
        "Nervous",
        androidx.compose.material.icons.Icons.Default.Psychology,
        HealthGraphColors.Accent,
        "Brain, spine & nerves",
        listOf(
            BodyNode("Brain", "Brain", "Activity: Baseline", HealthGraphColors.Accent),
            BodyNode("Spine", "Spinal Cord", "Intact", HealthGraphColors.Primary),
            BodyNode("Nerves", "Peripheral Nerves", "Conduction: Normal", HealthGraphColors.Success)
        )
    ),
    MUSCULOSKELETAL(
        "Musculoskeletal",
        androidx.compose.material.icons.Icons.Default.AccessibilityNew,
        HealthGraphColors.AccentVariant,
        "Bones, muscles & joints",
        listOf(
            BodyNode("Spine", "Spine", "Alignment: Good", HealthGraphColors.AccentVariant),
            BodyNode("Joints", "Major Joints", "ROM: Full", HealthGraphColors.Primary),
            BodyNode("Muscles", "Muscle Groups", "Tone: Normal", HealthGraphColors.Success)
        )
    ),
    ENDOCRINE(
        "Endocrine",
        androidx.compose.material.icons.Icons.Default.Biotech,
        HealthGraphColors.Secondary,
        "Hormones & glands",
        listOf(
            BodyNode("Thyroid", "Thyroid", "TSH: 2.1 mIU/L", HealthGraphColors.Secondary),
            BodyNode("Adrenals", "Adrenals", "Cortisol: Normal", HealthGraphColors.Primary),
            BodyNode("Pancreas", "Pancreas", "Glucose: 92 mg/dL", HealthGraphColors.Success)
        )
    )
}

data class BodyNode(
    val id: String,
    val name: String,
    val status: String,
    val color: Color
)

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun BodyHeader(
    selectedSystem: BodySystem,
    onSystemChange: (BodySystem) -> Unit
) {
    val state = rememberGlassAnimationState()

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .liquidGlass(
                cornerRadius = 0.dp,
                elevation = 0.dp,
                tint = Color.Transparent,
                timeMs = state.timeMs
            )
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text("Body Systems", style = HealthGraphTypography.HeadlineMedium)
                    Text(selectedSystem.description, style = HealthGraphTypography.BodyMedium.copy(color = HealthGraphColors.OnSurfaceVariant))
                }

                LiquidButtonIcon(
                    onClick = {},
                    icon = { Icon(androidx.compose.material.icons.Icons.Default.Settings, "Settings") },
                    contentDescription = "Settings",
                    variant = LiquidButtonVariant.GHOST
                )
            }

            LazyRow(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(BodySystem.values()) { system ->
                    BodySystemTab(
                        system = system,
                        isSelected = system == selectedSystem,
                        onClick = { onSystemChange(system) }
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun BodySystemTab(
    system: BodySystem,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    val state = rememberGlassAnimationState()

    Box(
        modifier = Modifier
            .liquidGlass(
                cornerRadius = GlassCorner.Full,
                elevation = if (isSelected) GlassElevation.Level2 else GlassElevation.Level1,
                tint = system.color.copy(alpha = if (isSelected) 0.2f else 0.05f),
                timeMs = state.timeMs
            )
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.Full))
            .padding(horizontal = 16.dp, vertical = 10.dp)
            .fillMaxHeight()
            .combinedClickable(onClick = onClick)
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Icon(
                imageVector = system.icon,
                contentDescription = system.name,
                tint = if (isSelected) system.color else HealthGraphColors.OnSurfaceVariant,
                modifier = Modifier.size(20.dp)
            )
            Text(
                text = system.name,
                style = HealthGraphTypography.LabelMedium.copy(
                    color = if (isSelected) system.color else HealthGraphColors.OnSurfaceVariant,
                    fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Medium
                )
            )
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun BodyVisualization(
    system: BodySystem,
    onNodeClick: (BodyNode) -> Unit
) {
    val state = rememberGlassAnimationState()

    Box(
        modifier = Modifier
            .fillMaxSize()
            .liquidGlass(
                cornerRadius = GlassCorner.XL,
                elevation = GlassElevation.Level2,
                tint = system.color.copy(alpha = 0.1f),
                timeMs = state.timeMs
            )
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.XL))
    ) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            Body3DPlaceholder(system = system)

            system.nodes.forEachIndexed { index, node ->
                BodyNodeMarker(
                    node = node,
                    position = calculateNodePosition(index, system.nodes.size),
                    onClick = { onNodeClick(node) }
                )
            }
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun Body3DPlaceholder(system: BodySystem) {
    val state = rememberGlassAnimationState()

    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(40.dp)
            .liquidGlass(
                cornerRadius = GlassCorner.XL,
                elevation = GlassElevation.Level1,
                tint = system.color.copy(alpha = 0.05f),
                timeMs = state.timeMs
            )
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.XL))
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Icon(
                imageVector = system.icon,
                contentDescription = system.name,
                tint = system.color.copy(alpha = 0.3f),
                modifier = Modifier.size(120.dp)
            )

            androidx.compose.foundation.layout.Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = "${system.name} System",
                style = HealthGraphTypography.TitleLarge.copy(color = system.color.copy(alpha = 0.5f))
            )

            androidx.compose.foundation.layout.Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "3D Anatomy View\n(Compose Multiplatform + Filament/SceneView)",
                style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceMuted),
                textAlign = TextAlign.Center
            )
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun BodyNodeMarker(
    node: BodyNode,
    position: androidx.compose.ui.geometry.Offset,
    onClick: () -> Unit
) {
    val state = rememberGlassAnimationState()
    val (isHovered, isSelected) = remember { mutableStateOf(false) to mutableStateOf(false) }
    val scale = animateFloatAsState(
        targetValue = if (isHovered || isSelected) 1.3f else 1f,
        animationSpec = androidx.compose.animation.core.spring(
            dampingRatio = androidx.compose.animation.core.Spring.DampingRatioMediumBouncy,
            stiffness = androidx.compose.animation.core.Spring.StiffnessHigh
        )
    )

    Box(
        modifier = Modifier
            .offset(x = position.x, y = position.y)
            .size(24.dp)
            .graphicsLayer {
                scaleX = scale.value
                scaleY = scale.value
                transformOrigin = androidx.compose.ui.graphics.TransformOrigin.Center
            }
            .pointerInput(Unit) {
                awaitPointerEventScope {
                    awaitFirstDown()
                    isHovered = true
                    awaitRelease()
                    isHovered = false
                    onClick()
                }
            }
    ) {
        Box(
            modifier = Modifier
                .size(24.dp)
                .liquidGlass(
                    cornerRadius = GlassCorner.Full,
                    elevation = GlassElevation.Level3,
                    tint = node.color.copy(alpha = 0.3f),
                    timeMs = state.timeMs
                )
                .clip(androidx.compose.foundation.shape.CircleShape)
        ) {
            Box(
                modifier = Modifier
                    .size(12.dp)
                    .background(node.color)
                    .clip(androidx.compose.foundation.shape.CircleShape)
                    .align(Alignment.Center)
            ) {}
        }
    }
}

fun calculateNodePosition(index: Int, total: Int): androidx.compose.ui.geometry.Offset {
    val angle = (index * 360f / total - 90f) * kotlin.math.PI / 180f
    val radius = 0.35f
    val x = (0.5f + radius * kotlin.math.cos(angle))
    val y = (0.5f + radius * kotlin.math.sin(angle))
    return androidx.compose.ui.geometry.Offset(x, y)
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun BodyBottomSheet(
    system: BodySystem,
    isExpanded: Boolean,
    onExpandChange: (Boolean) -> Unit
) {
    val state = rememberGlassAnimationState()

    AnimatedVisibility(
        visible = true,
        enter = androidx.compose.animation.slideInVertically(
            initialOffsetY = { it -> 300.dp },
            animationSpec = androidx.compose.animation.core.tween(400, delayMillis = 100)
        ),
        exit = androidx.compose.animation.slideOutVertically(
            targetOffsetY = { it -> 300.dp },
            animationSpec = androidx.compose.animation.core.tween(300)
        )
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(if (isExpanded) 300.dp else 120.dp)
                .liquidGlass(
                    cornerRadius = GlassCorner.XL,
                    elevation = GlassElevation.Level3,
                    tint = system.color.copy(alpha = 0.15f),
                    timeMs = state.timeMs
                )
                .clip(androidx.compose.foundation.shape.RoundedCornerShape(topStart = GlassCorner.XL, topEnd = GlassCorner.XL))
                .padding(16.dp)
                .combinedClickable(
                    onClick = { onExpandChange(!isExpanded) }
                )
        ) {
            Column(
                modifier = Modifier.fillMaxSize(),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text(text = "${system.name} Details", style = HealthGraphTypography.TitleLarge)
                        Text(text = "${system.nodes.size} monitored nodes", style = HealthGraphTypography.BodyMedium.copy(color = HealthGraphColors.OnSurfaceVariant))
                    }

                    Icon(
                        imageVector = if (isExpanded)
                            androidx.compose.material.icons.Icons.Default.KeyboardArrowUp
                        else
                            androidx.compose.material.icons.Icons.Default.KeyboardArrowDown,
                        contentDescription = "Expand",
                        tint = HealthGraphColors.OnSurfaceVariant,
                        modifier = Modifier.size(24.dp)
                    )
                }

                if (isExpanded) {
                    LazyColumn(
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        items(system.nodes) { node ->
                            BodyNodeDetail(node = node)
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
@Composable
fun BodyNodeDetail(node: BodyNode) {
    val state = rememberGlassAnimationState()

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(
                cornerRadius = GlassCorner.MD,
                elevation = GlassElevation.Level1,
                tint = node.color.copy(alpha = 0.1f),
                timeMs = state.timeMs
            )
            .clip(androidx.compose.foundation.shape.RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(12.dp)
                    .background(node.color)
                    .clip(androidx.compose.foundation.shape.CircleShape)
            )

            Column(
                verticalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                Text(text = node.name, style = HealthGraphTypography.BodyMedium)
                Text(text = node.status, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
            }
        }

        Icon(
            imageVector = androidx.compose.material.icons.Icons.Default.ChevronRight,
            contentDescription = "Details",
            tint = HealthGraphColors.OnSurfaceMuted,
            modifier = Modifier.size(20.dp)
        )
    }
}