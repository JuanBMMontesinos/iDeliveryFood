import SwiftUI

/// Native SwiftUI Server-Side Quote & Checkout View (`M06`/`M10`/`M11`).
/// Enforces integer BRL centavos and honest BLOCKED_MISSING_CREDENTIALS PSP banner.
public struct CustomerCheckoutView: View {
    public let controller: CustomerMarketplaceController
    public let quote: ServerQuoteDto?
    public let readinessState: MobileCheckoutReadinessState
    public let onOrderCreated: (String) -> Void

    public init(
        controller: CustomerMarketplaceController,
        quote: ServerQuoteDto?,
        readinessState: MobileCheckoutReadinessState,
        onOrderCreated: @escaping (String) -> Void
    ) {
        self.controller = controller
        self.quote = quote
        self.readinessState = readinessState
        self.onOrderCreated = onOrderCreated
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(String(localized: "checkout_title"))
                .font(.title3.bold())
                .accessibilityLabel("Checkout and Server Quote Title")

            if readinessState.isOffline {
                Text(String(localized: "offline_stale_cache_banner"))
                    .foregroundStyle(.orange)
                    .accessibilityLabel("Offline checkout blocked banner")
            }

            if readinessState.pspProviderStatus == "BLOCKED_MISSING_CREDENTIALS" {
                Text(String(localized: "checkout_psp_blocked_notice"))
                    .font(.footnote)
                    .foregroundStyle(.red)
                    .accessibilityLabel("PSP blocked missing credentials notice")
            }

            if let quote = quote {
                VStack(alignment: .leading, spacing: 6) {
                    Text(String(localized: "checkout_quote_summary"))
                        .font(.headline)
                    Text("Subtotal: \(controller.formatBrlCents(quote.subtotalCents))")
                    Text("Add-ons: \(controller.formatBrlCents(quote.addonsCents))")
                    Text("Service Fee: \(controller.formatBrlCents(quote.serviceFeeCents))")
                    Text("Delivery Fee: \(controller.formatBrlCents(quote.deliveryFeeCents))")
                    Text("Discount: -\(controller.formatBrlCents(quote.discountCents))")
                    Text("Total: \(controller.formatBrlCents(quote.totalCents))")
                        .font(.headline)
                }
                .accessibilityLabel("Server quote breakdown in BRL centavos")
            }

            Button(String(localized: "checkout_place_order_cta")) {
                if let quote = quote, readinessState.canSubmitOrder {
                    onOrderCreated(quote.id)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(!readinessState.canSubmitOrder || quote == nil)
            .accessibilityLabel("Place order button")
        }
        .padding(16)
    }
}
