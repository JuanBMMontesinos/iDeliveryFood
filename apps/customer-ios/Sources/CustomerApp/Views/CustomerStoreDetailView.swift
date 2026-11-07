import SwiftUI

/// Native SwiftUI Store Detail, Menu & Single-Store Basket Guard View (`M06`).
public struct CustomerStoreDetailView: View {
    public let controller: CustomerMarketplaceController
    public let storeDetail: CustomerStoreDetailDto?
    public let loadState: CustomerViewLoadState
    public let onGoToCart: () -> Void

    @State private var pendingConflictProduct: CustomerCatalogProductDto?

    public init(
        controller: CustomerMarketplaceController,
        storeDetail: CustomerStoreDetailDto?,
        loadState: CustomerViewLoadState,
        onGoToCart: @escaping () -> Void
    ) {
        self.controller = controller
        self.storeDetail = storeDetail
        self.loadState = loadState
        self.onGoToCart = onGoToCart
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if loadState == .loading {
                ProgressView(String(localized: "state_loading"))
                    .accessibilityLabel("Loading store menu")
            } else if let detail = storeDetail {
                Text(detail.store.name)
                    .font(.title2.bold())
                    .accessibilityLabel("Store detail header \(detail.store.name)")

                Text("Min: \(controller.formatBrlCents(detail.store.minOrderCents))")
                    .font(.subheadline)

                if let conflictProduct = pendingConflictProduct {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(String(localized: "cart_store_switch_prompt"))
                            .font(.subheadline.bold())
                        HStack {
                            Button(String(localized: "cart_clear_and_switch_cta")) {
                                _ = controller.addItemToBasket(
                                    targetStoreId: detail.store.id,
                                    item: MobileCartItem(productId: conflictProduct.id, quantity: 1),
                                    confirmStoreSwitch: true
                                )
                                pendingConflictProduct = nil
                            }
                            .buttonStyle(.borderedProminent)
                            .accessibilityLabel("Confirm clear basket and switch store")

                            Button(String(localized: "cart_keep_current_cta")) {
                                pendingConflictProduct = nil
                            }
                            .buttonStyle(.bordered)
                            .accessibilityLabel("Cancel store switch")
                        }
                    }
                    .padding(12)
                    .accessibilityLabel("Single-store cart conflict confirmation dialog")
                }

                List(detail.products, id: \.id) { product in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(product.localizedName)
                            .font(.headline)
                        Text(product.localizedDescription)
                            .font(.subheadline)
                        Text(controller.formatBrlCents(product.priceCents))
                            .font(.caption.bold())
                        Button(String(localized: "store_add_to_cart_cta")) {
                            let decision = controller.addItemToBasket(
                                targetStoreId: detail.store.id,
                                item: MobileCartItem(productId: product.id, quantity: 1),
                                confirmStoreSwitch: false
                            )
                            if decision.requiresStoreSwitchConfirmation {
                                pendingConflictProduct = product
                            }
                        }
                        .disabled(!product.isAvailable || detail.store.isPaused)
                        .accessibilityLabel("Add \(product.localizedName) to cart")
                    }
                    .accessibilityLabel("Menu product \(product.localizedName)")
                }

                Button(String(localized: "cart_title"), action: onGoToCart)
                    .buttonStyle(.borderedProminent)
                    .accessibilityLabel("Proceed to cart screen")
            } else {
                Text(String(localized: "error_generic_banner"))
                    .foregroundStyle(.red)
                    .accessibilityLabel("Store detail unavailable")
            }
        }
        .padding(16)
    }
}
