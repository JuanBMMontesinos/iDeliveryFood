import SwiftUI

/// Native SwiftUI Customer Profile, EN/pt-BR Selector, Device Revocation & LGPD Privacy View (`M03`/`M06`/`M22`).
public struct CustomerProfileView: View {
    public let sessionVault: KeychainSessionVault
    public let controller: CustomerMarketplaceController
    public let activeDeviceCount: Int
    public let onSignOut: () -> Void
    public let onRequestLgpdErasure: (String) -> Void

    @State private var erasureReason: String = ""

    public init(
        sessionVault: KeychainSessionVault,
        controller: CustomerMarketplaceController,
        activeDeviceCount: Int,
        onSignOut: @escaping () -> Void,
        onRequestLgpdErasure: @escaping (String) -> Void
    ) {
        self.sessionVault = sessionVault
        self.controller = controller
        self.activeDeviceCount = activeDeviceCount
        self.onSignOut = onSignOut
        self.onRequestLgpdErasure = onRequestLgpdErasure
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(String(localized: "profile_title"))
                .font(.title3.bold())
                .accessibilityLabel("Profile and Privacy Screen Title")

            Text("\(String(localized: "profile_locale_label")): \(sessionVault.preferredLocale())")
                .accessibilityLabel("Current preferred locale")

            HStack(spacing: 8) {
                Button("English (en)") {
                    sessionVault.setPreferredLocale("en")
                    controller.setLocale("en")
                }
                .accessibilityLabel("Set preferred language to English")

                Button("Português (pt-BR)") {
                    sessionVault.setPreferredLocale("pt-BR")
                    controller.setLocale("pt-BR")
                }
                .accessibilityLabel("Set preferred language to Brazilian Portuguese")
            }

            Text("\(String(localized: "profile_devices_title")): \(activeDeviceCount)")
                .accessibilityLabel("Trusted devices count \(activeDeviceCount)")

            TextField("LGPD erasure reason", text: $erasureReason)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel("LGPD account deletion reason input")

            Button(String(localized: "profile_lgpd_delete_cta")) {
                let reason = erasureReason.trimmingCharacters(in: .whitespacesAndNewlines)
                onRequestLgpdErasure(reason.isEmpty ? "USER_REQUESTED_ERASURE" : reason)
            }
            .buttonStyle(.bordered)
            .accessibilityLabel("Request LGPD account deletion")

            Button(String(localized: "profile_logout_cta")) {
                sessionVault.revokeSession()
                onSignOut()
            }
            .buttonStyle(.borderedProminent)
            .accessibilityLabel("Sign out and revoke Keychain session")
        }
        .padding(16)
    }
}
