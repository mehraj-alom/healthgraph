@file:OptIn(ExperimentalComposeUiApi::class, ExperimentalMaterial3Api::class)
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.align
import androidx.compose.foundation.layout.alignBy
import androidx.compose.foundation.layout.alignWith
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.withContext
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shape
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorScheme
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Painter
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.removeSemantics
import androidx.compose.ui.text.Semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.layout.Wrap
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.textDirection
import androidx.compose.ui.unit.textUnit
import androidx.compose.ui.unit.textWidth
import androidx.compose.ui.unit.XOR
import androidx.compose.ui.unit.wrapWidth
import com.bumptech.glide.load.resource.bitmap.CenterCrop
import com.bumptech.glide.load.resource.bitmap.RoundedCorners
import com.bumptech.glide.request.target.CustomTarget
import com.bumptech.glide.request.transition.Transition
import com.bumptech.glide.request.target.Target
import com.otronextreme.healthgraph.common.util.Clock
import com.otronextreme.healthgraph.kmp.common.theme.HealthGraphColors
import com.otronextreme.healthgraph.kmp.common.theme.HealthGraphTypography
import com.otronextreme.healthgraph.kmp.common.util.rememberGlassAnimationState
import com.otronextreme.healthgraph.kmp.common.util.glance.GlassCorner
import com.otronextreme.healthgraph.kmp.common.util.glance.GlassElevation
import com.otronextreme.healthgraph.kmp.common.util.glance.liquidGlass
import com.otronextreme.healthgraph.kmp.common.util.glance.GlassCard
import com.otronextreme.healthgraph.kmp.common.util.glance.LiquidButton
import com.otronextreme.healthgraph.kmp.common.util.CatChip
import com.otronextreme.healthgraph.kmp.common.ui.Surface
import com.otronextreme.healthgraph.kmp.common.ui.ScreenHeader
import com.otronextreme.healthgraph.kmp.common.util.glance.rememberWindowInsets

@Composable
fun VoiceJournalScreen(
    modifier: Modifier = Modifier,
    onBack: () -> Unit = {},
) {
    var animationState by rememberGlassAnimationState()

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp),
    ) {
        ScreenHeader(
            title = "Voice Journal",
            subtitle = "Record your thoughts and reflections",
            onBack = onBack,
        )

        Spacer(modifier = Modifier.height(24.dp))

        GlassCard(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
        ) {
            Column(
                modifier = Modifier.fillMaxSize().padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    text = "Voice Journal Screen",
                    style = HealthGraphTypography.h5,
                    color = HealthGraphColors.onSurface,
                    fontWeight = FontWeight.Normal,
                    textAlign = Alignment.CenterHorizontally,
                )

                Spacer(modifier = Modifier.height(16.dp))

                LiquidButton(
                    text = "Start New Entry",
                    onClick = {},
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(8.dp),
                )

                Spacer(modifier = Modifier.height(16.dp))

                CatChip(
                    text = "Today's Entry",
                    modifier = Modifier
                        .padding(8.dp),
                )

                Spacer(modifier = Modifier.height(16.dp))

                OutlinedTextField(
                    value = "",
                    onValueChange = {},
                    label = { Text("Enter your journal entry") },
                    modifier = Modifier
                        .fillMaxWidth(),
                )
            }
        }
    }
}