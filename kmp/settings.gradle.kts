pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
    plugins {
        id("org.jetbrains.kotlin.multiplatform") version "2.0.20" apply false
        id("com.android.application") version "8.4.0" apply false
        id("org.jetbrains.kotlin.android") version "2.0.20" apply false
        id("com.android.library") version "8.4.0" apply false
        id("org.jlleitschuh.gradle.ktlint") version "11.0.0" apply false
        id("io.gitlab.arturbosch.detekt") version "1.23.6" apply false
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        maven("https://maven.pkg.jetbrains.space/public/p/compose/dev")
        maven("https://jitpack.io")
    }
}

rootProject.name = "HealthGraphKMP"

include(":shared")
include(":composeApp")