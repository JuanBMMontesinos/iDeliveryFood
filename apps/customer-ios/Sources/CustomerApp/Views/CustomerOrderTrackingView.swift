import SwiftUI

/// Native SwiftUI Real-Time Order Tracking, 4-Digit Delivery OTP & Support/Review View (`M06`/`M14`/`M17`).
public struct CustomerOrderTrackingView: View {
    public let controller: CustomerMarketplaceController
    public let order: CustomerOrderDto?
    public let loadState: CustomerViewLoadState
    public let onSubmitReview: (Int, String) -> Void
    public let onOpenSupportCase: (String) -> Void

    @State private var reviewComment: String = ""
    @State private var supportSubject: String = ""

    public init(
        controller: CustomerMarketplaceController,
        order: CustomerOrderDto?,
        loadState: CustomerViewLoadState,
        onSubmitReview: @escaping (Int, String) -> Void,
        onOpenSupportCase: @escaping (String) -> Void
    ) {
        self.controller = controller
        self.order = order
        self.loadState = loadState
        self.onSubmitReview = onSubmitReview
        self.onOpenSupportCase = onOpenSupportCase
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(String(localized: "tracking_title"))
                .font(.title3.bold())
                .accessibilityLabel("Live Order Tracking Title")

            if loadState == .loading {
                ProgressView(String(localized: "state_loading"))
                    .accessibilityLabel("Loading live order status")
            } else if let order = order {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Order #\(order.orderNumber)")
                        .font(.headline)
                    Text("Order Status: \(order.orderStatus)")
                    Text("Payment Status: \(order.paymentStatus)")
                    Text("Delivery Status: \(order.deliveryStatus)")
                    Text("Total: \(controller.formatBrlCents(order.totalCents))")
                }
                .accessibilityLabel("Order summary card #\(order.orderNumber)")

                Text(String(localized: "tracking_otp_notice"))
                    .font(.footnote.bold())
                    .padding(10)
                    .accessibilityLabel("4-digit delivery OTP security notice")

                TextField("Review comment", text: $reviewComment)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityLabel("Order review comment input")

                Button(String(localized: "tracking_review_cta")) {
                    onSubmitReview(5, reviewComment)
                }
                .buttonStyle(.bordered)
                .accessibilityLabel("Submit 5-star order review")

                TextField("Support subject", text: $supportSubject)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityLabel("Support case subject input")

                Button(String(localized: "tracking_support_cta")) {
                    if !supportSubject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        onOpenSupportCase(supportSubject)
                    }
                }
                .buttonStyle(.bordered)
                .accessibilityLabel("Open order support ticket")
            } else {
                Text(String(localized: "error_generic_banner"))
                    .foregroundStyle(.red)
                    .accessibilityLabel("Order tracking error banner")
            }
        }
        .padding(16)
    }
}
