import Foundation

/// Secure session & dispatch readiness manager for iOS Courier App (Swift / SwiftUI, M03).
public final class CourierKeychainManager {
    private var locale: String = "en"

    public init() {}

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
        guard let components = URLComponents(string: rawUrl) else { return false }
        return components.scheme == "ideliveryfood-courier" && components.host == "auth-callback"
    }
}
