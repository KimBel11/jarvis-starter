import SwiftUI
import WebKit
import UserNotifications
import ServiceManagement
import AVFoundation

// Jarvis for Mac: a native window around your own Jarvis server (it runs in the background as a login item).
// Dock icon, menu-bar orb, Cmd+R reload, microphone for voice, file pickers, downloads, open at login.

enum Prefs {
    static let defaultServer = "http://localhost:4777"
    static var server: String {
        get { UserDefaults.standard.string(forKey: "server") ?? defaultServer }
        set { UserDefaults.standard.set(newValue, forKey: "server") }
    }
}

let jarvisBG = NSColor(red: 0.027, green: 0.035, blue: 0.051, alpha: 1)

@main
struct JarvisMacApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var delegate
    @StateObject private var web = WebModel.shared

    var body: some Scene {
        WindowGroup {
            RootView(model: web)
                .frame(minWidth: 460, minHeight: 620)
                .background(WindowConfigurator())
                .preferredColorScheme(.dark)
        }
        .commands {
            CommandGroup(replacing: .newItem) { Button("New browser window") { web.workspace.open("https://www.google.com") }.keyboardShortcut("n") }
            CommandMenu("Jarvis") {
                Button("Reload") { web.reload() }.keyboardShortcut("r")
                Button("Control center") { web.go("#/control") }.keyboardShortcut("1")
                Button("Agent team") { web.go("#/team") }.keyboardShortcut("2")
                Button("Tools & integrations") { web.go("#/tools") }.keyboardShortcut("3")
                Divider()
                Button("Talk to @@ASSISTANT@@ (tap the orb)") { web.run("Jarvis.orbTap && Jarvis.orbTap()") }.keyboardShortcut("j")
                Divider()
                Button("Restart the Jarvis server") { web.restartServer() }
                Button("Open browser workspace") { web.workspace.open("https://www.google.com") }
            }
        }
        Settings { SettingsView(model: web) }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    var statusItem: NSStatusItem?
    func application(_ application: NSApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) { NativeNotifications.shared.received(deviceToken) }
    func application(_ application: NSApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) { NativeNotifications.shared.failed(error) }

    func applicationDidFinishLaunching(_ n: Notification) {
        // ask macOS for microphone access right away so the voice works the first time you tap the orb
        if AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined { AVCaptureDevice.requestAccess(for: .audio) { _ in } }
        let it = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let b = it.button {
            let s = NSSize(width: 16, height: 16)
            let img = NSImage(size: s, flipped: false) { r in
                NSColor(red: 0.18, green: 0.83, blue: 0.93, alpha: 1).setFill()
                NSBezierPath(ovalIn: r.insetBy(dx: 2, dy: 2)).fill()
                NSColor(red: 0.9, green: 0.98, blue: 1, alpha: 0.9).setFill()
                NSBezierPath(ovalIn: NSRect(x: 5, y: 8, width: 4, height: 4)).fill()
                return true
            }
            b.image = img; b.toolTip = "Jarvis"
        }
        let m = NSMenu()
        m.addItem(withTitle: "Open Jarvis", action: #selector(showWindow), keyEquivalent: "").target = self
        m.addItem(withTitle: "Talk to @@ASSISTANT@@", action: #selector(talk), keyEquivalent: "").target = self
        m.addItem(.separator())
        m.addItem(withTitle: "Restart the Jarvis server", action: #selector(restart), keyEquivalent: "").target = self
        m.addItem(withTitle: "Open browser workspace", action: #selector(browser), keyEquivalent: "").target = self
        m.addItem(.separator())
        m.addItem(withTitle: "Quit Jarvis", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        it.menu = m; statusItem = it
    }
    // closing the window keeps Jarvis in the menu bar; the Dock icon brings the window back
    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ s: NSApplication, hasVisibleWindows f: Bool) -> Bool { if !f { showWindow() }; return true }

    @objc func showWindow() {
        NSApp.activate(ignoringOtherApps: true)
        if let w = NSApp.windows.first(where: { $0.canBecomeMain }) { w.makeKeyAndOrderFront(nil) }
    }
    @objc func talk() { showWindow(); WebModel.shared.run("Jarvis.orbTap && Jarvis.orbTap()") }
    @objc func restart() { WebModel.shared.restartServer() }
    @objc func browser() { showWindow(); WebModel.shared.workspace.open("https://www.google.com") }
}

// remembers the window size and matches the dark look
struct WindowConfigurator: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let v = NSView()
        DispatchQueue.main.async {
            guard let w = v.window else { return }
            w.setFrameAutosaveName("JarvisMain")
            w.titlebarAppearsTransparent = true
            w.backgroundColor = jarvisBG
            w.isMovableByWindowBackground = false
            if w.frame.width < 900 { w.setContentSize(NSSize(width: 1320, height: 860)); w.center() }
        }
        return v
    }
    func updateNSView(_ v: NSView, context: Context) {}
}

struct RootView: View {
    @ObservedObject var model: WebModel
    var body: some View { WorkspaceLayout(model:model, browser:model.workspace) }
}
struct WorkspaceLayout: View {
    @ObservedObject var model: WebModel
    @ObservedObject var browser: BrowserWorkspace
    var body: some View {
        ZStack(alignment:.topLeading) {
            ZStack { Color(jarvisBG).ignoresSafeArea(); WebContainer(model:model); if model.failed != nil { ErrorView(model:model) } }
            ForEach(browser.windows, id: \.id) { window in
                BrowserFloatingWindow(browser:window).zIndex(window.zOrder + 1)
            }
        }.background(Color(jarvisBG))
    }
}
// A floating surface leaves the Jarvis canvas and its navigation geometry intact.
struct BrowserFloatingWindow: View {
    @ObservedObject var browser: BrowserWindow
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var position = CGPoint(x: 0, y: 0)
    @State private var popupSize = CGSize(width: 720, height: 530)
    @State private var dragStart: CGPoint?
    @State private var resizeStart: CGSize?
    @State private var placed = false
    @State private var pillDragStart: CGPoint?
    @State private var pillX = -1.0
    @State private var pillY = -1.0
    private let pillSize = CGSize(width: 340, height: 44)

    private func pillPosition(in canvas: CGSize) -> CGPoint {
        let x = pillX < 0 ? 40 : 16 + CGFloat(min(1, max(0, pillX))) * max(0, canvas.width - pillSize.width - 32)
        let y = pillY < 0 ? 20 + CGFloat((browser.workspace?.windows.firstIndex(where: { $0.id == browser.id }) ?? 0) % 10) * 52 : 16 + CGFloat(min(1, max(0, pillY))) * max(0, canvas.height - pillSize.height - 32)
        return boundedPosition(CGPoint(x: x, y: y), size: pillSize, in: canvas)
    }
    private func movePill(to value: CGPoint, in canvas: CGSize) {
        let p = boundedPosition(value, size: pillSize, in: canvas)
        pillX = Double((p.x - 16) / max(1, canvas.width - pillSize.width - 32))
        pillY = Double((p.y - 16) / max(1, canvas.height - pillSize.height - 32))
    }
    private func minimizedPill(in canvas: CGSize) -> some View {
        let position = pillPosition(in: canvas)
        return HStack(spacing: 10) {
            Image(systemName: "line.3.horizontal")
                .foregroundStyle(.secondary).frame(width: 24, height: 32)
                .contentShape(Rectangle()).help("Drag to move minimized browser")
                .accessibilityLabel("Move minimized browser using the position menu")
                .gesture(DragGesture(minimumDistance: 3).onChanged { value in
                    if pillDragStart == nil { browser.workspace?.focus(browser); pillDragStart = pillPosition(in: canvas) }
                    let start = pillDragStart ?? position
                    movePill(to: CGPoint(x: start.x + value.translation.width, y: start.y + value.translation.height), in: canvas)
                }.onEnded { _ in pillDragStart = nil })
            Button { browser.workspace?.focus(browser); browser.minimized = false; browser.sync() } label: {
                Label(browser.title, systemImage: "globe").lineLimit(1).frame(maxWidth: .infinity, alignment: .leading)
            }.help("Restore browser")
            Menu {
                Button("Move left") { movePill(to: CGPoint(x: position.x - 40, y: position.y), in: canvas) }
                Button("Move right") { movePill(to: CGPoint(x: position.x + 40, y: position.y), in: canvas) }
                Button("Move up") { movePill(to: CGPoint(x: position.x, y: position.y - 40), in: canvas) }
                Button("Move down") { movePill(to: CGPoint(x: position.x, y: position.y + 40), in: canvas) }
                Divider()
                Button("Reset position") { pillX = -1; pillY = -1 }
            } label: { Image(systemName: "arrow.up.and.down.and.arrow.left.and.right") }
                .menuStyle(.borderlessButton).fixedSize().help("Position minimized browser")
                .accessibilityLabel("Position minimized browser")
            Button { browser.close() } label: { Image(systemName: "xmark") }.help("Close browser")
        }.buttonStyle(.plain).font(.system(size: 12, weight: .medium))
            .padding(.horizontal, 12).frame(width: pillSize.width, height: pillSize.height)
            .background(Color(red:0.043,green:0.057,blue:0.082), in: Capsule())
            .overlay(Capsule().stroke(Color.white.opacity(0.14)))
            .shadow(color: .black.opacity(0.3), radius: 16, y: 5)
            .offset(x: position.x, y: position.y)
    }

    private func boundedSize(_ value: CGSize, in canvas: CGSize) -> CGSize {
        CGSize(width: min(max(400, value.width), max(1, canvas.width - 32)),
               height: min(max(320, value.height), max(1, canvas.height - 32)))
    }
    private func boundedPosition(_ value: CGPoint, size: CGSize, in canvas: CGSize) -> CGPoint {
        CGPoint(x: max(16, min(value.x, canvas.width - size.width - 16)),
                y: max(16, min(value.y, canvas.height - size.height - 16)))
    }
    private func fit(_ canvas: CGSize) {
        popupSize = boundedSize(popupSize, in: canvas)
        if !placed {
            position = CGPoint(x: (canvas.width - popupSize.width) / 2 + CGFloat(Int(browser.zOrder - 1) % 5) * 28, y: max(24, (canvas.height - popupSize.height) * 0.35) + CGFloat(Int(browser.zOrder - 1) % 5) * 28)
            placed = true
        }
        position = boundedPosition(position, size: popupSize, in: canvas)
    }
    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .topLeading) {
                // Keep the same WebKit instance mounted, including during background work.
                // Opacity/hit-testing hide it without discarding a login, form, or navigation.
                BrowserWorkspacePane(model: browser, move: { delta, ended in
                    if dragStart == nil { browser.workspace?.focus(browser); dragStart = position }
                    let origin = dragStart ?? position
                    position = boundedPosition(CGPoint(x: origin.x + delta.width, y: origin.y + delta.height), size: popupSize, in: geometry.size)
                    if ended { dragStart = nil }
                }, moveStep: { dx, dy in
                    position = boundedPosition(CGPoint(x: position.x + dx, y: position.y + dy), size: popupSize, in: geometry.size)
                }, reset: {
                    popupSize = boundedSize(CGSize(width: 720, height: 530), in: geometry.size)
                    placed = false; fit(geometry.size)
                })
                .frame(width: popupSize.width, height: popupSize.height)
                .overlay(alignment: .bottomTrailing) {
                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                        .font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary)
                        .frame(width: 30, height: 26).background(Color(red:0.043,green:0.057,blue:0.082))
                        .clipShape(RoundedRectangle(cornerRadius: 8)).padding(4)
                        .contentShape(Rectangle())
                        .gesture(DragGesture(minimumDistance: 1).onChanged { value in
                            if resizeStart == nil { browser.workspace?.focus(browser); resizeStart = popupSize }
                            let start = resizeStart ?? popupSize
                            let available = CGSize(width: geometry.size.width - position.x + 16, height: geometry.size.height - position.y + 16)
                            popupSize = boundedSize(CGSize(width: start.width + value.translation.width, height: start.height + value.translation.height), in: available)
                        }.onEnded { _ in resizeStart = nil; fit(geometry.size) })
                        .accessibilityLabel("Resize browser")
                        .accessibilityAdjustableAction { direction in
                            let delta: CGFloat = direction == .increment ? 60 : -60
                            popupSize = boundedSize(CGSize(width: popupSize.width + delta, height: popupSize.height + delta), in: geometry.size)
                            fit(geometry.size)
                        }
                }
                .shadow(color: .black.opacity(0.48), radius: 32, y: 12)
                .offset(x: position.x, y: position.y)
                .simultaneousGesture(TapGesture().onEnded { browser.workspace?.focus(browser) })
                .opacity(browser.visible && !browser.minimized ? 1 : 0)
                .allowsHitTesting(browser.visible && !browser.minimized)
                .accessibilityHidden(!browser.visible || browser.minimized)
                .animation(reduceMotion ? nil : .easeInOut(duration: 0.22), value: browser.visible && !browser.minimized)
                if browser.visible && browser.minimized {
                    minimizedPill(in: geometry.size)
                }
            }.onAppear { fit(geometry.size) }.onChange(of: geometry.size) { _, size in fit(size) }
        }
    }
}

struct ErrorView: View {
    @ObservedObject var model: WebModel
    var body: some View {
        ZStack {
            Color(jarvisBG).ignoresSafeArea()
            VStack(spacing: 14) {
                Circle().fill(RadialGradient(colors: [Color(red: 0.9, green: 0.98, blue: 1), Color(red: 0.12, green: 0.72, blue: 0.83), Color(red: 0.18, green: 0.5, blue: 0.94)], center: .topLeading, startRadius: 4, endRadius: 60)).frame(width: 70, height: 70)
                Text(model.failed ?? "").multilineTextAlignment(.center).foregroundColor(.white).font(.system(size: 15)).frame(maxWidth: 360)
                Text(Prefs.server).font(.footnote).foregroundColor(.gray)
                VStack(alignment: .leading, spacing: 6) {
                    Text("What has to be running").font(.footnote.weight(.semibold)).foregroundColor(.white)
                    ForEach(["The Jarvis server (it starts by itself after login, once the external drive is connected)", "The external drive that holds Jarvis", "OrbStack, only for social media posting"], id: \.self) { t in
                        HStack(alignment: .top, spacing: 8) { Text("•").foregroundColor(.orange); Text(t).font(.footnote).foregroundColor(.gray) }
                    }
                }.frame(maxWidth: 360, alignment: .leading)
                HStack(spacing: 10) {
                    Button("Try again") { model.load() }.keyboardShortcut(.defaultAction)
                    Button("Start the Jarvis server") { model.restartServer() }
                    Button("Settings…") { NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil) }
                }
            }
        }
    }
}

struct SettingsView: View {
    @ObservedObject var model: WebModel
    @State private var server = Prefs.server
    @State private var login = SMAppService.mainApp.status == .enabled
    @State private var note = ""
    var body: some View {
        Form {
            Section("Jarvis server") {
                TextField("Address", text: $server).textFieldStyle(.roundedBorder)
                Text("Normally http://localhost:4777 (Jarvis runs on this Mac). Use your Tailscale address to open Jarvis on another Mac.").font(.footnote).foregroundColor(.secondary)
                HStack { Button("Use the default") { server = Prefs.defaultServer }; Button("Save and reload") { Prefs.server = server; model.load() }.keyboardShortcut(.defaultAction) }
            }
            Section("Startup") {
                Toggle("Open Jarvis when I log in", isOn: $login).onChange(of: login) { _, on in
                    do { if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }; note = "" } catch { note = "macOS did not allow that: \(error.localizedDescription)"; login = SMAppService.mainApp.status == .enabled }
                }
                if !note.isEmpty { Text(note).font(.footnote).foregroundColor(.orange) }
            }
            Section("Sign-in") { Button("Sign out of Jarvis in this app", role: .destructive) { model.clearLogin() } }
        }
        .formStyle(.grouped).frame(width: 480, height: 360).padding()
    }
}
