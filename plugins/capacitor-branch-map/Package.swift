// swift-tools-version: 5.9
import PackageDescription

// Local Capacitor plugin: native Apple Maps branch map.
// Wired into the app by `npx cap sync ios`, which adds this package to
// ios/App/CapApp-SPM/Package.swift (that file is CLI-managed — never edit
// it by hand). The Codemagic ios-release workflow already runs cap sync.
let package = Package(
    name: "CapacitorBranchMap",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapacitorBranchMap",
            targets: ["BranchMapPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.2")
    ],
    targets: [
        .target(
            name: "BranchMapPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm")
            ],
            path: "ios/Sources/BranchMapPlugin",
            resources: [
                // pin-branch@2x/@3x.png, pin-salon@2x/@3x.png — rasterized
                // from the exact SVG artwork in src/components/mapPins.ts
                .process("Resources")
            ])
    ]
)
