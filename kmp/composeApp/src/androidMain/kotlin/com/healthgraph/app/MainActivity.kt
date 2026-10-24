package com.healthgraph.app

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.setContent
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.RepeatOnLifecycle
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val composeView = ComposeView(this).apply {
            setViewCompositionStrategy(ComposeView.ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
            setContent {
                App()
            }
        }
        setContentView(composeView)
    }
}