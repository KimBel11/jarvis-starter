import SwiftUI

@main
struct JarvisWatchApp: App {
    @StateObject private var model = WatchModel()
    var body: some Scene {
        WindowGroup { WatchHome().environmentObject(model) }
    }
}
