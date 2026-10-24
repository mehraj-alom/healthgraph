package com.healthgraph.app

import androidx.compose.ui.webcanvas.ComposeCanvas
import org.w3c.dom.HTMLCanvasElement
import org.w3c.dom.document
import kotlin.browser.window

@kotlin.js.JsExport
@kotlin.js.JsName("main")
fun main() {
    val canvas = document.getElementById("root") as? HTMLCanvasElement
        ?: document.createElement("canvas").apply { id = "root"; document.body.appendChild(this) }
    
    ComposeCanvas(canvas) {
        App()
    }
}