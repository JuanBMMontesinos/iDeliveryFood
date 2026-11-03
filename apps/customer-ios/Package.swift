// swift-tools-version: 5.10
import PackageDescription

let package = Package(
    name: "iDeliveryFoodCustomerIOS",
    defaultLocalization: "en",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "CustomerApp", targets: ["CustomerApp"])
    ],
    targets: [
        .target(
            name: "CustomerApp",
            resources: [.process("Resources")]
        ),
        .testTarget(
            name: "CustomerAppTests",
            dependencies: ["CustomerApp"]
        )
    ]
)
