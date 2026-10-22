import SwiftUI
import WebKit
import UserNotifications

final class WebModel: NSObject, ObservableObject {
    static let shared = WebModel()
    @Published var failed: String?
    let webView: WKWebView
    let workspace = BrowserWorkspace()
    private let bridge = NativeBridge()

    override init() {
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .default()                  // keeps your Jarvis login
        cfg.mediaTypesRequiringUserActionForPlayback = []  // voice replies can play without an extra click
        cfg.applicationNameForUserAgent = "JarvisMac/1.0"
        let ucc = WKUserContentController()
        ucc.add(bridge, name: "native")
        ucc.addUserScript(WKUserScript(source: "window.__jarvisNative = true; window.__jarvisNativeNotifications = true; window.__jarvisDesktop = true; window.__jarvisWorkspace = true; window.__jarvisMultiBrowser = true;", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        cfg.userContentController = ucc
        webView = WKWebView(frame: .zero, configuration: cfg)
        webView.setValue(false, forKey: "drawsBackground")
        webView.allowsBackForwardNavigationGestures = true
        webView.allowsMagnification = true
        if #available(macOS 13.3, *) { webView.isInspectable = true }
        super.init()
        bridge.model = self
        workspace.owner = self
        NativeNotifications.shared.attach(webView)
        load()
    }

    func load() {
        failed = nil
        var s = Prefs.server.trimmingCharacters(in: .whitespacesAndNewlines)
        if !s.hasPrefix("http") { s = "http://" + s }
        guard let u = URL(string: s) else { failed = "That server address is not valid."; return }
        webView.load(URLRequest(url: u, cachePolicy: .reloadRevalidatingCacheData, timeoutInterval: 20))
    }
    func reload() { if webView.url == nil { load() } else { failed = nil; webView.reload() } }
    func go(_ hash: String) { run("location.hash = '\(hash.replacingOccurrences(of: "#", with: ""))'") }
    func run(_ js: String) { webView.evaluateJavaScript(js, completionHandler: nil) }
    func restartServer() {
        let p = Process(); p.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        p.arguments = ["kickstart", "-k", "gui/\(getuid())/com.example.jarvis"]
        try? p.run()
        failed = "Starting Jarvis… this takes a few seconds."
        DispatchQueue.main.asyncAfter(deadline: .now() + 6) { self.load() }
    }
    func clearLogin() {
        let store = WKWebsiteDataStore.default()
        store.fetchDataRecords(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes()) { recs in
            store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), for: recs) { DispatchQueue.main.async { self.load() } }
        }
    }
}

// Exact origin and main-frame checks keep websites outside the privileged bridge.
func trustedJarvisURL(_ url: URL?) -> Bool {
    var server = Prefs.server.trimmingCharacters(in: .whitespacesAndNewlines)
    if !server.hasPrefix("http") { server = "http://" + server }
    guard let expected = URL(string: server), let url else { return false }
    func port(_ u: URL) -> Int { u.port ?? (u.scheme == "https" ? 443 : 80) }
    return ["http", "https"].contains(url.scheme ?? "") && url.scheme == expected.scheme && url.host == expected.host && port(url) == port(expected)
}
func jsJSON(_ value: Any) -> String {
    guard JSONSerialization.isValidJSONObject([value]), let data = try? JSONSerialization.data(withJSONObject: [value]), let text = String(data: data, encoding: .utf8) else { return "null" }
    return String(text.dropFirst().dropLast())
}
final class NativeBridge: NSObject, WKScriptMessageHandler {
    weak var model: WebModel?
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        guard m.frameInfo.isMainFrame, trustedJarvisURL(m.frameInfo.request.url), trustedJarvisURL(m.webView?.url) else { return }
        if let request = m.body as? [String: Any], let action = request["action"] as? String, ["enableNotifications", "notificationStatus"].contains(action) {
            if action == "enableNotifications" { NativeNotifications.shared.enable() } else { NativeNotifications.shared.status() }; return
        }
        if let command = m.body as? [String: Any], command["type"] as? String == "workspace" {
            model?.workspace.command(command); return
        }
        guard let a = m.body as? String else { return }
        switch a {
        case "settings": NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
        case "reload": model?.reload()
        case "micsettings": NSWorkspace.shared.open(URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone")!)
        default: break
        }
    }
}

struct WebContainer: NSViewRepresentable {
    @ObservedObject var model: WebModel
    func makeCoordinator() -> Coordinator { Coordinator(model) }
    func makeNSView(context: Context) -> WKWebView {
        model.webView.navigationDelegate = context.coordinator
        model.webView.uiDelegate = context.coordinator
        return model.webView
    }
    func updateNSView(_ v: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
        let model: WebModel
        init(_ m: WebModel) { model = m }

        func webView(_ w: WKWebView, didFinish n: WKNavigation!) { model.failed = nil; NativeNotifications.shared.ready() }
        func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { fail(e) }
        func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { fail(e) }
        private func fail(_ e: Error) {
            let ns = e as NSError; if ns.code == NSURLErrorCancelled { return }
            model.failed = "Jarvis is not answering. It may still be starting, or it was stopped."
        }

        // Main Jarvis content stays at its configured origin. Websites use an isolated floating surface.
        func webView(_ w: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { return decisionHandler(.cancel) }
            if action.shouldPerformDownload, trustedJarvisURL(w.url) { return decisionHandler(.download) }
            if ["http", "https"].contains(url.scheme ?? "") {
                if action.targetFrame?.isMainFrame == false { return decisionHandler(.allow) }
                if trustedJarvisURL(url) { return decisionHandler(.allow) }
                model.workspace.open(url.absoluteString); return decisionHandler(.cancel)
            }
            if url.scheme == "blob", trustedJarvisURL(w.url) { return decisionHandler(.allow) }
            decisionHandler(.cancel)
        }
        func webView(_ w: WKWebView, decidePolicyFor r: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            decisionHandler(r.canShowMIMEType ? .allow : .download)
        }
        func webView(_ w: WKWebView, navigationAction a: WKNavigationAction, didBecome d: WKDownload) { d.delegate = self }
        func webView(_ w: WKWebView, navigationResponse r: WKNavigationResponse, didBecome d: WKDownload) { d.delegate = self }
        func download(_ d: WKDownload, decideDestinationUsing r: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
            let dir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
            var dest = dir.appendingPathComponent(suggestedFilename); var i = 1
            while FileManager.default.fileExists(atPath: dest.path) { dest = dir.appendingPathComponent("\(i)-\(suggestedFilename)"); i += 1 }
            completionHandler(dest)
        }
        func downloadDidFinish(_ d: WKDownload) { model.run("window.dispatchEvent(new CustomEvent('jarvis:workspace-download',{detail:{message:'Saved to Downloads'}}))") }
        func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures f: WKWindowFeatures) -> WKWebView? {
            if let u = a.request.url { if trustedJarvisURL(u) { w.load(a.request) } else { model.workspace.open(u.absoluteString) } }
            return nil
        }

        // microphone and camera only for Jarvis itself
        func webView(_ w: WKWebView, requestMediaCapturePermissionFor o: WKSecurityOrigin, initiatedByFrame f: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            decisionHandler(f.isMainFrame && trustedJarvisURL(f.request.url) && trustedJarvisURL(w.url) ? .grant : .deny)
        }

        // file pickers (<input type="file">)
        func webView(_ w: WKWebView, runOpenPanelWith p: WKOpenPanelParameters, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
            let panel = NSOpenPanel(); panel.allowsMultipleSelection = p.allowsMultipleSelection; panel.canChooseDirectories = p.allowsDirectories
            panel.begin { completionHandler($0 == .OK ? panel.urls : nil) }
        }

        // alert / confirm / prompt used by the web pages
        func webView(_ w: WKWebView, runJavaScriptAlertPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping () -> Void) {
            let a = NSAlert(); a.messageText = m; a.addButton(withTitle: "OK"); a.runModal(); completionHandler()
        }
        func webView(_ w: WKWebView, runJavaScriptConfirmPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
            let a = NSAlert(); a.messageText = m; a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel"); completionHandler(a.runModal() == .alertFirstButtonReturn)
        }
        func webView(_ w: WKWebView, runJavaScriptTextInputPanelWithPrompt p: String, defaultText d: String?, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
            let a = NSAlert(); a.messageText = p; a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
            let tf = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24)); tf.stringValue = d ?? ""; a.accessoryView = tf
            completionHandler(a.runModal() == .alertFirstButtonReturn ? tf.stringValue : nil)
        }
    }
}

// A background Canvas surface shares WebKit's persistent login store, never its cookies.
// It stays attached to the live app window without covering or navigating the visible browser.
private final class CanvasReadWebView: WKWebView {
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}
private final class CanvasReadSession: NSObject, WKNavigationDelegate {
    let origin: URL
    let webView: WKWebView
    private var ready = false
    private var starting = false
    private var callbacks: [(String?) -> Void] = []
    private var timeout: DispatchWorkItem?
    init(origin: URL, parent: WKWebView) {
        self.origin = origin
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController = WKUserContentController()
        webView = CanvasReadWebView(frame: NSRect(x:0,y:0,width:1,height:1), configuration:config)
        super.init()
        webView.navigationDelegate = self
        webView.alphaValue = 0.01
        webView.setAccessibilityHidden(true)
        parent.addSubview(webView, positioned:.below, relativeTo:nil)
    }
    func prepare(_ completion: @escaping (String?) -> Void) {
        if ready { completion(nil); return }
        callbacks.append(completion)
        if starting { return }
        starting = true
        let deadline = DispatchWorkItem { [weak self] in self?.finish("Canvas background sign-in check timed out. Open Canvas in the Jarvis browser and retry.") }
        timeout = deadline
        DispatchQueue.main.asyncAfter(deadline:.now()+20,execute:deadline)
        // Bootstrap a tiny same-origin API document instead of the dashboard,
        // avoiding unrelated widgets, media, and sign-in checks in embedded frames.
        var bootstrap = URLComponents(url:origin.appendingPathComponent("api/v1/courses"),resolvingAgainstBaseURL:false)!
        bootstrap.queryItems = [URLQueryItem(name:"per_page",value:"1")]
        webView.load(URLRequest(url:bootstrap.url!,timeoutInterval:18))
    }
    private func finish(_ error: String?) {
        timeout?.cancel(); timeout = nil; starting = false; ready = error == nil
        let waiting = callbacks; callbacks.removeAll()
        if error != nil { webView.stopLoading() }
        for completion in waiting { completion(error) }
    }
    func webView(_ w: WKWebView, didFinish n: WKNavigation!) {
        guard w.url?.host == origin.host, w.url?.scheme == "https", w.url?.path.contains("/login") == false else {
            finish("Sign in to Canvas using the Jarvis browser, then retry sync."); return
        }
        finish(nil)
    }
    func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { failed(e) }
    func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { failed(e) }
    private func failed(_ e: Error) { if (e as NSError).code != NSURLErrorCancelled { finish("Canvas could not load in the background. Check the connection or sign in again.") } }
    func webView(_ w: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let u = action.request.url
        let sameOrigin = u?.scheme == "https" && u?.host == origin.host && u?.port == nil
        // Dashboard widgets can navigate their own frames to about:blank or other
        // services. They are not a Canvas sign-in redirect and cannot invalidate
        // the authenticated main frame used by the read-only API adapter.
        guard action.targetFrame?.isMainFrame == true else {
            decisionHandler(sameOrigin ? .allow : .cancel); return
        }
        guard sameOrigin else {
            decisionHandler(.cancel); finish("Canvas needs sign-in. Open it in the Jarvis browser and complete the login."); return
        }
        decisionHandler(.allow)
    }
}

// Public share pages only. A request owns its hidden surface until hydrated text is
// captured, then removes it; the user's visible browser and sign-in remain untouched.
private final class StudyFetchReadRequest: NSObject, WKNavigationDelegate {
    let url: URL
    let sharePrefix: String
    let webView: WKWebView
    private var completion: (([String: Any]?, String?) -> Void)?
    private var timeout: DispatchWorkItem?
    private var previousSignature = ""
    private var stable = 0
    init(url: URL, parent: WKWebView, completion: @escaping ([String: Any]?, String?) -> Void) {
        self.url = url
        sharePrefix = "/" + url.path.split(separator:"/").prefix(4).joined(separator:"/")
        self.completion = completion
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.userContentController = WKUserContentController()
        webView = CanvasReadWebView(frame:NSRect(x:0,y:0,width:1000,height:800),configuration:config)
        super.init()
        webView.navigationDelegate = self
        webView.alphaValue = 0.001; webView.setAccessibilityHidden(true)
        parent.addSubview(webView,positioned:.below,relativeTo:nil)
    }
    func start() {
        let deadline = DispatchWorkItem { [weak self] in self?.finish(nil,"StudyFetch did not finish loading the shared material. Retry or upload its original file.") }
        timeout = deadline; DispatchQueue.main.asyncAfter(deadline:.now()+52,execute:deadline)
        webView.load(URLRequest(url:url,timeoutInterval:30))
    }
    private func finish(_ data: [String: Any]?, _ error: String?) {
        guard let callback = completion else { return }
        completion = nil; timeout?.cancel(); timeout = nil
        webView.stopLoading(); webView.removeFromSuperview()
        callback(data,error)
    }
    private func poll() {
        guard completion != nil else { return }
        let script = #"""
        (()=>{
          const expected=EXPECTED_URL, current=new URL(location.href), target=new URL(expected);
          if(current.origin!==target.origin||current.pathname!==target.pathname)return {_ready:false};
          const full=document.body?.innerText||'', material=target.pathname.includes('/material/');
          const prefix=target.pathname.split('/').slice(0,5).join('/');
          const unique=new Map();for(const a of document.querySelectorAll('a[href]')){try{const u=new URL(a.href,location.href);if(u.origin===target.origin&&u.pathname.startsWith(prefix+'/material/')&&/^\/share\/feature\/studyset\/[A-Za-z0-9_-]+\/material\/[A-Za-z0-9_-]+$/.test(u.pathname)){u.search='';u.hash='';unique.set(u.href,{href:u.href,text:(a.innerText||'').slice(0,500)});}}catch{}}
          const links=[...unique.values()];
          const marker='Back to Notes & Materials', start=full.indexOf(marker);
          let materialBody=start<0?'':full.slice(start+marker.length).split('Create an Account to Clone This')[0].split('Frequently asked questions')[0].trim();
          const countMatch=full.match(/(?:^|\n)\s*([\d,]+)\s+(?:notes\s*(?:&|and)\s*(?:materials)?|materials)(?:\s|$)/i);
          const materialCount=countMatch?Number(countMatch[1].replaceAll(',','')):null;
          const ready=material?start>=0&&materialBody.length>=40&&!/^(?:loading|please wait|enhanced\s*loading)[.\s…]*$/i.test(materialBody):/Notes & Materials/.test(full)&&full.includes('Back to Study Set')&&(links.length>0||materialCount===0);
          if(!ready)return {_ready:false};
          const bytes=new TextEncoder().encode(full), limit=3*1024*1024;
          return {_ready:true,url:current.href,title:document.title,text:bytes.length>limit?new TextDecoder().decode(bytes.slice(0,limit)):full,links:links.slice(0,1000),materialCount,observedMaterialCount:links.length,truncated:bytes.length>limit||links.length>1000||(materialCount!==null&&!material&&links.length<materialCount),enhanced:material&&/^Enhanced(?:\s|$)/i.test(materialBody)};
        })()
        """#
        webView.evaluateJavaScript(script.replacingOccurrences(of:"EXPECTED_URL",with:jsJSON(url.absoluteString))) { [weak self] value, error in
            guard let self, self.completion != nil else { return }
            if error == nil, var data = value as? [String: Any], data["_ready"] as? Bool == true {
                let text = data["text"] as? String ?? ""
                let signature = "\(text.count):\((data["links"] as? [Any])?.count ?? 0):\(text.suffix(160))"
                self.stable = signature == self.previousSignature ? self.stable + 1 : 0
                self.previousSignature = signature
                if self.stable >= 2 {
                    data.removeValue(forKey:"_ready"); self.finish(data,nil); return
                }
            }
            DispatchQueue.main.asyncAfter(deadline:.now()+0.7) { [weak self] in self?.poll() }
        }
    }
    func webView(_ w: WKWebView, didFinish n: WKNavigation!) { poll() }
    func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { failed(e) }
    func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { failed(e) }
    private func failed(_ e: Error) { if (e as NSError).code != NSURLErrorCancelled { finish(nil,"StudyFetch could not load the shared page. Check that it is publicly accessible.") } }
    func webView(_ w: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard action.targetFrame?.isMainFrame == true else { decisionHandler(.cancel); return }
        guard let u = action.request.url,u.scheme == "https",u.host == "www.studyfetch.com",u.port == nil,u.path == url.path,u.query == nil else {
            decisionHandler(.cancel); finish(nil,"StudyFetch redirected outside the requested public material. Check its sharing settings."); return
        }
        decisionHandler(.allow)
    }
}

// A separate WebKit instance: no native bridge or Jarvis user scripts are installed here.
final class BrowserWorkspace: ObservableObject {
    weak var owner: WebModel? { didSet { reader.owner = owner } }
    @Published var windows: [BrowserWindow] = []
    @Published var activeWindowId: String?
    private let reader = BrowserWindow()
    private var layer = 0.0
    @discardableResult func create(configuration: WKWebViewConfiguration? = nil, present: Bool = true) -> BrowserWindow {
        let window = BrowserWindow(configuration:configuration)
        window.owner = owner; window.workspace = self; window.visible = present
        windows.append(window)
        if present || activeWindowId == nil { focus(window) }
        sync(); return window
    }
    func focus(_ window: BrowserWindow) {
        guard windows.contains(where: { $0.id == window.id }) else { return }
        layer += 1; window.zOrder = layer; activeWindowId = window.id; sync()
    }
    func remove(_ window: BrowserWindow) {
        windows.removeAll { $0.id == window.id }
        if activeWindowId == window.id { activeWindowId = windows.max(by: { $0.zOrder < $1.zOrder })?.id }
        sync()
    }
    func open(_ url: String, id: String? = nil, present: Bool = true) {
        let window = create(present:present); window.open(url,id:id,present:present)
    }
    func sync() {
        var state = windows.first { $0.id == activeWindowId }?.descriptor ?? ["visible":false,"minimized":false]
        state["windows"] = windows.map { $0.descriptor }
        state["activeWindowId"] = activeWindowId as Any? ?? NSNull()
        reader.emit("jarvis:workspace-state",state)
    }
    func command(_ c: [String:Any]) {
        let id = c["id"] as? String, action = c["action"] as? String ?? ""
        if ["canvas-read","canvas-file","studyfetch-read"].contains(action) { reader.command(c); return }
        if action == "list" { reader.reply(id,["windows":windows.map { $0.descriptor },"activeWindowId":activeWindowId as Any? ?? NSNull()]); return }
        let requested = c["windowId"] as? String
        if action == "open", requested == nil { open(c["url"] as? String ?? "",id:id,present:c["present"] as? Bool ?? true); return }
        guard let window = windows.first(where: { $0.id == (requested ?? activeWindowId) }) else { reader.reply(id,error:requested == nil ? "Open a browser window first." : "This browser window is no longer open."); return }
        if action == "restore" { focus(window) }
        window.command(c)
    }
}

final class BrowserWindow: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    weak var owner: WebModel?
    weak var workspace: BrowserWorkspace?
    let id = UUID().uuidString
    @Published var zOrder = 0.0
    var descriptor: [String: Any] { ["windowId":id,"visible":visible,"minimized":minimized,"url":address,"title":title,"loading":loading,"canGoBack":back,"canGoForward":forward,"error":error as Any? ?? NSNull()] }
    @Published var visible = false
    @Published var minimized = false
    @Published var address = ""
    @Published var title = "Browser workspace"
    @Published var loading = false
    @Published var back = false
    @Published var forward = false
    @Published var error: String?
    let webView: WKWebView
    private var pendingID: String?
    private var timeout: DispatchWorkItem?
    private var observations: [NSKeyValueObservation] = []
    private var canvasSessions: [String: CanvasReadSession] = [:]
    private var studyFetchRequests: [UUID: StudyFetchReadRequest] = [:]
    init(configuration: WKWebViewConfiguration? = nil) {
        let cfg = configuration ?? WKWebViewConfiguration()
        if configuration == nil { cfg.websiteDataStore = .default(); cfg.userContentController = WKUserContentController() }
        webView = WKWebView(frame: .zero, configuration: cfg)
        super.init()
        webView.navigationDelegate = self; webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        observations = [webView.observe(\.isLoading, options: [.new]) { [weak self] _, _ in self?.sync() }, webView.observe(\.title, options: [.new]) { [weak self] _, _ in self?.sync() }, webView.observe(\.url, options: [.new]) { [weak self] _, _ in self?.sync() }]
    }
    func sync() {
        loading = webView.isLoading; title = webView.title ?? "Browser workspace"
        address = webView.url?.absoluteString ?? address
        back = webView.canGoBack; forward = webView.canGoForward
        workspace?.sync()
    }
    func emit(_ name: String, _ detail: [String: Any]) {
        guard let owner, trustedJarvisURL(owner.webView.url) else { return }
        owner.run("window.dispatchEvent(new CustomEvent(\(jsJSON(name)),{detail:\(jsJSON(detail))}))")
    }
    func reply(_ id: String?, _ result: Any? = nil, error message: String? = nil) {
        guard let id else { return }
        var value: [String: Any] = ["id":id,"ok":message == nil]
        if let message { value["error"] = message } else { value["result"] = result ?? descriptor }
        if workspace != nil { value["windowId"] = self.id; if var result = value["result"] as? [String: Any] { result["windowId"] = self.id; value["result"] = result } }
        emit("jarvis:workspace-result",value)
    }
    func finish(_ message: String? = nil) {
        timeout?.cancel(); timeout = nil
        let id = pendingID; pendingID = nil; sync(); reply(id,error: message)
    }
    func open(_ value: String, id: String? = nil, present: Bool = true) {
        guard let url = URL(string:value), ["http","https"].contains(url.scheme?.lowercased() ?? ""), url.host != nil, url.user == nil, url.password == nil else {
            error = "Use a complete http:// or https:// web address."; reply(id,error:error); sync(); return
        }
        if pendingID != nil { finish("Navigation was replaced by another request.") }
        visible = present; minimized = false; error = nil; address = value; pendingID = id
        webView.load(URLRequest(url:url,timeoutInterval:45)); sync()
        let task = DispatchWorkItem { [weak self] in self?.finish("The website took too long to load. You can retry inside the browser workspace.") }
        timeout = task; DispatchQueue.main.asyncAfter(deadline:.now()+50,execute:task)
    }
    func close() {
        webView.stopLoading(); finish("Browser workspace closed."); visible = false; minimized = false; sync(); workspace?.remove(self)
    }
    // Narrow read-only adapter: the website keeps its cookies and handles authentication.
    // Neither the server nor Jarvis JavaScript receives browser credentials.
    func canvasCommand(_ c: [String: Any], id: String?) {
        guard let origin = c["origin"] as? String, let expected = URL(string: origin),
              expected.scheme == "https", expected.host?.hasSuffix(".instructure.com") == true,
              expected.user == nil, expected.password == nil, expected.port == nil,
              expected.path.isEmpty || expected.path == "/",
              expected.query == nil, expected.fragment == nil, let parent = owner?.webView else {
            reply(id, error: "Use a valid Canvas institution HTTPS origin and sign in through Jarvis."); return
        }
        let session: CanvasReadSession
        if let existing = canvasSessions[origin] { session = existing }
        else { session = CanvasReadSession(origin: expected, parent: parent); canvasSessions[origin] = session }
        let action = c["action"] as? String ?? ""
        let args: [String: Any] = ["origin":origin,"action":action,"path":c["path"] as? String ?? "", "courseId":c["courseId"] as? String ?? "","fileId":c["fileId"] as? String ?? ""]
        let script = #"""
        if(location.origin!==origin || location.pathname.includes('/login')) throw new Error('Sign in to Canvas inside the Jarvis browser.');
        const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),45000);
        const allowed=/^\/api\/v1\/(?:courses(?:\/\d+(?:\/(?:pages(?:\/[^/]+)?|modules(?:\/\d+(?:\/items(?:\/\d+)?)?)?|files(?:\/\d+)?|assignments(?:\/\d+)?|discussion_topics(?:\/\d+(?:\/view)?)?))?)?|calendar_events|announcements)$/;
        function checkPath(value) {
          if(typeof value!=='string'||!value.startsWith('/api/v1/')||value.length>2000)throw new Error('Invalid Canvas API path');
          const u=new URL(value,origin);
          if(u.origin!==origin||u.hash||!allowed.test(u.pathname))throw new Error('Canvas endpoint is not permitted');
          if(u.pathname.includes('/pages/')){let slug;try{slug=decodeURIComponent(u.pathname.split('/pages/')[1]);}catch{throw new Error('Invalid Canvas page slug');}if(!slug||slug==='.'||slug==='..'||/[\/\\\u0000-\u001f\u007f]/.test(slug))throw new Error('Invalid Canvas page slug');}
          const keys=new Set(['page','per_page','include[]','only_announcements','context_codes[]','start_date','end_date','type','enrollment_state','state[]','published','all_events']);
          for(const [k,v]of u.searchParams){if(!keys.has(k)||v.length>160)throw new Error('Unsupported Canvas query');if(k==='context_codes[]'&&!/^course_\d+$/.test(v))throw new Error('Course context required');}
          if(['/api/v1/calendar_events','/api/v1/announcements'].includes(u.pathname)&&!u.searchParams.getAll('context_codes[]').length)throw new Error('Course context required');
          return u;
        }
        async function bytes(response,limit){
          if(Number(response.headers.get('content-length'))>limit)throw new Error('Canvas material exceeds the import size limit');
          if(!response.body)throw new Error('Canvas returned no content');
          const reader=response.body.getReader(),chunks=[];let size=0;
          while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new Error('Canvas material exceeds the import size limit');}chunks.push(value);}
          const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
        }
        async function json(value){
          const u=checkPath(value),r=await fetch(u.href,{method:'GET',credentials:'same-origin',signal:controller.signal,headers:{Accept:'application/json'}});
          // Preserve permission and missing-index status for the course importer.
          // Never return error bodies: they may contain private institution details.
          if(!r.ok&&action==='canvas-read')return {status:r.status};
          if(r.status===401)throw new Error('Canvas sign-in expired. Sign in again in Jarvis desktop.');
          if(r.status===403)throw new Error('Canvas does not permit this file for your account. Ask the course administrator for access or upload an authorized copy.');
          if(!r.ok)throw new Error('Canvas returned HTTP '+r.status);
          if(new URL(r.url).origin!==origin||new URL(r.url).pathname.includes('/login')||!r.headers.get('content-type')?.includes('json'))throw new Error('Canvas login expired or this page is not API data. Sign in inside Jarvis.');
          const data=JSON.parse(new TextDecoder().decode(await bytes(r,4*1024*1024)));
          const next=(r.headers.get('link')||'').split(',').find(v=>/rel="next"/.test(v));let nextPath=null;
          if(next){const match=next.match(/<([^>]+)>/);if(match){const n=new URL(match[1],origin);if(n.origin!==origin||n.pathname!==u.pathname)throw new Error('Canvas pagination left the requested endpoint');nextPath=checkPath(n.pathname+n.search).pathname+n.search;}}
          return {status:r.status,data,nextPath};
        }
        try {
          if(action==='canvas-read')return await json(path);
          if(action!=='canvas-file'||!/^\d+$/.test(courseId)||!/^\d+$/.test(fileId))throw new Error('Numeric course and file IDs required');
          const metadata=(await json('/api/v1/courses/'+courseId+'/files/'+fileId)).data;
          if(String(metadata.id)!==fileId||metadata.locked_for_user)throw new Error('Canvas file is unavailable to this account');
          if(Number(metadata.size)>12*1024*1024)throw new Error('Canvas file exceeds the 12 MB import limit');
          const url=new URL(metadata.url);if(url.protocol!=='https:'||url.username||url.password)throw new Error('Canvas file URL must use HTTPS');
          const r=await fetch(url.href,{method:'GET',credentials:'same-origin',signal:controller.signal});
          if(!r.ok)throw new Error('Canvas file download returned HTTP '+r.status);
          if(new URL(r.url).protocol!=='https:'||new URL(r.url).pathname.includes('/login'))throw new Error('Canvas download requires sign-in');
          const body=await bytes(r,12*1024*1024);let binary='';for(let i=0;i<body.length;i+=32768)binary+=String.fromCharCode(...body.subarray(i,i+32768));
          return {filename:String(metadata.filename||metadata.display_name||'canvas-file'),contentType:r.headers.get('content-type')||metadata['content-type']||'application/octet-stream',base64:btoa(binary)};
        } catch(error) {
          if(error.name==='AbortError')return {_canvasError:'Canvas request timed out. Retry when the connection is available.'};
          if(error instanceof TypeError)return {_canvasError:'Canvas browser download was blocked by the website or network. Use the Canvas API connection or upload the file.'};
          if(error instanceof SyntaxError)return {_canvasError:'Canvas returned invalid API data. Sign in again.'};
          return {_canvasError:error.message};
        } finally {clearTimeout(timer);}
        """#
        session.prepare { [weak self] failure in
            guard let self else { return }
            if let failure { self.reply(id,error:failure); return }
            session.webView.callAsyncJavaScript(script, arguments:args, in:nil, in:.page) { [weak self] result in
            switch result {
            case .success(let data):
                if let response = data as? [String: Any], let message = response["_canvasError"] as? String { self?.reply(id,error:message) }
                else { self?.reply(id,data) }
            case .failure: self?.reply(id,error:"Canvas browser request failed. Check your sign-in, course access, or use the API connection/upload for blocked downloads.")
            }
            }
        }
    }
    func studyFetchCommand(_ c: [String: Any], id: String?) {
        guard let value = c["url"] as? String, let url = URL(string:value), url.scheme == "https",
              url.host == "www.studyfetch.com",url.port == nil,url.user == nil,url.password == nil,url.query == nil,url.fragment == nil,
              url.path.range(of:#"^/share/feature/studyset/[A-Za-z0-9_-]+/(?:notes|material/[A-Za-z0-9_-]+)$"#,options:.regularExpression) != nil,
              let parent = owner?.webView else { reply(id,error:"Use a public StudyFetch notes or material link."); return }
        guard studyFetchRequests.count < 4 else { reply(id,error:"StudyFetch reader is busy. Retry when the current imports finish."); return }
        let key = UUID()
        let request = StudyFetchReadRequest(url:url,parent:parent) { [weak self] data,error in
            self?.reply(id,data,error:error); self?.studyFetchRequests.removeValue(forKey:key)
        }
        studyFetchRequests[key] = request; request.start()
    }
    func command(_ c: [String:Any]) {
        let id = c["id"] as? String
        guard let action = c["action"] as? String else { reply(id,error:"Missing browser action."); return }
        switch action {
        case "canvas-read", "canvas-file": canvasCommand(c, id:id)
        case "studyfetch-read": studyFetchCommand(c, id:id)
        case "open", "navigate": open(c["url"] as? String ?? "",id:id,present:c["present"] as? Bool ?? true)
        case "close": close(); reply(id)
        case "minimize": minimized = true; sync(); reply(id)
        case "restore": visible = true; minimized = false; sync(); reply(id)
        case "back": webView.goBack(); sync(); reply(id)
        case "forward": webView.goForward(); sync(); reply(id)
        case "reload": webView.reload(); sync(); reply(id)
        case "read", "click", "type":
            guard webView.url != nil else { reply(id,error:"Open a website first."); return }
            let script: String
            if action == "read" {
                script = "({url:location.href,title:document.title,text:(document.body?.innerText||'').slice(0,40000),links:Array.from(document.querySelectorAll('a[href]')).slice(0,150).map(a=>({text:a.innerText.slice(0,160),href:a.href}))})"
            } else {
                guard let selector = c["selector"] as? String, !selector.isEmpty, selector.count < 2000 else { reply(id,error:"A CSS selector is required."); return }
                let prefix = "(()=>{const e=document.querySelector(\(jsJSON(selector)));if(!e)throw new Error('Element not found');e.scrollIntoView({block:'center'});"
                if action == "click" { script = prefix + "e.click();return {clicked:true}})()" }
                else {
                    let text = c["text"] as? String ?? ""
                    guard text.count <= 50000 else { reply(id,error:"Text is too long."); return }
                    script = prefix + "if(!(e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement)||e.type==='file'||e.type==='password')throw new Error('Use the browser directly for this field');const p=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,\(jsJSON(text)));e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return {typed:true}})()"
                }
            }
            webView.evaluateJavaScript(script) { [weak self] result, failure in self?.reply(id,result,error:failure?.localizedDescription) }
        default: reply(id,error:"Unsupported browser action.")
        }
    }
    func webView(_ w: WKWebView, didFinish n: WKNavigation!) { error = nil; finish() }
    func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { failed(e) }
    func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { failed(e) }
    func failed(_ e: Error) { if (e as NSError).code != NSURLErrorCancelled { error = e.localizedDescription; finish(error) } }
    func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy)->Void) {
        guard let url = a.request.url else { decisionHandler(.cancel); return }
        if a.shouldPerformDownload { decisionHandler(.download); return }
        if ["http","https","about","blob"].contains(url.scheme ?? "") { decisionHandler(.allow) }
        else { error = "This link requires an external app and cannot open in the browser workspace."; sync(); decisionHandler(.cancel); finish(error) }
    }
    func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures f: WKWindowFeatures)->WKWebView? {
        guard a.targetFrame == nil else { return nil }
        return workspace?.create(configuration:c, present:visible && !minimized).webView
    }
    func webViewDidClose(_ webView: WKWebView) { close() }
    func webView(_ w: WKWebView, requestMediaCapturePermissionFor o: WKSecurityOrigin, initiatedByFrame f: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision)->Void) { decisionHandler(.prompt) }
    func webView(_ w: WKWebView, decidePolicyFor r: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy)->Void) { decisionHandler(r.canShowMIMEType ? .allow : .download) }
    func webView(_ w: WKWebView, navigationAction a: WKNavigationAction, didBecome d: WKDownload) { d.delegate = self }
    func webView(_ w: WKWebView, navigationResponse r: WKNavigationResponse, didBecome d: WKDownload) { d.delegate = self }
    func download(_ d: WKDownload, decideDestinationUsing r: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?)->Void) {
        let dir = FileManager.default.urls(for:.downloadsDirectory,in:.userDomainMask)[0]
        let name = URL(fileURLWithPath:suggestedFilename).lastPathComponent
        var dest = dir.appendingPathComponent(name); var i = 1
        while FileManager.default.fileExists(atPath:dest.path) { dest = dir.appendingPathComponent("\(i)-\(name)"); i += 1 }
        completionHandler(dest)
    }
    func downloadDidFinish(_ d: WKDownload) { error = "Download saved to your Downloads folder."; sync() }
    func download(_ d: WKDownload, didFailWithError failure: Error, resumeData: Data?) { error = "Download failed: " + failure.localizedDescription; sync() }
    private func websiteAlert(_ message: String) -> NSAlert {
        let alert = NSAlert(); alert.messageText = webView.url?.host ?? "Website"; alert.informativeText = message; return alert
    }
    func webView(_ w: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = websiteAlert(message); alert.addButton(withTitle:"OK")
        if let window = w.window { alert.beginSheetModal(for:window) { _ in completionHandler() } } else { completionHandler() }
    }
    func webView(_ w: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = websiteAlert(message); alert.addButton(withTitle:"OK"); alert.addButton(withTitle:"Cancel")
        if let window = w.window { alert.beginSheetModal(for:window) { completionHandler($0 == .alertFirstButtonReturn) } } else { completionHandler(false) }
    }
    func webView(_ w: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText value: String?, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let alert = websiteAlert(prompt); alert.addButton(withTitle:"OK"); alert.addButton(withTitle:"Cancel")
        let field = NSTextField(frame:NSRect(x:0,y:0,width:320,height:24)); field.stringValue = value ?? ""; alert.accessoryView = field
        if let window = w.window { alert.beginSheetModal(for:window) { completionHandler($0 == .alertFirstButtonReturn ? field.stringValue : nil) } } else { completionHandler(nil) }
    }
    func webView(_ w: WKWebView, runOpenPanelWith p: WKOpenPanelParameters, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping ([URL]?)->Void) {
        let panel = NSOpenPanel(); panel.allowsMultipleSelection = p.allowsMultipleSelection; panel.canChooseDirectories = p.allowsDirectories
        panel.begin { completionHandler($0 == .OK ? panel.urls : nil) }
    }
}

struct BrowserSurface: NSViewRepresentable {
    let model: BrowserWindow
    func makeNSView(context: Context)->WKWebView { model.webView }
    func updateNSView(_ view: WKWebView, context: Context) {}
}
struct BrowserWorkspacePane: View {
    @ObservedObject var model: BrowserWindow
    @State private var input = ""
    var move: (CGSize, Bool) -> Void
    var moveStep: (CGFloat, CGFloat) -> Void
    var reset: () -> Void
    var body: some View {
        VStack(spacing:0) {
            HStack(spacing:10) {
                Image(systemName:"globe").foregroundStyle(.cyan)
                VStack(alignment:.leading,spacing:3) { Text("BROWSER WORKSPACE").font(.system(size:10,weight:.semibold,design:.rounded)).tracking(1.5).foregroundStyle(.secondary); Text(model.title).font(.system(size:12,weight:.medium)).lineLimit(1) }
                Spacer()
                Menu {
                    Button("Move left") { moveStep(-40, 0) }
                    Button("Move right") { moveStep(40, 0) }
                    Button("Move up") { moveStep(0, -40) }
                    Button("Move down") { moveStep(0, 40) }
                    Divider()
                    Button("Reset size and position", action: reset)
                } label: { Image(systemName:"arrow.up.and.down.and.arrow.left.and.right") }
                    .menuStyle(.borderlessButton).fixedSize().help("Position browser")
                Button { model.workspace?.open("https://www.google.com") } label: { Image(systemName:"plus") }.help("New browser window")
                Button { model.minimized = true; model.sync() } label: { Image(systemName:"minus") }.help("Minimize browser")
                Button { model.close() } label: { Image(systemName:"xmark") }.help("Close browser")
            }.buttonStyle(.plain).padding(14)
                .background(Color.white.opacity(0.025))
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 3).onChanged { move($0.translation, false) }.onEnded { move($0.translation, true) })
                .help("Drag to move this browser inside Jarvis")
            HStack(spacing:10) {
                Button { model.webView.goBack() } label: { Image(systemName:"chevron.left") }.disabled(!model.back).help("Back")
                Button { model.webView.goForward() } label: { Image(systemName:"chevron.right") }.disabled(!model.forward).help("Forward")
                TextField("https://…",text:$input).textFieldStyle(.roundedBorder).onSubmit { model.open(input.contains("://") ? input : "https://"+input) }
                Button { if model.loading { model.webView.stopLoading(); model.finish("Navigation stopped.") } else { model.webView.reload() } } label: { Image(systemName:model.loading ? "xmark" : "arrow.clockwise") }.help(model.loading ? "Stop loading" : "Reload")
            }.buttonStyle(.plain).padding(.horizontal,14).padding(.vertical,12)
            if model.loading { ProgressView().progressViewStyle(.linear).tint(.cyan).frame(height:2) }
            if let error = model.error { Text(error).font(.caption).foregroundStyle(.secondary).padding(10).frame(maxWidth:.infinity,alignment:.leading) }
            BrowserSurface(model:model)
        }.background(Color(red:0.043,green:0.057,blue:0.082)).clipShape(RoundedRectangle(cornerRadius:16)).overlay(RoundedRectangle(cornerRadius:16).stroke(Color.white.opacity(0.09),lineWidth:1))
        .onAppear { input = model.address }.onChange(of:model.address) { _, value in input = value }
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
