import Foundation

// Messages between the Apple Watch app and the iPhone app (the iPhone talks to your Jarvis server; the watch never needs Tailscale).
struct WatchRequest: Codable { var id: String; var kind: String; var audio: Data? }          // kind: "voice" (audio m4a) or "summary"
struct WatchResponse: Codable { var id: String; var status: String; var heard: String?; var text: String?; var audio: Data? } // status: thinking, done, error
