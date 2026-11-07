import SwiftUI

public enum CustomerViewLoadState: String, Equatable {
    case loading = "LOADING"
    case ready = "READY"
    case empty = "EMPTY"
    case error = "ERROR"
    case offline = "OFFLINE"
}

public enum CustomerRouteDestination: Hashable, Equatable {
    case auth
    case addresses
    case discovery
    case storeDetail(storeId: String)
    case cart
    case checkout
    case orderTracking(orderId: String)
    case profile
}

/// Root SwiftUI NavigationStack & Allowlisted Deep-Link Router for iDeliveryFood iOS Customer App (M06).
public struct CustomerRootView: View {
    public let sessionVault: KeychainSessionVault
    public let marketplaceController: CustomerMarketplaceController
    public let apiClient: CustomerApiClient

    @State private var navigationPath: [CustomerRouteDestination] = []

    public init(
        sessionVault: KeychainSessionVault,
        marketplaceController: CustomerMarketplaceController,
        apiClient: CustomerApiClient
    ) {
        self.sessionVault = sessionVault
        self.marketplaceController = marketplaceController
        self.apiClient = apiClient
    }

    public static func resolveDeepLink(_ rawUrl: String) -> CustomerRouteDestination? {
        guard let components = URLComponents(string: rawUrl),
              let scheme = components.scheme,
              let host = components.host else {
            return nil
        }
        guard scheme == "ideliveryfood-customer" || scheme == "ideliveryfood" else {
            return nil
        }
        let trimmedPath = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        switch host {
        case "auth-callback":
            return .discovery
        case "stores":
            return trimmedPath.isEmpty ? .discovery : .storeDetail(storeId: trimmedPath)
        case "orders":
            return trimmedPath.isEmpty ? .discovery : .orderTracking(orderId: trimmedPath)
        default:
            return nil
        }
    }

    public var body: some View {
        NavigationStack(path: $navigationPath) {
            CustomerDiscoveryView(
                controller: marketplaceController,
                stores: [],
                loadState: .loading,
                onSelectStore: { storeId in
                    navigationPath.append(.storeDetail(storeId: storeId))
                },
                onOpenCart: {
                    navigationPath.append(.cart)
                },
                onOpenProfile: {
                    navigationPath.append(.profile)
                }
            )
            .navigationDestination(for: CustomerRouteDestination.self) { destination in
                switch destination {
                case .auth:
                    CustomerAuthView(
                        sessionVault: sessionVault,
                        controller: marketplaceController,
                        onAuthenticated: {
                            navigationPath.append(.discovery)
                        }
                    )
                case .addresses:
                    CustomerAddressView(
                        addresses: [],
                        loadState: .loading,
                        onAddressSelected: { _ in
                            navigationPath.removeLast()
                        }
                    )
                case .discovery:
                    CustomerDiscoveryView(
                        controller: marketplaceController,
                        stores: [],
                        loadState: .loading,
                        onSelectStore: { storeId in
                            navigationPath.append(.storeDetail(storeId: storeId))
                        },
                        onOpenCart: {
                            navigationPath.append(.cart)
                        },
                        onOpenProfile: {
                            navigationPath.append(.profile)
                        }
                    )
                case .storeDetail(let storeId):
                    CustomerStoreDetailView(
                        controller: marketplaceController,
                        storeDetail: nil,
                        loadState: .loading,
                        onGoToCart: {
                            navigationPath.append(.cart)
                        }
                    )
                    .accessibilityLabel("Store detail screen for \(storeId)")
                case .cart:
                    CustomerCartView(
                        controller: marketplaceController,
                        productPricesCents: [:],
                        onProceedToCheckout: {
                            navigationPath.append(.checkout)
                        }
                    )
                case .checkout:
                    CustomerCheckoutView(
                        controller: marketplaceController,
                        quote: nil,
                        readinessState: marketplaceController.evaluateCheckoutReadiness(
                            pspStatus: "BLOCKED_MISSING_CREDENTIALS",
                            missingEnvVars: ["MERCADOPAGO_ACCESS_TOKEN"]
                        ),
                        onOrderCreated: { orderId in
                            navigationPath.append(.orderTracking(orderId: orderId))
                        }
                    )
                case .orderTracking(let orderId):
                    CustomerOrderTrackingView(
                        controller: marketplaceController,
                        order: nil,
                        loadState: .loading,
                        onSubmitReview: { _, _ in },
                        onOpenSupportCase: { _ in }
                    )
                    .accessibilityLabel("Order tracking screen for \(orderId)")
                case .profile:
                    CustomerProfileView(
                        sessionVault: sessionVault,
                        controller: marketplaceController,
                        activeDeviceCount: 1,
                        onSignOut: {
                            sessionVault.revokeSession()
                            navigationPath.removeAll()
                        },
                        onRequestLgpdErasure: { _ in }
                    )
                }
            }
        }
        .accessibilityLabel("iDeliveryFood iOS Root Navigation Stack")
        .onOpenURL { incomingUrl in
            if let resolved = Self.resolveDeepLink(incomingUrl.absoluteString) {
                navigationPath.append(resolved)
            }
        }
    }
}
