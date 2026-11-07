import SwiftUI

/// Native SwiftUI Saved Addresses & GPS Location View (`M06`).
public struct CustomerAddressView: View {
    public let addresses: [CustomerAddressDto]
    public let loadState: CustomerViewLoadState
    public let onAddressSelected: (CustomerAddressDto) -> Void

    public init(
        addresses: [CustomerAddressDto],
        loadState: CustomerViewLoadState,
        onAddressSelected: @escaping (CustomerAddressDto) -> Void
    ) {
        self.addresses = addresses
        self.loadState = loadState
        self.onAddressSelected = onAddressSelected
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(String(localized: "addresses_title"))
                .font(.title3.bold())
                .accessibilityLabel("Delivery Addresses Screen Title")

            switch loadState {
            case .loading:
                ProgressView(String(localized: "state_loading"))
                    .accessibilityLabel("Loading saved customer addresses")
            case .error, .offline:
                Text(String(localized: "error_generic_banner"))
                    .foregroundStyle(.red)
                    .accessibilityLabel("Error loading saved addresses")
            case .empty:
                Text(String(localized: "addresses_empty"))
                    .accessibilityLabel("No saved delivery addresses")
            case .ready:
                if addresses.isEmpty {
                    Text(String(localized: "addresses_empty"))
                        .accessibilityLabel("No saved delivery addresses")
                } else {
                    List(addresses, id: \.id) { address in
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(address.label) — \(address.recipientName)")
                                .font(.headline)
                            Text("\(address.streetLine), \(address.number) • \(address.neighborhood)")
                                .font(.subheadline)
                            Text("\(address.city)/\(address.stateCode) — CEP \(address.postalCode)")
                                .font(.caption)
                            Button("Select") {
                                onAddressSelected(address)
                            }
                            .accessibilityLabel("Select address \(address.label)")
                        }
                        .accessibilityLabel("Saved address card \(address.label)")
                    }
                }
            }
        }
        .padding(16)
    }
}
