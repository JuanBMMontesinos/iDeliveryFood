import SwiftUI

/// Native SwiftUI Authentication View (`M03`/`M06`) with KeychainSessionVault token persistence and EN/pt-BR selector.
public struct CustomerAuthView: View {
    public let sessionVault: KeychainSessionVault
    public let controller: CustomerMarketplaceController
    public let onAuthenticated: () -> Void

    @State private var email: String = ""
    @State private var password: String = ""
    @State private var errorMessage: String?

    public init(
        sessionVault: KeychainSessionVault,
        controller: CustomerMarketplaceController,
        onAuthenticated: @escaping () -> Void
    ) {
        self.sessionVault = sessionVault
        self.controller = controller
        self.onAuthenticated = onAuthenticated
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(String(localized: "app_title"))
                .font(.title2.bold())
                .accessibilityLabel("iDeliveryFood Authentication Header")

            HStack(spacing: 8) {
                Button("EN") {
                    sessionVault.setPreferredLocale("en")
                    controller.setLocale("en")
                }
                .accessibilityLabel("Switch language to English")

                Button("PT-BR") {
                    sessionVault.setPreferredLocale("pt-BR")
                    controller.setLocale("pt-BR")
                }
                .accessibilityLabel("Switch language to Brazilian Portuguese")
            }

            TextField(String(localized: "auth_email_label"), text: $email)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityLabel("Customer email input")

            SecureField(String(localized: "auth_password_label"), text: $password)
                .accessibilityLabel("Customer password input")

            if let errorMessage = errorMessage {
                Text(errorMessage)
                    .foregroundStyle(.red)
                    .accessibilityLabel("Authentication error message")
            }

            Button(String(localized: "auth_submit_cta")) {
                if email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || password.count < 8 {
                    errorMessage = String(localized: "error_generic_banner")
                } else {
                    errorMessage = nil
                    onAuthenticated()
                }
            }
            .buttonStyle(.borderedProminent)
            .accessibilityLabel("Submit customer sign in")
        }
        .padding(20)
    }
}
