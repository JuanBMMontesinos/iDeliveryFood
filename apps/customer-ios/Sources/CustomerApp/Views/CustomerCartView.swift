import SwiftUI

/// Native SwiftUI Single-Store Shopping Cart View (`M06`).
public struct CustomerCartView: View {
    public let controller: CustomerMarketplaceController
    public let productPricesCents: [String: Int]
    public let onProceedToCheckout: () -> Void

    public init(
        controller: CustomerMarketplaceController,
        productPricesCents: [String: Int],
        onProceedToCheckout: @escaping () -> Void
    ) {
        self.controller = controller
        self.productPricesCents = productPricesCents
        self.onProceedToCheckout = onProceedToCheckout
    }

    private var subtotalCents: Int {
        controller.cartItems.reduce(0) { acc, item in
            acc + (productPricesCents[item.productId] ?? 0) * item.quantity
        }
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(String(localized: "cart_title"))
                .font(.title3.bold())
                .accessibilityLabel("Customer Shopping Cart Title")

            if controller.cartItems.isEmpty {
                Text(String(localized: "cart_empty"))
                    .accessibilityLabel("Shopping cart is empty")
            } else {
                List(controller.cartItems, id: \.productId) { item in
                    let unitCents = productPricesCents[item.productId] ?? 0
                    HStack {
                        Text("\(item.quantity)x \(item.productId)")
                        Spacer()
                        Text(controller.formatBrlCents(unitCents * item.quantity))
                    }
                    .accessibilityLabel("Cart line item \(item.productId)")
                }

                Text("Subtotal: \(controller.formatBrlCents(subtotalCents))")
                    .font(.headline)
                    .accessibilityLabel("Cart subtotal \(controller.formatBrlCents(subtotalCents))")

                Button(String(localized: "cart_proceed_checkout_cta"), action: onProceedToCheckout)
                    .buttonStyle(.borderedProminent)
                    .accessibilityLabel("Proceed to server quote checkout")
            }
        }
        .padding(16)
    }
}
