import SwiftUI

/// Native SwiftUI Store Discovery & Cuisine Filter View (`M06`).
public struct CustomerDiscoveryView: View {
    public let controller: CustomerMarketplaceController
    public let stores: [MobilePublishedStore]
    public let loadState: CustomerViewLoadState
    public let onSelectStore: (String) -> Void
    public let onOpenCart: () -> Void
    public let onOpenProfile: () -> Void

    @State private var searchQuery: String = ""

    public init(
        controller: CustomerMarketplaceController,
        stores: [MobilePublishedStore],
        loadState: CustomerViewLoadState,
        onSelectStore: @escaping (String) -> Void,
        onOpenCart: @escaping () -> Void,
        onOpenProfile: @escaping () -> Void
    ) {
        self.controller = controller
        self.stores = stores
        self.loadState = loadState
        self.onSelectStore = onSelectStore
        self.onOpenCart = onOpenCart
        self.onOpenProfile = onOpenProfile
    }

    private var filteredStores: [MobilePublishedStore] {
        let query = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return stores }
        return stores.filter {
            $0.name.lowercased().contains(query) || $0.cuisineCategory.lowercased().contains(query)
        }
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(String(localized: "discovery_title"))
                    .font(.title3.bold())
                    .accessibilityLabel("Marketplace Discovery Title")
                Spacer()
                Button(String(localized: "cart_title"), action: onOpenCart)
                    .accessibilityLabel("Open customer cart")
                Button(String(localized: "profile_title"), action: onOpenProfile)
                    .accessibilityLabel("Open customer profile")
            }

            if controller.isOfflineMode || loadState == .offline {
                Text(String(localized: "offline_stale_cache_banner"))
                    .font(.footnote)
                    .foregroundStyle(.orange)
                    .accessibilityLabel("Offline stale cache warning banner")
            }

            TextField(String(localized: "discovery_search_hint"), text: $searchQuery)
                .textFieldStyle(.roundedBorder)
                .accessibilityLabel("Search restaurants and cuisines input")

            switch loadState {
            case .loading:
                ProgressView(String(localized: "state_loading"))
                    .accessibilityLabel("Loading marketplace stores")
            case .error:
                Text(String(localized: "error_generic_banner"))
                    .foregroundStyle(.red)
                    .accessibilityLabel("Marketplace loading error")
            case .empty, .ready, .offline:
                if filteredStores.isEmpty {
                    Text(String(localized: "discovery_empty_stores"))
                        .accessibilityLabel("No stores available for the current filter")
                } else {
                    List(filteredStores, id: \.id) { store in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(store.name)
                                .font(.headline)
                            Text(controller.currentLocale == "pt-BR" ? store.descriptionPtBr : store.descriptionEn)
                                .font(.subheadline)
                            Text("Min: \(controller.formatBrlCents(store.minOrderCents)) • \(store.prepTimeMinMinutes)-\(store.prepTimeMaxMinutes) min")
                                .font(.caption)
                            Button("Open \(store.name)") {
                                onSelectStore(store.id)
                            }
                            .accessibilityLabel("Select store \(store.name)")
                        }
                        .accessibilityLabel("Store card \(store.name)")
                    }
                }
            }
        }
        .padding(16)
    }
}
