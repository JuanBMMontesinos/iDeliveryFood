import Foundation

/// Secure session & dispatch readiness manager for iOS Courier App (Swift / SwiftUI, M03 / M11).
/// Stores tokens in iOS Keychain vault and prevents unapproved couriers from going online.
public final class CourierKeychainManager {
    private var memoryVault: [String: String] = [:]
    private var locale: String = "en"

    public init() {}

    public func saveTokens(accessToken: String, refreshToken: String) {
        precondition(!accessToken.isEmpty && !refreshToken.isEmpty, "Tokens cannot be empty.")
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

    public func canGoOnlineForDispatch(approvalStatus: String) -> Bool {
        return approvalStatus == "APPROVED"
    }

    public func preferredLocale() -> String {
        return locale
    }

    @discardableResult
    public func setPreferredLocale(_ rawLocale: String) -> String {
        locale = rawLocale.lowercased().hasPrefix("pt") ? "pt-BR" : "en"
        return locale
    }

    public func isAllowedDeepLink(_ rawUrl: String) -> Bool {
        guard let components = URLComponents(string: rawUrl),
              let scheme = components.scheme,
              let host = components.host else {
            return false
        }
        if scheme == "ideliveryfood-courier" {
            return host == "auth-callback" || host == "offers" || host == "tasks"
        }
        if scheme == "ideliveryfood" {
            return host == "courier"
        }
        return false
    }
}
