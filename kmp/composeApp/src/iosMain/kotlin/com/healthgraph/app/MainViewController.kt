package com.healthgraph.app

import androidx.compose.ui.window.ComposeUIViewController
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.RepeatOnLifecycle
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import platform.UIKit.UIViewController
import platform.UIKit.UIScreen

fun MainViewController(): UIViewController {
    return ComposeUIViewController { App() }
}