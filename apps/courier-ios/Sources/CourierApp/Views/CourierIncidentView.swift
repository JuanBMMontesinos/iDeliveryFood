import SwiftUI

/// Native SwiftUI Courier Route / Delivery Incident Reporting View (`M11` / `M14`).
public struct CourierIncidentView: View {
    public static let supportedCategories: [String] = [
        "CUSTOMER_UNREACHABLE",
        "VEHICLE_BREAKDOWN",
        "DAMAGED_ITEMS",
        "STORE_EXCESSIVE_WAIT",
        "SAFETY_CONCERN"
    ]

    public let controller: CourierDispatchController
    public let deliveryTaskId: String
    public let onSubmitIncident: (String, String) -> Void

    @State private var selectedCategory: String = "CUSTOMER_UNREACHABLE"
    @State private var incidentDescription: String = ""

    public init(
        controller: CourierDispatchController,
        deliveryTaskId: String,
        onSubmitIncident: @escaping (String, String) -> Void
    ) {
        self.controller = controller
        self.deliveryTaskId = deliveryTaskId
        self.onSubmitIncident = onSubmitIncident
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(String(localized: "courier_incident_title"))
                .font(.title3.bold())
                .accessibilityLabel("Report Delivery Incident Title")

            Text("Task ID: \(deliveryTaskId)")
                .font(.caption)
                .accessibilityLabel("Delivery task identifier \(deliveryTaskId)")

            Picker("Category", selection: $selectedCategory) {
                ForEach(Self.supportedCategories, id: \.self) { category in
                    Text(category).tag(category)
                }
            }
            .accessibilityLabel("Incident category picker")

            TextField("Incident description", text: $incidentDescription)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel("Incident description input")

            Button(String(localized: "courier_incident_submit_cta")) {
                let trimmed = incidentDescription.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty {
                    onSubmitIncident(selectedCategory, trimmed)
                }
            }
            .buttonStyle(.borderedProminent)
            .accessibilityLabel("Submit delivery incident report")
        }
        .padding(16)
    }
}
