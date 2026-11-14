import SwiftUI

/// Native SwiftUI Courier Onboarding & KYC Document Submission View (`M11`).
public struct CourierOnboardingView: View {
    public let keychainManager: CourierKeychainManager
    public let controller: CourierDispatchController
    public let profile: CourierProfileDto?
    public let onSubmittedKyc: (String, String) -> Void

    @State private var vehicleModality: String = "MOTORCYCLE"
    @State private var documentNumber: String = ""

    public init(
        keychainManager: CourierKeychainManager,
        controller: CourierDispatchController,
        profile: CourierProfileDto?,
        onSubmittedKyc: @escaping (String, String) -> Void
    ) {
        self.keychainManager = keychainManager
        self.controller = controller
        self.profile = profile
        self.onSubmittedKyc = onSubmittedKyc
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(String(localized: "courier_onboarding_title"))
                .font(.title3.bold())
                .accessibilityLabel("Courier Onboarding and KYC Title")

            HStack(spacing: 8) {
                Button(String(localized: "courier_locale_en")) {
                    keychainManager.setPreferredLocale("en")
                    controller.switchLocale("en")
                }
                .accessibilityLabel("Switch courier app language to English")

                Button(String(localized: "courier_locale_pt_br")) {
                    keychainManager.setPreferredLocale("pt-BR")
                    controller.switchLocale("pt-BR")
                }
                .accessibilityLabel("Switch courier app language to Brazilian Portuguese")
            }

            if let profile = profile, !keychainManager.canGoOnlineForDispatch(approvalStatus: profile.approvalStatus) {
                Text(String(localized: "courier_pending_approval"))
                    .foregroundStyle(.orange)
                    .accessibilityLabel("Courier KYC pending approval notice")
            }

            TextField(String(localized: "courier_onboarding_vehicle_label"), text: $vehicleModality)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel("Courier vehicle modality input")

            TextField(String(localized: "courier_onboarding_cnh_label"), text: $documentNumber)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel("Courier CNH or document number input")

            Button(String(localized: "courier_onboarding_submit_cta")) {
                let trimmed = documentNumber.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty {
                    onSubmittedKyc(vehicleModality, trimmed)
                }
            }
            .buttonStyle(.borderedProminent)
            .accessibilityLabel("Submit courier KYC documents")
        }
        .padding(16)
    }
}
