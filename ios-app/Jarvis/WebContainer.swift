import SwiftUI
import WebKit
import UserNotifications

final class WebModel: ObservableObject {
    @Published var failed: String?
    @Published var showSettings = false
    @Published var loading = true
    @Published var lockAppearance = LockAppearance.saved()
    let webView: WKWebView
    private let handler = NativeBridge()

    init() {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()                 // keeps your Jarvis login between launches
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []  // voice replies can start without an extra tap
        cfg.applicationNameForUserAgent = "JarvisApp/1.0"
        let ucc = WKUserContentController()
        ucc.add(handler, name: "native")
        // tells the web page it runs inside the app (adds "App settings" buttons)
        ucc.addUserScript(WKUserScript(source: "window.__jarvisNative = true; window.__jarvisNativeNotifications = true; window.__jarvisAlternateIcons = \(UIApplication.shared.supportsAlternateIcons ? "true" : "false");", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        cfg.userContentController = ucc
        webView = WKWebView(frame: .zero, configuration: cfg)
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.027, green: 0.035, blue: 0.051, alpha: 1)
        webView.scrollView.backgroundColor = webView.backgroundColor
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = true
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        let rc = UIRefreshControl(); rc.tintColor = .systemTeal
        rc.addTarget(self, action: #selector(refresh(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = rc
        handler.model = self
        NativeNotifications.shared.attach(webView)
        load()
    }

    @objc func refresh(_ rc: UIRefreshControl) { reload(); DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { rc.endRefreshing() } }

    func load() {
        failed = nil; loading = true
        var s = Prefs.server.trimmingCharacters(in: .whitespacesAndNewlines)
        if !s.hasPrefix("http") { s = "https://" + s }
        guard let u = URL(string: s) else { failed = "That server address is not valid."; return }
        webView.load(URLRequest(url: u, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 25))
    }
    func reload() { if webView.url == nil { load() } else { failed = nil; webView.reload() } }
    func clearLogin(_ done: @escaping () -> Void) {
        let store = WKWebsiteDataStore.default()
        store.fetchDataRecords(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes()) { recs in
            store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), for: recs) { DispatchQueue.main.async { done() } }
        }
    }
}

// Messages from the web page: window.webkit.messageHandlers.native.postMessage("settings")
final class NativeBridge: NSObject, WKScriptMessageHandler {
    weak var model: WebModel?
    private var changingIcon = false
    private static let iconNames: Set<String> = Set(
        ["aurora", "orbit", "minimal", "crystal", "halo"].flatMap { shape in
            ["glacier", "champagne", "amethyst", "jade", "rose", "sapphire", "ember", "ruby", "ice", "indigo"].map { "\(shape)-\($0)" }
        }
    )

    private func trusted(_ message: WKScriptMessage) -> Bool {
        var server = Prefs.server.trimmingCharacters(in: .whitespacesAndNewlines)
        if !server.hasPrefix("http") { server = "https://" + server }
        guard message.frameInfo.isMainFrame, let expected = URL(string: server),
              let actual = message.webView?.url else { return false }
        let origin = message.frameInfo.securityOrigin
        let expectedPort = expected.port ?? (expected.scheme == "https" ? 443 : 80)
        let actualPort = origin.port == 0 ? (origin.protocol == "https" ? 443 : 80) : origin.port
        return origin.host == expected.host && origin.protocol == expected.scheme && actualPort == expectedPort
            && actual.host == expected.host && actual.scheme == expected.scheme
            && (actual.port ?? (actual.scheme == "https" ? 443 : 80)) == expectedPort
    }

    private func iconResult(_ icon: String, error: String?, page: URL?) {
        guard let webView = model?.webView, webView.url == page else { return }
        let payload: [String: Any] = ["icon": icon, "ok": error == nil, "error": error ?? ""]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('jarvis:app-icon-result', {detail: \(json)}));", completionHandler: nil)
    }

    private func setIcon(_ icon: String, page: URL?) {
        guard Self.iconNames.contains(icon) || icon == "default" else {
            iconResult(icon, error: "This icon is not included in this app version.", page: page); return
        }
        guard UIApplication.shared.supportsAlternateIcons else {
            iconResult(icon, error: "This device does not support alternate app icons.", page: page); return
        }
        guard !changingIcon else {
            iconResult(icon, error: "An icon change is already in progress.", page: page); return
        }
        let name: String? = icon == "default" ? nil : icon
        guard UIApplication.shared.alternateIconName != name else { iconResult(icon, error: nil, page: page); return }
        changingIcon = true
        UIApplication.shared.setAlternateIconName(name) { [weak self] error in
            DispatchQueue.main.async {
                self?.changingIcon = false
                self?.iconResult(icon, error: error?.localizedDescription, page: page)
            }
        }
    }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        if let request = m.body as? [String: Any], let action = request["action"] as? String, ["enableNotifications", "notificationStatus"].contains(action) {
            guard trusted(m) else { return }
            if action == "enableNotifications" { NativeNotifications.shared.enable() } else { NativeNotifications.shared.status() }; return
        }
        if let request = m.body as? [String: Any], request["action"] as? String == "syncLockAppearance" {
            guard trusted(m), let appearance = LockAppearance(request) else { return }
            DispatchQueue.main.async {
                appearance.save()
                self.model?.lockAppearance = appearance
            }
            return
        }
        if let request = m.body as? [String: Any], request["action"] as? String == "setAppIcon" {
            guard trusted(m), let icon = request["icon"] as? String else { return }
            let page = m.webView?.url
            DispatchQueue.main.async { self.setIcon(icon, page: page) }
            return
        }
        guard let a = m.body as? String else { return }
        if a.hasPrefix("audio:") {
            guard m.frameInfo.isMainFrame, let expected = URL(string: Prefs.server),
                  m.frameInfo.securityOrigin.host == expected.host,
                  m.frameInfo.securityOrigin.protocol == expected.scheme,
                  m.frameInfo.securityOrigin.port == (expected.port ?? 0) else { return }
        }
        DispatchQueue.main.async {
            switch a {
            case "audio:playback": AudioRoute.use(false)
            case "audio:play-and-record": AudioRoute.use(true)
            case "audio:auto": AudioRoute.release()
            case "settings": self.model?.showSettings = true
            case "reload": self.model?.reload()
            case "haptic": UIImpactFeedbackGenerator(style: .light).impactOccurred()
            default: break
            }
        }
    }
}

struct WebContainer: UIViewRepresentable {
    @ObservedObject var model: WebModel
    func makeCoordinator() -> Coordinator { Coordinator(model) }
    func makeUIView(context: Context) -> WKWebView {
        model.webView.navigationDelegate = context.coordinator
        model.webView.uiDelegate = context.coordinator
        return model.webView
    }
    func updateUIView(_ v: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let model: WebModel
        init(_ m: WebModel) { model = m }

        func webView(_ w: WKWebView, didFinish n: WKNavigation!) { model.loading = false; model.failed = nil; NativeNotifications.shared.ready() }
        func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { fail(e) }
        func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { fail(e) }
        private func fail(_ e: Error) {
            let ns = e as NSError; if ns.code == NSURLErrorCancelled { return }
            model.loading = false
            model.failed = ns.code == NSURLErrorNotConnectedToInternet ? "No internet connection." : "Cannot reach Jarvis. Is Tailscale connected, and is the Mac on?"
        }

        // links to other websites open in Safari; Jarvis itself stays in the app
        func webView(_ w: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url, let scheme = url.scheme else { return decisionHandler(.allow) }
            if ["tel", "mailto", "sms", "facetime"].contains(scheme) { UIApplication.shared.open(url); return decisionHandler(.cancel) }
            if scheme.hasPrefix("http"), let host = url.host, let mine = URL(string: Prefs.server)?.host, host != mine, action.navigationType == .linkActivated || action.targetFrame == nil {
                UIApplication.shared.open(url); return decisionHandler(.cancel)
            }
            decisionHandler(.allow)
        }
        func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures f: WKWindowFeatures) -> WKWebView? {
            if let u = a.request.url { if let mine = URL(string: Prefs.server)?.host, u.host == mine { w.load(a.request) } else { UIApplication.shared.open(u) } }
            return nil
        }

        // microphone for voice: Jarvis only asks for it on its own address
        func webView(_ w: WKWebView, requestMediaCapturePermissionFor o: WKSecurityOrigin, initiatedByFrame f: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            decisionHandler(o.host == URL(string: Prefs.server)?.host || o.host == "localhost" ? .grant : .deny)
        }

        // alert / confirm / prompt used by the web pages
        private func top() -> UIViewController? {
            UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first?.rootViewController.flatMap { var v = $0; while let p = v.presentedViewController { v = p }; return v }
        }
        func webView(_ w: WKWebView, runJavaScriptAlertPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping () -> Void) {
            let a = UIAlertController(title: nil, message: m, preferredStyle: .alert)
            a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() }); (top() ?? UIViewController()).present(a, animated: true)
        }
        func webView(_ w: WKWebView, runJavaScriptConfirmPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            let a = UIAlertController(title: nil, message: m, preferredStyle: .alert)
            a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
            a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) }); (top() ?? UIViewController()).present(a, animated: true)
        }
        func webView(_ w: WKWebView, runJavaScriptTextInputPanelWithPrompt p: String, defaultText d: String?, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
            let a = UIAlertController(title: nil, message: p, preferredStyle: .alert)
            a.addTextField { $0.text = d }
            a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
            a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(a.textFields?.first?.text) }); (top() ?? UIViewController()).present(a, animated: true)
        }
    }
}

struct ErrorView: View {
    @ObservedObject var model: WebModel
    var body: some View {
        ZStack {
            Color(red: 0.027, green: 0.035, blue: 0.051).ignoresSafeArea()
            VStack(spacing: 14) {
                Image(systemName: "wifi.exclamationmark").font(.system(size: 40)).foregroundColor(.orange)
                Text(model.failed ?? "").multilineTextAlignment(.center).foregroundColor(.white).padding(.horizontal, 30)
                Text(Prefs.server).font(.footnote).foregroundColor(.gray)
                VStack(alignment: .leading, spacing: 8) {
                    Text("What has to be running").font(.footnote.weight(.semibold)).foregroundColor(.white)
                    ForEach(["Your Mac is on and awake (after a restart, give it 1–2 minutes)", "Jarvis is running on the Mac (it starts by itself after login, once the external drive is connected)", "Tailscale says Connected on this iPhone and on the Mac", "OrbStack on the Mac, only for social media posting"], id: \.self) { t in
                        HStack(alignment: .top, spacing: 8) { Text("•").foregroundColor(.orange); Text(t).font(.footnote).foregroundColor(.gray) }
                    }
                }.padding(.horizontal, 30).frame(maxWidth: 420, alignment: .leading)
                HStack(spacing: 12) {
                    Button("Try again") { model.load() }.buttonStyle(.borderedProminent)
                    Button("Change address") { model.showSettings = true }.buttonStyle(.bordered)
                }
            }
        }
    }
}

struct SettingsView: View {
    @ObservedObject var model: WebModel
    @ObservedObject var lock: LockModel
    @State private var server = Prefs.server
    @State private var faceID = Prefs.faceID
    @State private var carBg = CarBackground.saved
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            Form {
                Section("Jarvis server") {
                    TextField("https://…", text: $server).textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                    Text("Your Mac's Tailscale address. Tailscale must be connected on this iPhone.").font(.footnote).foregroundColor(.secondary)
                    Button("Use the default address") { server = Prefs.defaultServer }
                }
                Section("CarPlay") {
                    Picker("Background", selection: $carBg) { ForEach(CarBackground.allCases, id: \.self) { Text($0.title).tag($0) } }
                    Text("Reconnect to CarPlay after changing it. In the car: Talk, Daily summary and Stop.").font(.footnote).foregroundColor(.secondary)
                }
                Section("Security") {
                    Toggle("Lock with Face ID", isOn: $faceID)
                    Button("Sign out of Jarvis", role: .destructive) { model.clearLogin { model.load(); dismiss() } }
                }
                Section { Button("Reload Jarvis") { model.reload(); dismiss() } }
            }
            .navigationTitle("Jarvis app")
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Save") {
                Prefs.server = server; Prefs.faceID = faceID; CarBackground.saved = carBg; if !faceID { lock.locked = false }
                model.load(); dismiss() } } }
        }
    }
}

// APNs registration uses the authenticated Jarvis page; device tokens never go to external pages.
final class NativeNotifications: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NativeNotifications()
    weak var webView: WKWebView?
    private var token: String?
    private var pendingRoute: String?
    private var registered = false
    private var lastError = ""
    private var registering = false
    private var registeredServer: String?
    private var deviceID: String {
        if let id = UserDefaults.standard.string(forKey: "jarvis.push.deviceID") { return id }
        let id = UUID().uuidString; UserDefaults.standard.set(id, forKey: "jarvis.push.deviceID"); return id
    }
    private var environment: String? {
        // Use the embedded signed profile, including macOS's Contents location.
        let root = Bundle.main.bundleURL
        let profiles = [root.appendingPathComponent("embedded.mobileprovision"),
                        root.appendingPathComponent("Contents/embedded.provisionprofile"),
                        root.appendingPathComponent("embedded.provisionprofile")]
        for url in profiles {
            guard let data = try? Data(contentsOf: url),
                  let start = data.range(of: Data("<?xml".utf8)), let end = data.range(of: Data("</plist>".utf8)),
                  start.lowerBound < end.upperBound,
                  let value = try? PropertyListSerialization.propertyList(from: data.subdata(in: start.lowerBound..<end.upperBound), format: nil) as? [String: Any],
                  let entitlements = value["Entitlements"] as? [String: Any] else { continue }
            if let value = entitlements["aps-environment"] as? String ?? entitlements["com.apple.developer.aps-environment"] as? String,
               ["development", "production"].contains(value) { return value }
        }
        return nil
    }
    private func trusted() -> Bool {
        guard let expected = URL(string: Prefs.server), let actual = webView?.url else { return false }
        return actual.scheme == expected.scheme && actual.host == expected.host && (actual.port ?? (actual.scheme == "https" ? 443 : 80)) == (expected.port ?? (expected.scheme == "https" ? 443 : 80))
    }
    private func json(_ object: Any) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.fragmentsAllowed]), let text = String(data: data, encoding: .utf8) else { return "null" }; return text
    }
    func attach(_ view: WKWebView) { webView = view; UNUserNotificationCenter.current().delegate = self }
    func enable() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            DispatchQueue.main.async {
                self.lastError = error?.localizedDescription ?? (granted ? "" : "Allow notifications in system settings to receive alerts.")
                if granted { self.registerWithApple() }
                self.status()
            }
        }
    }
    private func registerWithApple() {
        #if os(iOS)
        UIApplication.shared.registerForRemoteNotifications()
        #else
        NSApplication.shared.registerForRemoteNotifications()
        #endif
    }
    func ready() {
        guard trusted() else { return }
        if registeredServer != Prefs.server { registered = false }
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            DispatchQueue.main.async {
                if settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional { self.registerWithApple() }
                self.status(); self.deliverRoute()
            }
        }
    }
    func received(_ data: Data) {
        token = data.map { String(format: "%02x", $0) }.joined()
        saveToken()
    }
    func failed(_ error: Error) { lastError = error.localizedDescription; registered = false; status() }
    private func saveToken() {
        guard trusted(), let token, !registering else { return }
        guard let environment else {
            registered = false
            lastError = "Cannot determine this build's Apple push environment. Install a build signed with a push-enabled provisioning profile."
            status(); return
        }
        registering = true
        #if os(iOS)
        let platform = "ios"
        #else
        let platform = "macos"
        #endif
        let payload: [String: Any] = ["token": token, "platform": platform, "bundleId": Bundle.main.bundleIdentifier ?? "", "environment": environment, "deviceId": deviceID]
        let server = Prefs.server
        webView?.callAsyncJavaScript("const r = await fetch('/api/notifications/devices', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); if(!r.ok) throw new Error('Jarvis registration failed ('+r.status+'). Sign in and try again.'); return true;", arguments: ["payload": payload], in: nil, in: .page) { result in
            self.registering = false
            guard server == Prefs.server else { return }
            switch result {
            case .success: self.registered = true; self.registeredServer = server; self.lastError = ""
            case .failure: self.registered = false; self.lastError = "Could not register this device with Jarvis. Sign in and enable notifications again."
            }
            self.status()
        }
    }
    func status() {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            DispatchQueue.main.async {
                guard self.trusted() else { return }
                let permission = settings.authorizationStatus == .denied ? "denied" : (settings.authorizationStatus == .notDetermined ? "default" : "granted")
                let data: [String: Any] = ["permission": permission, "registered": self.registered && self.registeredServer == Prefs.server, "error": self.lastError, "message": self.lastError.isEmpty ? (self.registered ? "Device registered. Delivery also requires the Jarvis Apple push service." : "Notification permission updated. Waiting for Apple registration.") : self.lastError, "native": true]
                self.webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('jarvis:notification-status',{detail:\(self.json(data))}));", completionHandler: nil)
            }
        }
    }
    private func deliverRoute() {
        guard trusted(), webView?.isLoading == false, let route = pendingRoute else { return }
        pendingRoute = nil
        webView?.evaluateJavaScript("location.hash = \(json(route));", completionHandler: nil)
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) { completionHandler([.banner, .sound, .list]) }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        let route = response.notification.request.content.userInfo["route"] as? String ?? "#/home"
        DispatchQueue.main.async {
            self.pendingRoute = route.hasPrefix("#/") && route.count < 2048 ? route : "#/home"
            #if os(macOS)
            (NSApp.delegate as? AppDelegate)?.showWindow()
            #endif
            self.deliverRoute(); completionHandler()
        }
    }
}
