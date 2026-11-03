// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "iDeliveryFoodCourierIOS",
    defaultLocalization: "en",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "CourierApp", targets: ["CourierApp"])
    ],
    targets: [
        .target(
            name: "CourierApp",
            resources: [.process("Resources")]
        ),
        .testTarget(
            name: "CourierAppTests",
            dependencies: ["CourierApp"]
        )
    ]
)
