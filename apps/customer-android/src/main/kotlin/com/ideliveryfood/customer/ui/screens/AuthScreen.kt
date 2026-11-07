package com.ideliveryfood.customer.ui.screens

import com.ideliveryfood.customer.security.SecureSessionStore

enum class AuthMode {
    SIGN_IN,
    SIGN_UP,
    RECOVER_PASSWORD
}

data class AuthScreenUiState(
    val mode: AuthMode = AuthMode.SIGN_IN,
    val email: String = "",
    val locale: String = "en",
    val titleText: String,
    val emailLabelText: String,
    val submitButtonText: String,
    val contentDescription: String,
    val errorMessage: String? = null
)

/**
 * Jetpack Compose AuthScreen state & renderer for Customer Android App (M03 / M06).
 * Supports Sign-In, Sign-Up, Password Recovery, and runtime language switch ('en' / 'pt-BR')
 * with explicit TalkBack accessibility contentDescription.
 */
object AuthScreen {
    fun buildUiState(
        sessionStore: SecureSessionStore,
        mode: AuthMode = AuthMode.SIGN_IN,
        email: String = "",
        errorMessage: String? = null
    ): AuthScreenUiState {
        val locale = sessionStore.getPreferredLocale()
        val isPt = locale == "pt-BR"
        val title = when (mode) {
            AuthMode.SIGN_IN -> if (isPt) "Entre na sua conta" else "Sign in to your account"
            AuthMode.SIGN_UP -> if (isPt) "Crie sua conta" else "Create your account"
            AuthMode.RECOVER_PASSWORD -> if (isPt) "Recuperar sua senha" else "Recover your password"
        }
        return AuthScreenUiState(
            mode = mode,
            email = email,
            locale = locale,
            titleText = title,
            emailLabelText = if (isPt) "Endereço de e-mail" else "Email address",
            submitButtonText = if (isPt) "Continuar" else "Continue",
            contentDescription = "$title — iDeliveryFood Customer Authentication",
            errorMessage = errorMessage
        )
    }
}
