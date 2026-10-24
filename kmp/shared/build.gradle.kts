plugins {
    alias(libs.plugins.kotlin.multiplatform)
}

kotlin {
    ios()
    jvm()
    wasmJs()

    listOf(
        ios(),
        jvm(),
        wasmJs()
    ).forEach {
        it.compilerOptions.freeCompilerArgs.addAll(
            "-Xopt-in=kotlin.RequiresOptIn",
            "-Xopt-in=kotlinx.coroutines.ExperimentalCoroutinesApi",
            "-Xopt-in=androidx.compose.material3.ExperimentalMaterial3Api",
            "-Xopt-in=androidx.compose.foundation.ExperimentalFoundationApi",
            "-Xopt-in=androidx.compose.ui.ExperimentalComposeUiApi"
        )
    }

    sourceSets {
        val commonMain by getting {
            dependencies {
                implementation(platform("androidx.compose:compose-bom:2024.08.00"))
                implementation("androidx.compose.runtime:runtime")
                implementation("androidx.compose.foundation:foundation")
                implementation("androidx.compose.material3:material3")
                implementation("androidx.compose.material:material-icons-extended")
                implementation("androidx.compose.ui:ui-resources")
                implementation("androidx.compose.material3:material3")
                implementation("androidx.compose.animation:animation")
                implementation("androidx.compose.ui:ui")
                implementation("androidx.compose.ui:ui-graphics")
                implementation("androidx.compose.ui:ui-text")
                implementation("androidx.compose.ui:ui-unit")
                implementation("androidx.compose.ui:ui-geometry")
                implementation(libs.kotlinx.coroutines.core)
                implementation(libs.kotlinx.serialization.json)
                implementation(libs.kotlinx.datetime)
                implementation(libs.kotlinx.collections.immutable)
                implementation(libs.napier)
                implementation(libs.ktor.client.core)
                implementation(libs.ktor.client.contentNegotiation)
                implementation(libs.ktor.client.logging)
                implementation(libs.ktor.serialization.kotlinxJson)
                implementation(libs.ktor.client.okhttp)
                implementation(libs.ktor.client.cio)
                implementation(libs.kotlinx.coroutines.core)
            }
        }
        val iosMain by getting {
            dependencies {
                implementation("androidx.compose.ui:ui-platform-ios")
            }
        }
        val jvmMain by getting {
            dependencies {
                implementation("androidx.compose.ui:ui-platform-jvm")
            }
        }
        val wasmJsMain by getting {
            dependencies {
                implementation("androidx.compose.ui:ui-platform-wasm")
                implementation(libs.kotlinx.coroutines.js)
            }
        }
    }
}

tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile::class.java).configureEach {
    kotlinOptions {
        jvmTarget = "17"
    }
}