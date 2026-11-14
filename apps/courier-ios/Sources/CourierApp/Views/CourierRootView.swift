import SwiftUI

public enum CourierRouteDestination: Hashable, Equatable {
    case onboarding
    case availability
    case offerRing(offerId: String)
    case activeDelivery(taskId: String)
    case incident(taskId: String)
    case earnings
}

/// Root SwiftUI NavigationStack & Allowlisted Deep-Link Router for iDeliveryFood iOS Courier App (M11).
public struct CourierRootView: View {
    public let keychainManager: CourierKeychainManager
    public let dispatchController: CourierDispatchController
    public let apiClient: CourierApiClient

    @State private var navigationPath: [CourierRouteDestination] = []

    public init(
        keychainManager: CourierKeychainManager,
        dispatchController: CourierDispatchController,
        apiClient: CourierApiClient
    ) {
        self.keychainManager = keychainManager
        self.dispatchController = dispatchController
        self.apiClient = apiClient
    }

    public static func resolveDeepLink(
        _ rawUrl: String,
        keychainManager: CourierKeychainManager = CourierKeychainManager()
    ) -> CourierRouteDestination? {
        guard keychainManager.isAllowedDeepLink(rawUrl),
              let components = URLComponents(string: rawUrl),
              let host = components.host else {
            return nil
        }
        let trimmedPath = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        switch host {
        case "auth-callback", "courier":
            return .availability
        case "offers":
            return trimmedPath.isEmpty ? nil : .offerRing(offerId: trimmedPath)
        case "tasks":
            return trimmedPath.isEmpty ? nil : .activeDelivery(taskId: trimmedPath)
        default:
            return nil
        }
    }

    public var body: some View {
        NavigationStack(path: $navigationPath) {
            CourierAvailabilityView(
                keychainManager: keychainManager,
                controller: dispatchController,
                approvalStatus: "APPROVED",
                onOpenEarnings: {
                    navigationPath.append(.earnings)
                },
                onOpenOnboarding: {
                    navigationPath.append(.onboarding)
                }
            )
            .navigationDestination(for: CourierRouteDestination.self) { destination in
                switch destination {
                case .onboarding:
                    CourierOnboardingView(
                        keychainManager: keychainManager,
                        controller: dispatchController,
                        profile: nil,
                        onSubmittedKyc: { _, _ in
                            navigationPath.append(.availability)
                        }
                    )
                case .availability:
                    CourierAvailabilityView(
                        keychainManager: keychainManager,
                        controller: dispatchController,
                        approvalStatus: "APPROVED",
                        onOpenEarnings: {
                            navigationPath.append(.earnings)
                        },
                        onOpenOnboarding: {
                            navigationPath.append(.onboarding)
                        }
                    )
                case .offerRing(let offerId):
                    CourierOfferRingView(
                        controller: dispatchController,
                        offer: dispatchController.currentOffer,
                        nowEpochSeconds: Int64(Date().timeIntervalSince1970),
                        onAcceptOffer: {
                            navigationPath.append(.activeDelivery(taskId: offerId))
                        },
                        onRejectOffer: {
                            navigationPath.removeLast()
                        }
                    )
                case .activeDelivery(let taskId):
                    CourierActiveDeliveryView(
                        controller: dispatchController,
                        onCompletedDelivery: {
                            navigationPath.append(.earnings)
                        },
                        onReportIncident: {
                            navigationPath.append(.incident(taskId: taskId))
                        }
                    )
                case .incident(let taskId):
                    CourierIncidentView(
                        controller: dispatchController,
                        deliveryTaskId: taskId,
                        onSubmitIncident: { _, _ in
                            navigationPath.removeLast()
                        }
                    )
                case .earnings:
                    CourierEarningsView(
                        controller: dispatchController,
                        settlements: []
                    )
                }
            }
        }
        .accessibilityLabel("iDeliveryFood Courier iOS Root Navigation Stack")
        .onOpenURL { incomingUrl in
            if let resolved = Self.resolveDeepLink(
                incomingUrl.absoluteString,
                keychainManager: keychainManager
            ) {
                navigationPath.append(resolved)
            }
        }
    }
}
