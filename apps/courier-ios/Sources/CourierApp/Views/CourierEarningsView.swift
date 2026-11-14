import SwiftUI

/// Native SwiftUI Courier Earnings Statement & Settlements View (`M11` / `M13`).
public struct CourierEarningsView: View {
    public let controller: CourierDispatchController
    public let settlements: [CourierSettlementDto]

    public init(
        controller: CourierDispatchController,
        settlements: [CourierSettlementDto]
    ) {
        self.controller = controller
        self.settlements = settlements
    }

    private var totalNetEarningsCents: Int {
        settlements.reduce(0) { $0 + $1.netPayoutCents }
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(String(localized: "courier_earnings_title"))
                .font(.title3.bold())
                .accessibilityLabel("Courier Earnings and Settlements Title")

            Text("Total Net Payout: \(controller.formatBrlCents(totalNetEarningsCents))")
                .font(.headline)
                .accessibilityLabel("Total net courier earnings \(controller.formatBrlCents(totalNetEarningsCents))")

            List(settlements, id: \.settlementId) { settlement in
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(settlement.periodStartIso) → \(settlement.periodEndIso)")
                        .font(.subheadline.bold())
                    Text("Net: \(controller.formatBrlCents(settlement.netPayoutCents)) • Status: \(settlement.payoutStatus)")
                        .font(.caption)
                }
                .accessibilityLabel("Courier settlement card \(settlement.settlementId)")
            }
        }
        .padding(16)
    }
}
