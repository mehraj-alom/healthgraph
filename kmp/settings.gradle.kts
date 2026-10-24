pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
        maven("https://maven.pkg.jetbrains.space/public/p/compose/dev")
    }
    plugins {
        id("org.jetbrains.kotlin.multiplatform") version "2.0.20" apply false
        id("org.jetbrains.compose.multiplatform") version "1.6.10" apply false
        id("com.android.application") version "8.4.0" apply false
        id("org.jetbrains.kotlin.android") version "2.0.20" apply false
        id("com.android.library") version "8.4.0" apply false
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        maven("https://maven.pkg.jetbrains.space/public/p/compose/dev")
    }
}

rootProject.name = "HealthGraphKMP"

include(":shared")
include(":composeApp")