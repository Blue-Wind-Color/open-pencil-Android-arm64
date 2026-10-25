// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "SFSymbols",
  platforms: [.macOS(.v13)],
  products: [.library(name: "SFSymbols", type: .static, targets: ["SFSymbols"])],
  targets: [.target(name: "SFSymbols")]
)
