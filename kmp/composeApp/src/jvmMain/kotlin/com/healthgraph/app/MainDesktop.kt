package com.healthgraph.app

import androidx.compose.ui.window.singleWindowApplication
import androidx.compose.ui.window.Window
import androidx.compose.ui.unit.dp
import com.healthgraph.shared.theme.HealthGraphColors

fun main() = singleWindowApplication(
    title = "HealthGraph KMP",
    width = 400.dp,
    height = 800.dp,
    backgroundColor = HealthGraphColors.Background
) {
    Window(onCloseRequest = ::exitApplication) {
        App()
    }
}