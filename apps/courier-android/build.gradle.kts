plugins {
    id("com.android.application") version "8.7.3" apply false
    kotlin("android") version "2.1.0" apply false
    kotlin("plugin.compose") version "2.1.0" apply false
    kotlin("plugin.serialization") version "2.1.0" apply false
}

// Android native module for iDeliveryFood Courier App (M11 — Kotlin + Jetpack Compose)
// Default locale: en (res/values/strings.xml), localized in pt-BR (res/values-pt-rBR/strings.xml)
// Dependencies configured for Android SDK 35 (minSdk 26):
// - androidx.compose.material3:material3
// - androidx.navigation:navigation-compose:2.8.5
// - androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7
// - androidx.security:security-crypto:1.1.0-alpha06 (EncryptedSharedPreferences + Android Keystore)
// - org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0
// - org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3
// - org.junit.jupiter:junit-jupiter:5.11.4
