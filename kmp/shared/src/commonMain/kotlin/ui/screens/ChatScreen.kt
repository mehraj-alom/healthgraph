@file:OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
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
import com.healthgraph.shared.ui.components.GlassTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Psychology
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.foundation.shape.RoundedCornerShape

@Composable
fun ChatScreen(
    modifier: androidx.compose.ui.Modifier = androidx.compose.ui.Modifier,
    onBack: () -> Unit = {}
) {
    val state = rememberGlassAnimationState()
    val messageText by remember { mutableStateOf("") }
    val messages by remember { mutableStateOf(initialMessages) }
    val isTyping by remember { mutableStateOf(false) }

    Box(
        modifier = modifier
            .fillMaxSize()
            .liquidGlass(cornerRadius = 0.dp, elevation = 0.dp, tint = Color.Transparent, timeMs = state.timeMs)
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.Top
        ) {
            // Header
            ScreenHeader(title = "AI Health Coach", subtitle = "Your personal wellness assistant", onBack = onBack)

            // Quick Action Chips
            GlassCard {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    QuickActionChip("Analyze my sleep", Icons.Default.Psychology, HealthGraphColors.Primary)
                    QuickActionChip("Workout suggestion", Icons.Default.FitnessCenter, HealthGraphColors.Success)
                    QuickActionChip("Nutrition advice", Icons.Default.Restaurant, HealthGraphColors.Warning)
                    QuickActionChip("Stress check", Icons.Default.SelfImprovement, HealthGraphColors.Accent)
                }
            }

            // Messages
            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                reverseLayout = true
            ) {
                items(messages.reversed()) { message ->
                    MessageBubble(message)
                }

                // Typing indicator
                if (isTyping) {
                    TypingIndicator()
                }
            }

            // Input Area
            GlassCard {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    LiquidButton(
                        onClick = { /* attach */ },
                        label = "",
                        variant = LiquidButtonVariant.OUTLINE,
                        size = LiquidButtonSize.MEDIUM,
                        icon = Icons.Default.AttachFile
                    )

                    GlassTextField(
                        value = messageText,
                        onValueChange = { messageText = it },
                        placeholder = "Ask your health coach...",
                        modifier = Modifier
                            .weight(1f)
                            .padding(vertical = 8.dp)
                    )

                    LiquidButton(
                        onClick = { /* voice */ },
                        label = "",
                        variant = LiquidButtonVariant.OUTLINE,
                        size = LiquidButtonSize.MEDIUM,
                        icon = Icons.Default.Mic
                    )

                    LiquidButton(
                        onClick = { sendMessage() },
                        label = "",
                        variant = LiquidButtonVariant.FILLED,
                        size = LiquidButtonSize.MEDIUM,
                        icon = Icons.Default.Send,
                        enabled = messageText.isNotBlank()
                    )
                }
            }
        }
    }
}

fun sendMessage() {
    // Implementation would send message and trigger AI response
}

data class ChatMessage(
    val text: String,
    val isUser: Boolean,
    val timestamp: String,
    val type: MessageType = MessageType.TEXT
)

enum class MessageType { TEXT, INSIGHT, RECOMMENDATION, DATA_CARD }

val initialMessages = listOf(
    ChatMessage(
        "Hi! I'm your AI Health Coach. I can see your HRV is 58ms (great!), sleep score 87%, and you're 280mg caffeine today. How can I help?",
        false,
        "Just now",
        MessageType.TEXT
    ),
    ChatMessage(
        "My morning run felt harder than usual. Any ideas why?",
        true,
        "Just now",
        MessageType.TEXT
    ),
    ChatMessage(
        "Your HRV dropped 12% overnight (58→51ms) and deep sleep was only 1h 12m vs your 1h 42m avg. Combined with 280mg caffeine by noon, this suggests incomplete recovery. Consider: 1) Zone 2 only today, 2) Extra hydration, 3) Caffeine cutoff at 12pm.",
        false,
        "Just now",
        MessageType.INSIGHT
    )
)

@Composable
fun QuickActionChip(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, color: Color) {
    val s = rememberGlassAnimationState()
    Box(
        modifier = Modifier
            .weight(1f)
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, color.copy(alpha = 0.12f))
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(12.dp, 8.dp)
            .fillMaxWidth()
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(imageVector = icon, contentDescription = null, tint = color, modifier = Modifier.size(16.dp))
            Text(label, style = HealthGraphTypography.LabelMedium.copy(color = color))
        }
    }
}

@Composable
fun MessageBubble(message: ChatMessage) {
    val s = rememberGlassAnimationState()
    val bgColor = if (message.isUser) HealthGraphColors.Primary else HealthGraphColors.Surface
    val textColor = if (message.isUser) Color.White else HealthGraphColors.OnSurface
    val align = if (message.isUser) Alignment.End else Alignment.Start

    when (message.type) {
        MessageType.TEXT -> {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .liquidGlass(GlassCorner.LG, GlassElevation.Level2, bgColor.copy(alpha = if (message.isUser) 1f else 1f), timeMs = s.timeMs)
                    .clip(RoundedCornerShape(if (message.isUser) GlassCorner.LG.copy(bottomEnd = GlassCorner.SM) else GlassCorner.LG.copy(bottomStart = GlassCorner.SM)))
                    .padding(16.dp)
                    .align(align)
            ) {
                Column(
                    horizontalAlignment = align,
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(message.text, style = HealthGraphTypography.BodyMedium.copy(color = textColor))
                    Text(message.timestamp, style = HealthGraphTypography.Caption.copy(color = textColor.copy(alpha = 0.7f)))
                }
            }
        }
        MessageType.INSIGHT -> {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .liquidGlass(GlassCorner.LG, GlassElevation.Level2, HealthGraphColors.Primary.copy(alpha = 0.12f), timeMs = s.timeMs)
                    .clip(RoundedCornerShape(GlassCorner.LG))
                    .padding(16.dp)
            ) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    horizontalAlignment = Alignment.Start
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Box(
                            modifier = Modifier.size(28.dp).liquidGlass(GlassCorner.Full, GlassElevation.Level1, HealthGraphColors.Primary.copy(alpha = 0.15f)).clip(RoundedCornerShape(GlassCorner.Full)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(Icons.Default.Psychology, contentDescription = null, tint = HealthGraphColors.Primary, modifier = Modifier.size(14.dp))
                        }
                        Text("AI Insight", style = HealthGraphTypography.LabelMedium.copy(color = HealthGraphColors.Primary))
                    }
                    Text(message.text, style = HealthGraphTypography.BodyMedium)
                    Text(message.timestamp, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
                }
            }
        }
        MessageType.RECOMMENDATION -> {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .liquidGlass(GlassCorner.LG, GlassElevation.Level2, HealthGraphColors.Success.copy(alpha = 0.12f), timeMs = s.timeMs)
                    .clip(RoundedCornerShape(GlassCorner.LG))
                    .padding(16.dp)
            ) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    horizontalAlignment = Alignment.Start
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Box(
                            modifier = Modifier.size(28.dp).liquidGlass(GlassCorner.Full, GlassElevation.Level1, HealthGraphColors.Success.copy(alpha = 0.15f)).clip(RoundedCornerShape(GlassCorner.Full)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(Icons.Default.CheckCircle, contentDescription = null, tint = HealthGraphColors.Success, modifier = Modifier.size(14.dp))
                        }
                        Text("Recommendation", style = HealthGraphTypography.LabelMedium.copy(color = HealthGraphColors.Success))
                    }
                    Text(message.text, style = HealthGraphTypography.BodyMedium)
                    Text(message.timestamp, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
                }
            }
        }
        MessageType.DATA_CARD -> {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .liquidGlass(GlassCorner.LG, GlassElevation.Level2, HealthGraphColors.Accent.copy(alpha = 0.12f), timeMs = s.timeMs)
                    .clip(RoundedCornerShape(GlassCorner.LG))
                    .padding(16.dp)
            ) {
                Column(
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    horizontalAlignment = Alignment.Start
                ) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Box(
                            modifier = Modifier.size(28.dp).liquidGlass(GlassCorner.Full, GlassElevation.Level1, HealthGraphColors.Accent.copy(alpha = 0.15f)).clip(RoundedCornerShape(GlassCorner.Full)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(Icons.Default.Analytics, contentDescription = null, tint = HealthGraphColors.Accent, modifier = Modifier.size(14.dp))
                        }
                        Text("Data Summary", style = HealthGraphTypography.LabelMedium.copy(color = HealthGraphColors.Accent))
                    }
                    Text(message.text, style = HealthGraphTypography.BodyMedium)
                    Text(message.timestamp, style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
                }
            }
        }
    }
}

@Composable
fun TypingIndicator() {
    val s = rememberGlassAnimationState()
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.LG, GlassElevation.Level2, HealthGraphColors.Surface, timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.LG.copy(bottomStart = GlassCorner.SM)))
            .padding(16.dp)
            .align(Alignment.Start)
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            (1..3).forEach { i ->
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .background(HealthGraphColors.Primary)
                        .clip(RoundedCornerShape(4.dp))
                        .animateItemPlacement()
                )
            }
            Text("AI is thinking...", style = HealthGraphTypography.Caption.copy(color = HealthGraphColors.OnSurfaceVariant))
        }
    )
}

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
fun ScreenHeader(title: String, subtitle: String? = null, onBack: () -> Unit = {}) {
    val s = rememberGlassAnimationState()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .liquidGlass(GlassCorner.MD, GlassElevation.Level1, HealthGraphColors.RefractionTint, timeMs = s.timeMs)
            .clip(RoundedCornerShape(GlassCorner.MD))
            .padding(16.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(title, style = HealthGraphTypography.HeadlineMedium)
            subtitle?.let { Text(it, style = HealthGraphTypography.BodyMedium.copy(color = HealthGraphColors.OnSurfaceVariant)) }
        }
        if (onBack != null) {
            LiquidButton(onClick = onBack, label = "", variant = LiquidButtonVariant.OUTLINE, size = LiquidButtonSize.SMALL, icon = Icons.Default.ArrowBack)
        }
    }
}