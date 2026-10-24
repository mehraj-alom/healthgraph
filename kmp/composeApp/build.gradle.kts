plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.compose.multiplatform)
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
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
                implementation(project(":shared"))
                implementation(compose.runtime)
                implementation(compose.foundation)
                implementation(compose.material3)
                implementation(compose.materialIconsExtended)
                implementation(compose.components.resources)
                implementation(compose.components.defaults)
                implementation(compose.animation)
                implementation(compose.ui)
                implementation(compose.ui.graphics)
                implementation(compose.ui.text)
                implementation(compose.ui.unit)
                implementation(compose.ui.geometry)
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
                implementation(compose.ui.platform.android)
                implementation(libs.androidx.lifecycle.runtime)
                implementation(libs.androidx.activity.compose)
                implementation(libs.androidx.window)
                implementation(libs.okio)
            }
        }
        val iosMain by getting {
            dependencies {
                implementation(compose.ui.platform.ios)
            }
        }
        val jvmMain by getting {
            dependencies {
                implementation(compose.ui.platform.jvm)
            }
        }
        val wasmJsMain by getting {
            dependencies {
                implementation(compose.ui.platform.wasm)
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

compose {
    multiplatform {
        targets {
            android()
            ios()
            jvm()
            wasmJs()
        }
    }
}

tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).configureEach {
    kotlinOptions {
        jvmTarget = "17"
    }
}