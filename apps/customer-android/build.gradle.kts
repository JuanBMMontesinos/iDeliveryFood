plugins {
    id("com.android.application") version "8.7.3" apply false
    kotlin("android") version "2.1.0" apply false
    kotlin("plugin.compose") version "2.1.0" apply false
    kotlin("plugin.serialization") version "2.1.0" apply false
}

// Android native module for iDeliveryFood Customer App (M06 — Kotlin + Jetpack Compose)
// Default locale: en (res/values/strings.xml), localized in pt-BR (res/values-pt-rBR/strings.xml)
//
// Configured dependencies for Android application target:
// - androidx.compose:compose-bom:2024.10.01
// - androidx.compose.material3:material3
// - androidx.navigation:navigation-compose:2.8.3
// - androidx.lifecycle:lifecycle-viewmodel-compose:2.8.6
// - org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0
// - org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3
// - androidx.security:security-crypto:1.1.0-alpha06 (EncryptedSharedPreferences)
// - org.junit.jupiter:junit-jupiter:5.11.3
