plugins {
    alias(libs.plugins.kotlin.multiplatform)
}

kotlin {
    androidTarget()
    iosX64()
    iosArm64()
    iosSimulatorArm64()
    jvm()
    wasmJs()

    listOf(
        androidTarget(),
        iosX64(),
        iosArm64(),
        iosSimulatorArm64(),
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
                implementation(libs.compose.runtime)
                implementation(libs.compose.foundation)
                implementation(libs.compose.material3)
                implementation(libs.compose.materialIconsExtended)
                implementation(libs.compose.componentsResources)
                implementation(libs.compose.componentsDefaults)
                implementation(libs.compose.animation)
                implementation(libs.compose.ui)
                implementation(libs.compose.uiGraphics)
                implementation(libs.compose.uiText)
                implementation(libs.compose.uiUnit)
                implementation(libs.compose.uiGeometry)
                implementation(libs.kotlinx.coroutines.core)
                implementation(libs.kotlinx.coroutines.android)
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
        val androidMain by getting {
            dependencies {
                implementation(libs.compose.uiPlatformAndroid)
                implementation(libs.androidx.lifecycle.runtime)
                implementation(libs.androidx.activity.compose)
                implementation(libs.androidx.window)
                implementation(libs.okio)
            }
        }
        val iosMain by getting {
            dependencies {
                implementation(libs.compose.uiPlatformIos)
            }
        }
        val jvmMain by getting {
            dependencies {
                implementation(libs.compose.uiPlatformJvm)
            }
        }
        val wasmJsMain by getting {
            dependencies {
                implementation(libs.compose.uiPlatformWasm)
                implementation(libs.kotlinx.coroutines.js)
            }
        }
    }
}

android {
    namespace = "com.healthgraph.shared"
    compileSdk = 34
    defaultConfig {
        minSdk = 24
        targetSdk = 34
    }
}

tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).configureEach {
    kotlinOptions {
        jvmTarget = "17"
    }
}