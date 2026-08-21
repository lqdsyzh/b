// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "ChatHub",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "ChatHub", targets: ["ChatHub"])
    ],
    targets: [
        .executableTarget(
            name: "ChatHub",
            path: "Sources/ChatHub"
        )
    ]
)
