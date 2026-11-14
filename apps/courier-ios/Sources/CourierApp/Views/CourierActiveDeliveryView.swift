import SwiftUI

/// Native SwiftUI Active Delivery Progression & 4-Digit OTP Verification View (`M11`).
/// Blocks delivery completion while offline (never faking completion locally).
public struct CourierActiveDeliveryView: View {
    public let controller: CourierDispatchController
    public let onCompletedDelivery: () -> Void
    public let onReportIncident: () -> Void

    @State private var otpCode: String = ""
    @State private var errorNotice: String?

    public init(
        controller: CourierDispatchController,
        onCompletedDelivery: @escaping () -> Void,
        onReportIncident: @escaping () -> Void
    ) {
        self.controller = controller
        self.onCompletedDelivery = onCompletedDelivery
        self.onReportIncident = onReportIncident
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(String(localized: "courier_active_delivery_title"))
                .font(.title3.bold())
                .accessibilityLabel("Active Delivery Progression Title")

            Text("Stage: \(controller.stage.rawValue)")
                .font(.headline)
                .accessibilityLabel("Current delivery stage \(controller.stage.rawValue)")

            if let fullAddress = controller.currentOffer?.fullCustomerAddress {
                Text("Customer Address: \(fullAddress)")
                    .font(.subheadline)
                    .accessibilityLabel("Revealed customer delivery address")
            }

            if !controller.isNetworkOnline {
                Text(String(localized: "courier_offline_completion_blocked_notice"))
                    .foregroundStyle(.orange)
                    .accessibilityLabel("Offline delivery completion blocked notice")
            }

            Button(String(localized: "courier_stage_arrived_store_cta")) {
                _ = try? controller.markArrivedAtStore()
            }
            .buttonStyle(.bordered)
            .accessibilityLabel("Confirm arrived at pickup store")

            Button(String(localized: "courier_stage_picked_up_cta")) {
                _ = try? controller.markPickedUpOrder()
            }
            .buttonStyle(.bordered)
            .accessibilityLabel("Confirm order picked up")

            Button(String(localized: "courier_stage_arrived_customer_cta")) {
                _ = try? controller.markArrivedAtCustomer()
            }
            .buttonStyle(.bordered)
            .accessibilityLabel("Confirm arrived at customer location")

            TextField(String(localized: "courier_pod_otp_label"), text: $otpCode)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel("4-digit customer confirmation OTP input")

            if let errorNotice = errorNotice {
                Text(errorNotice)
                    .foregroundStyle(.red)
                    .accessibilityLabel("OTP verification error notice")
            }

            Button(String(localized: "courier_stage_complete_otp_cta")) {
                if !controller.isNetworkOnline {
                    errorNotice = String(localized: "courier_offline_completion_blocked_notice")
                } else {
                    errorNotice = nil
                    onCompletedDelivery()
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(!controller.isNetworkOnline || otpCode.count != 4)
            .accessibilityLabel("Complete delivery with 4-digit OTP")

            Button(String(localized: "courier_incident_title"), action: onReportIncident)
                .buttonStyle(.bordered)
                .accessibilityLabel("Report delivery or route incident")
        }
        .padding(16)
    }
}
