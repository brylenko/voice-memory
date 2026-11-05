import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Secrets/config come from local.properties (git-ignored) or env vars in CI — never from VCS.
val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun cfg(key: String, env: String, default: String = ""): String =
    localProps.getProperty(key) ?: System.getenv(env) ?: default

android {
    namespace = "com.voicememory.wear"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.voicememory.wear"
        minSdk = 30          // Wear OS 3+ → Galaxy Watch4 and newer
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"

        buildConfigField("String", "BASE_URL", "\"${cfg("voicememory.baseUrl", "VOICEMEMORY_BASE_URL", "http://localhost:3000")}\"")
        buildConfigField("String", "HMAC_SECRET", "\"${cfg("voicememory.hmacSecret", "VOICEMEMORY_HMAC_SECRET")}\"")
        buildConfigField("String", "LANGUAGE", "\"${cfg("voicememory.language", "VOICEMEMORY_LANGUAGE")}\"")
    }

    signingConfigs {
        // Committed on purpose: a *debug* key (standard android/android credentials, not a secret).
        // Without it every CI run signs with a fresh random key and `adb install -r` fails with
        // INSTALL_FAILED_UPDATE_INCOMPATIBLE. Never use it for release builds.
        getByName("debug") {
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-service:2.8.7")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")

    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.wear.compose:compose-material:1.4.0")
    implementation("androidx.wear.compose:compose-foundation:1.4.0")
    implementation("androidx.wear.compose:compose-navigation:1.4.0")
    implementation("androidx.wear:wear-ongoing:1.0.0")

    implementation("androidx.work:work-runtime-ktx:2.10.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303") // real org.json for JVM tests (Android's is a stub)
}
