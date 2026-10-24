plugins {
    id("org.jetbrains.kotlin.multiplatform")
    id("org.jlleitschuh.gradle.ktlint")
    id("io.gitlab.arturbosch.detekt")
    id("org.jetbrains.kotlin.plugin.compose")
}

kotlin {
    jvm()

    sourceSets {
        val commonMain by getting {
            dependencies {
                // Explicit Compose 1.6.10 versions (instead of BOM)
                implementation("androidx.compose.runtime:runtime:1.6.10")
                implementation("androidx.compose.foundation:foundation:1.6.10")
                implementation("androidx.compose.material3:material3:1.6.10")
                implementation("androidx.compose.material:material-icons-extended:1.6.10")
                implementation("androidx.compose.ui:ui-resources:1.6.10")
                implementation("androidx.compose.animation:animation:1.6.10")
                implementation("androidx.compose.ui:ui:1.6.10")
                implementation("androidx.compose.ui:ui-graphics:1.6.10")
                implementation("androidx.compose.ui:ui-text:1.6.10")
                implementation("androidx.compose.ui:ui-unit:1.6.10")
                implementation("androidx.compose.ui:ui-geometry:1.6.10")
                implementation(libs.kotlinx.coroutines.core)
                implementation(libs.kotlinx.serialization.json)
                implementation(libs.kotlinx.datetime)
                implementation(libs.kotlinx.collections.immutable)
                // Napier from JitPack - use version that exists
                implementation("com.github.aakira:napier:2.12.0")
                implementation(libs.ktor.client.core)
                implementation(libs.ktor.client.contentNegotiation)
                implementation(libs.ktor.client.logging)
                implementation(libs.ktor.serialization.kotlinxJson)
                implementation(libs.ktor.client.okhttp)
                implementation(libs.ktor.client.cio)
                implementation(libs.kotlinx.coroutines.core)
            }
        }
        val jvmMain by getting {
            dependencies {
                implementation("androidx.compose.ui:ui-platform-jvm:1.6.10")
            }
        }
    }
}

tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile::class.java).configureEach {
    kotlinOptions {
        jvmTarget = "17"
        freeCompilerArgs += listOf(
            "-Xopt-in=kotlin.RequiresOptIn",
            "-Xopt-in=kotlinx.coroutines.ExperimentalCoroutinesApi",
            "-Xopt-in=androidx.compose.material3.ExperimentalMaterial3Api",
            "-Xopt-in=androidx.compose.foundation.ExperimentalFoundationApi",
            "-Xopt-in=androidx.compose.ui.ExperimentalComposeUiApi"
        )
    }
}

detekt {
    config = files("detekt.yml")
    buildUponDefaultConfig = true
    reports {
        html.required.set(true)
        xml.required.set(true)
        txt.required.set(false)
    }
}