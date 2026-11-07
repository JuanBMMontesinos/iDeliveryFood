import Foundation

public struct MobilePublishedStore: Equatable, Codable {
    public let id: String
    public let slug: String
    public let name: String
    public let descriptionEn: String
    public let descriptionPtBr: String
    public let cuisineCategory: String
    public let isPaused: Bool
    public let minOrderCents: Int
    public let prepTimeMinMinutes: Int
    public let prepTimeMaxMinutes: Int

    public init(
        id: String,
        slug: String,
        name: String,
        descriptionEn: String,
        descriptionPtBr: String,
        cuisineCategory: String,
        isPaused: Bool,
        minOrderCents: Int,
        prepTimeMinMinutes: Int,
        prepTimeMaxMinutes: Int
    ) {
        self.id = id
        self.slug = slug
        self.name = name
        self.descriptionEn = descriptionEn
        self.descriptionPtBr = descriptionPtBr
        self.cuisineCategory = cuisineCategory
        self.isPaused = isPaused
        self.minOrderCents = minOrderCents
        self.prepTimeMinMinutes = prepTimeMinMinutes
        self.prepTimeMaxMinutes = prepTimeMaxMinutes
    }
}

public struct MobileCartItem: Equatable, Codable {
    public let productId: String
    public var quantity: Int
    public let notes: String?

    public init(productId: String, quantity: Int, notes: String? = nil) {
        self.productId = productId
        self.quantity = quantity
        self.notes = notes
    }
}

public struct MobileStoreAdditionDecision: Equatable {
    public let allowed: Bool
    public let requiresStoreSwitchConfirmation: Bool
    public let activeStoreId: String?
    public let items: [MobileCartItem]
}

public struct MobileCheckoutReadinessState: Equatable {
    public let isOffline: Bool
    public let isCachedDataStale: Bool
    public let canSubmitOrder: Bool
    public let pspProviderStatus: String
    public let missingPspCredentials: [String]
    public let bannerMessageKey: String?
}

/// Native iOS Customer Marketplace, Single-Store Cart & Checkout Readiness Controller (Swift / SwiftUI, M06).
/// Enforces integer BRL centavos, single-store basket invariant, offline stale-cache lock,
/// honest BLOCKED_MISSING_CREDENTIALS PSP status, and allowlisted deep links.
public final class CustomerMarketplaceController {
    private(set) public var currentLocale: String = "en"
    private(set) public var activeStoreId: String?
    private(set) public var cartItems: [MobileCartItem] = []
    private(set) public var isOfflineMode: Bool = false

    public init(locale: String = "en") {
        _ = setLocale(locale)
    }

    @discardableResult
    public func setLocale(_ rawLocale: String) -> String {
        currentLocale = rawLocale.lowercased().hasPrefix("pt") ? "pt-BR" : "en"
        return currentLocale
    }

    public func formatBrlCents(_ cents: Int) -> String {
        precondition(cents >= 0, "Monetary cents must be a non-negative integer.")
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = "BRL"
        formatter.locale = Locale(identifier: currentLocale == "pt-BR" ? "pt_BR" : "en_US")
        let major = Double(cents) / 100.0
        return formatter.string(from: NSNumber(value: major)) ?? "R$ \(String(format: "%.2f", major))"
    }

    public func addItemToBasket(
        targetStoreId: String,
        item: MobileCartItem,
        confirmStoreSwitch: Bool = false
    ) -> MobileStoreAdditionDecision {
        precondition(item.quantity > 0, "Quantity must be > 0")

        if let currentStore = activeStoreId, !cartItems.isEmpty, currentStore != targetStoreId {
            if !confirmStoreSwitch {
                return MobileStoreAdditionDecision(
                    allowed: false,
                    requiresStoreSwitchConfirmation: true,
                    activeStoreId: activeStoreId,
                    items: cartItems
                )
            }
            cartItems.removeAll()
        }

        activeStoreId = targetStoreId
        if let idx = cartItems.firstIndex(where: { $0.productId == item.productId }) {
            cartItems[idx].quantity += item.quantity
        } else {
            cartItems.append(item)
        }

        return MobileStoreAdditionDecision(
            allowed: true,
            requiresStoreSwitchConfirmation: false,
            activeStoreId: activeStoreId,
            items: cartItems
        )
    }

    public func setOfflineMode(_ offline: Bool) {
        isOfflineMode = offline
    }

    public func evaluateCheckoutReadiness(
        pspStatus: String,
        missingEnvVars: [String]
    ) -> MobileCheckoutReadinessState {
        if isOfflineMode {
            return MobileCheckoutReadinessState(
                isOffline: true,
                isCachedDataStale: true,
                canSubmitOrder: false,
                pspProviderStatus: pspStatus,
                missingPspCredentials: missingEnvVars,
                bannerMessageKey: "offline_stale_cache_banner"
            )
        }

        let pspBlocked = pspStatus == "BLOCKED_MISSING_CREDENTIALS" || pspStatus == "DISABLED"
        return MobileCheckoutReadinessState(
            isOffline: false,
            isCachedDataStale: false,
            canSubmitOrder: !pspBlocked && !cartItems.isEmpty,
            pspProviderStatus: pspStatus,
            missingPspCredentials: missingEnvVars,
            bannerMessageKey: pspBlocked ? "checkout_psp_blocked_notice" : nil
        )
    }

    public func isAllowedCustomerDeepLink(_ rawUrl: String) -> Bool {
        guard let components = URLComponents(string: rawUrl),
              components.scheme == "ideliveryfood-customer",
              let host = components.host else {
            return false
        }
        return host == "auth-callback" || host == "orders" || host == "stores"
    }
}
