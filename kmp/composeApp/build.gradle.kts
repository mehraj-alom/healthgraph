plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.android.application)
    alias(libs.plugins.detekt)
}

kotlin {
    android()
    iosX64()
    iosArm64()
    iosSimulatorArm64()
    jvm()
    wasmJs {
        browser()
    }

    sourceSets {
        val commonMain by getting {
            dependencies {
                implementation(project(":shared"))
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
                implementation(libs.kotlinx.coroutines.android)
                implementation(libs.kotlinx.serialization.json)
                implementation(libs.kotlinx.datetime)
                implementation(libs.voyager)
                implementation(libs.voyager.bottomNavigation)
            }
        }
        val androidMain by getting {
            dependencies {
                implementation("androidx.compose.ui:ui-platform-android")
                implementation(libs.androidx.lifecycle.runtime)
                implementation(libs.androidx.activity.compose)
                implementation(libs.androidx.window)
                implementation(libs.okio)
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

android {
    namespace = "com.healthgraph.app"
    compileSdk = 34
    defaultConfig {
        applicationId = "com.healthgraph.app"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }
    packagingOptions {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1,LICENSE,NOTICE}/*"
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