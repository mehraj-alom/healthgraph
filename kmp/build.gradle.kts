plugins {
    id("org.jetbrains.kotlin.multiplatform") version "2.0.20" apply false
    id("com.android.application") version "8.4.0" apply false
    id("org.jetbrains.kotlin.android") version "2.0.20" apply false
    id("com.android.library") version "8.4.0" apply false
    id("org.jlleitschuh.gradle.ktlint") version "11.0.0" apply false
    id("io.gitlab.arturbosch.detekt") version "1.23.6" apply false
}

subprojects {
    // Apply plugins without version - uses already-loaded plugin from root
    apply(plugin = "org.jetbrains.kotlin.multiplatform")
    apply(plugin = "org.jlleitschuh.gradle.ktlint")
    apply(plugin = "io.gitlab.arturbosch.detekt")
}