import SwiftUI

/// Native SwiftUI Incoming Delivery Offer Ring View (`M11`).
/// Enforces pre-acceptance customer street address privacy (neighborhood only until server acceptance).
public struct CourierOfferRingView: View {
    public let controller: CourierDispatchController
    public let offer: CourierOfferCardModel?
    public let nowEpochSeconds: Int64
    public let onAcceptOffer: () -> Void
    public let onRejectOffer: () -> Void

    public init(
        controller: CourierDispatchController,
        offer: CourierOfferCardModel?,
        nowEpochSeconds: Int64,
        onAcceptOffer: @escaping () -> Void,
        onRejectOffer: @escaping () -> Void
    ) {
        self.controller = controller
        self.offer = offer
        self.nowEpochSeconds = nowEpochSeconds
        self.onAcceptOffer = onAcceptOffer
        self.onRejectOffer = onRejectOffer
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(String(localized: "courier_offer_ring_title"))
                .font(.title3.bold())
                .accessibilityLabel("Incoming Delivery Offer Title")

            if let offer = offer {
                let remainingSeconds = max(0, offer.expiresAtEpochSeconds - nowEpochSeconds)
                let visibleDestination = offer.fullCustomerAddress ?? offer.dropoffNeighborhoodOnly

                Text(offer.pickupStoreName)
                    .font(.headline)
                    .accessibilityLabel("Pickup store \(offer.pickupStoreName)")

                Text("Fee: \(controller.formatBrlCents(offer.offeredFeeCents)) • \(offer.distanceMeters)m • \(remainingSeconds)s")
                    .font(.subheadline.bold())
                    .accessibilityLabel("Offered payout and countdown")

                Text("Dropoff: \(visibleDestination)")
                    .font(.subheadline)
                    .accessibilityLabel("Dropoff destination \(visibleDestination)")

                Text(String(localized: "courier_offer_address_privacy_notice"))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("Customer address privacy notice before acceptance")

                HStack(spacing: 12) {
                    Button(String(localized: "courier_offer_accept_cta"), action: onAcceptOffer)
                        .buttonStyle(.borderedProminent)
                        .accessibilityLabel("Accept delivery offer")

                    Button(String(localized: "courier_offer_reject_cta"), action: onRejectOffer)
                        .buttonStyle(.bordered)
                        .accessibilityLabel("Decline delivery offer")
                }
            } else {
                Text(String(localized: "state_loading"))
                    .accessibilityLabel("Waiting for active delivery offer")
            }
        }
        .padding(16)
    }
}
