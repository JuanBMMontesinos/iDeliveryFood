import SwiftUI

/// Native SwiftUI Courier Shift Availability & GPS Telemetry View (`M11`).
public struct CourierAvailabilityView: View {
    public let keychainManager: CourierKeychainManager
    public let controller: CourierDispatchController
    public let approvalStatus: String
    public let onOpenEarnings: () -> Void
    public let onOpenOnboarding: () -> Void

    public init(
        keychainManager: CourierKeychainManager,
        controller: CourierDispatchController,
        approvalStatus: String,
        onOpenEarnings: @escaping () -> Void,
        onOpenOnboarding: @escaping () -> Void
    ) {
        self.keychainManager = keychainManager
        self.controller = controller
        self.approvalStatus = approvalStatus
        self.onOpenEarnings = onOpenEarnings
        self.onOpenOnboarding = onOpenOnboarding
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(String(localized: "courier_availability_title"))
                .font(.title3.bold())
                .accessibilityLabel("Courier Shift Availability Title")

            let canGoOnline = keychainManager.canGoOnlineForDispatch(approvalStatus: approvalStatus)
            let effectiveOnline = canGoOnline && controller.isOnline

            Text(
                effectiveOnline
                    ? String(localized: "courier_status_online")
                    : String(localized: "courier_status_offline")
            )
            .font(.headline)
            .accessibilityLabel("Courier current availability status")

            if !controller.isGpsAuthorized {
                Text(String(localized: "courier_gps_permission_denied_notice"))
                    .foregroundStyle(.red)
                    .accessibilityLabel("GPS permission denied warning banner")
            }

            if !controller.isNetworkOnline {
                Text("\(String(localized: "state_offline")) (\(controller.queuedOfflineSamplesCount()))")
                    .foregroundStyle(.orange)
                    .accessibilityLabel("Offline queued GPS telemetry count")
            }

            HStack(spacing: 10) {
                Button(String(localized: "courier_availability_toggle_online")) {
                    if canGoOnline {
                        controller.setOnlineAvailability(online: true, gpsAuthorized: controller.isGpsAuthorized)
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(!canGoOnline || !controller.isGpsAuthorized)
                .accessibilityLabel("Toggle courier shift online")

                Button(String(localized: "courier_availability_toggle_offline")) {
                    controller.setOnlineAvailability(online: false, gpsAuthorized: controller.isGpsAuthorized)
                }
                .buttonStyle(.bordered)
                .accessibilityLabel("Toggle courier shift offline")
            }

            HStack(spacing: 10) {
                Button(String(localized: "courier_earnings_title"), action: onOpenEarnings)
                    .accessibilityLabel("Open courier earnings and settlements")

                Button(String(localized: "courier_onboarding_title"), action: onOpenOnboarding)
                    .accessibilityLabel("Open courier KYC onboarding")
            }
        }
        .padding(16)
    }
}
