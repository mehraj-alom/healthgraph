plugins {
    id("org.owasp.dependencycheck") version "1.2.1" apply false
}

subprojects {
    apply(plugin = "org.owasp.dependencycheck")
}

dependencyCheck {
    nvd {
        apiKey = System.getenv("NVD_API_KEY") ?: ""
    }
    suppressions = files("dependency-check-suppressions.xml")
    failBuildOnCVSS = 7
}