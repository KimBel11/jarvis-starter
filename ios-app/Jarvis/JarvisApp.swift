import SwiftUI
import CarPlay
import LocalAuthentication
import AVFoundation
import WebKit
import UserNotifications

// Jarvis for iPhone: a native shell around your own Jarvis server.
// Face ID lock, mic access for voice, your login stays saved, and a settings sheet for the server address.

enum Prefs {
    static let defaultServer = "https://YOUR-MAC.YOUR-TAILNET.ts.net"
    static var server: String {
        get { UserDefaults.standard.string(forKey: "server") ?? defaultServer }
        set { UserDefaults.standard.set(newValue, forKey: "server") }
    }
    static var faceID: Bool {
        get { UserDefaults.standard.object(forKey: "faceID") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "faceID") }
    }
}

// Activate audio only for an explicit voice interaction. Release it back to other apps.
enum AudioRoute {
    private static var active = false
    static func use(_ recording: Bool) {
        let s = AVAudioSession.sharedInstance()
        do {
            if recording {
                try s.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP])
            } else {
                try s.setCategory(.playback, mode: .spokenAudio)
            }
            try s.setActive(true)
            active = true
        } catch { release() }
    }
    static func release() {
        active = false
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }
    static func observe() {
        NotificationCenter.default.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { _ in
            guard active else { return }
            let s = AVAudioSession.sharedInstance()
            if s.currentRoute.outputs.contains(where: { $0.portType == .builtInReceiver }) { try? s.overrideOutputAudioPort(.speaker) }
        }
    }
}

@main
struct JarvisApp: App {
    @UIApplicationDelegateAdaptor(PushAppDelegate.self) private var pushDelegate
    init() { AudioRoute.observe(); WatchRelay.shared.start() }
    @StateObject private var lock = LockModel()
    @StateObject private var web = WebModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            ZStack {
                Color(red: 0.027, green: 0.035, blue: 0.051).ignoresSafeArea()
                WebContainer(model: web).ignoresSafeArea(edges: .bottom)
                if web.failed != nil { ErrorView(model: web) }
                if lock.locked { LockView(lock: lock, web: web) }
            }
            .preferredColorScheme(.dark)
            .sheet(isPresented: $web.showSettings) { SettingsView(model: web, lock: lock) }
            .onChange(of: phase) { _, p in
                lock.phaseChanged(p)
                // Active audio owns its session until playback ends or @@NAME@@ pauses it (while the app is open).
                // Switching apps must not cancel speech or the server-side task.
                if p == .active { web.webView.setAllMediaPlaybackSuspended(false) {} }
                // Leaving the app pauses Jarvis' voice and removes it from the lock screen; inside the app it keeps talking.
                if p == .background { web.webView.setAllMediaPlaybackSuspended(true) {}; if CarVoice.shared.phase == .idle { AudioRoute.release() } }
            }
            .onAppear { lock.unlockIfNeeded() }
        }
    }
}

// MARK: Face ID lock
final class LockModel: ObservableObject {
    @Published var locked: Bool = Prefs.faceID
    private var leftAt: Date?
    private var busy = false

    func phaseChanged(_ p: ScenePhase) {
        guard Prefs.faceID else { locked = false; return }
        switch p {
        case .background, .inactive:
            if p == .background { leftAt = Date() }
            if p == .inactive && !busy { locked = true } // hide the screen in the app switcher
        case .active:
            if let t = leftAt, Date().timeIntervalSince(t) > 45 { locked = true }
            if locked { unlockIfNeeded() }
        @unknown default: break
        }
    }
    func unlockIfNeeded() {
        guard Prefs.faceID else { locked = false; return }
        guard locked, !busy else { return }
        busy = true
        let ctx = LAContext(); var err: NSError?
        guard ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: &err) else { locked = false; busy = false; return }
        ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: "Open Jarvis") { ok, _ in
            DispatchQueue.main.async { self.busy = false; if ok { self.locked = false; self.leftAt = nil } }
        }
    }
}

// Cached locally so the lock screen matches before the server is reachable.
struct LockAppearance {
    var accent = "#2dd4ee"
    var motion = "subtle"
    var image: UIImage?
    private static var key: String { "jarvis.lockAppearance.v1." + Prefs.server }
    init() {}
    init?(_ value: [String: Any]) {
        guard let hex = value["accent"] as? String,
              hex.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil,
              let motion = value["motion"] as? String,
              ["full", "subtle", "reduced", "levitate", "drift"].contains(motion),
              let encoded = value["image"] as? String, encoded.hasPrefix("data:image/png;base64,"), encoded.count <= 1500000,
              let data = Data(base64Encoded: String(encoded.dropFirst(22))),
              data.starts(with: [137,80,78,71,13,10,26,10]),
              let image = UIImage(data: data), image.size.width <= 1024, image.size.height <= 1024 else { return nil }
        self.accent = hex; self.motion = motion; self.image = image
    }
    static func saved() -> LockAppearance {
        guard let value = UserDefaults.standard.dictionary(forKey: key), let appearance = LockAppearance(value) else { return LockAppearance() }
        return appearance
    }
    func save() {
        guard let data = image?.pngData() else { return }
        UserDefaults.standard.set(["accent": accent, "motion": motion, "image": "data:image/png;base64," + data.base64EncodedString()], forKey: Self.key)
    }
    var color: Color {
        let rgb = UInt32(accent.dropFirst(), radix: 16) ?? 0x2dd4ee
        return Color(red: Double((rgb >> 16) & 255)/255, green: Double((rgb >> 8) & 255)/255, blue: Double(rgb & 255)/255)
    }
}

struct LockView: View {
    @ObservedObject var lock: LockModel
    @ObservedObject var web: WebModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var phase
    var body: some View {
        let appearance = web.lockAppearance
        let still = reduceMotion || appearance.motion == "reduced" || phase != .active
        ZStack {
            Color(red: 0.027, green: 0.035, blue: 0.051).ignoresSafeArea()
            VStack(spacing: 24) {
                TimelineView(.animation(minimumInterval: 1.0/30, paused: still)) { context in
                    let wave = still ? 0 : sin(context.date.timeIntervalSinceReferenceDate * (appearance.motion == "full" ? 1.4 : 0.8))
                    Group {
                        if let image = appearance.image {
                            Image(uiImage: image).resizable().scaledToFit()
                        } else {
                            Circle().fill(RadialGradient(colors: [.white, appearance.color, appearance.color.opacity(0.3)], center: .topLeading, startRadius: 2, endRadius: 100)).padding(48)
                        }
                    }
                    .frame(width: 220, height: 220)
                    .scaleEffect(1 + wave * 0.018)
                    .offset(x: appearance.motion == "drift" ? wave * 5 : 0, y: appearance.motion == "levitate" ? wave * 7 : 0)
                    .accessibilityHidden(true)
                }
                Text("Jarvis").font(.system(size: 28, weight: .semibold, design: .rounded)).foregroundColor(.white)
                Button("Unlock") { lock.unlockIfNeeded() }
                    .font(.system(size: 17, weight: .semibold))
                    .padding(.horizontal, 34).padding(.vertical, 14)
                    .background(Capsule().fill(appearance.color)).foregroundColor(.black)
                    .accessibilityLabel("Unlock Jarvis")
            }
            .padding(.horizontal, 24)
        }
    }
}

final class PushAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool { UNUserNotificationCenter.current().delegate = NativeNotifications.shared; return true }
    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        if connectingSceneSession.role == .carTemplateApplication {
            let c = UISceneConfiguration(name: "Jarvis CarPlay", sessionRole: connectingSceneSession.role)
            c.delegateClass = CarPlaySceneDelegate.self
            return c
        }
        return UISceneConfiguration(name: nil, sessionRole: connectingSceneSession.role)
    }
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) { NativeNotifications.shared.received(deviceToken) }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) { NativeNotifications.shared.failed(error) }
}
