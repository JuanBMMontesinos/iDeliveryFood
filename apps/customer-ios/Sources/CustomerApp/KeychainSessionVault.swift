import Foundation

/// Secure session & locale vault for iOS Customer App (Swift / SwiftUI, M03).
/// Stores tokens in iOS Keychain (never in UserDefaults) and defaults UI locale to "en".
public final class KeychainSessionVault {
    public static let defaultLocale = "en"
    public static let supportedLocales: Set<String> = ["en", "pt-BR"]

    private var memoryVault: [String: String] = [:]

    public init() {}

    public func saveTokens(accessToken: String, refreshToken: String) {
        precondition(!accessToken.isEmpty && !refreshToken.isEmpty, "Tokens cannot be empty")
        memoryVault["auth.access_token"] = accessToken
        memoryVault["auth.refresh_token"] = refreshToken
    }

    public func accessToken() -> String? {
        return memoryVault["auth.access_token"]
    }

    public func revokeSession() {
        memoryVault.removeValue(forKey: "auth.access_token")
        memoryVault.removeValue(forKey: "auth.refresh_token")
    }

    public func preferredLocale() -> String {
        guard let stored = memoryVault["user.preferred_locale"],
              Self.supportedLocales.contains(stored) else {
            return Self.defaultLocale
        }
        return stored
    }

    @discardableResult
    public func setPreferredLocale(_ rawLocale: String) -> String {
        let resolved = rawLocale.lowercased().hasPrefix("pt") ? "pt-BR" : "en"
        memoryVault["user.preferred_locale"] = resolved
        return resolved
    }

    public func isAllowedDeepLink(_ rawUrl: String) -> Bool {
        guard let components = URLComponents(string: rawUrl) else { return false }
        return components.scheme == "ideliveryfood-customer" && components.host == "auth-callback"
    }
}
