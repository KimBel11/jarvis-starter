import CarPlay
import UIKit
import os

// A small log in the app's Documents folder so a CarPlay problem can be read afterwards (Documents/car.log).
enum CarLog {
    static let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("car.log")
    static func write(_ s: String) {
        let line = "\(Date()) \(s)\n"
        if let h = try? FileHandle(forWritingTo: url) { h.seekToEndOfFile(); h.write(Data(line.utf8)); try? h.close() } else { try? line.write(to: url, atomically: true, encoding: .utf8) }
    }
    static func install() { NSSetUncaughtExceptionHandler { e in CarLog.write("EXCEPTION \(e.name.rawValue): \(e.reason ?? "") \(e.callStackSymbols.prefix(6).joined(separator: " | "))") } }
}

// CarPlay: one full-screen voice template. Only the Jarvis orb, a status line and three buttons (Talk, Daily summary, Stop).
final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    private var appearanceObserver: NSObjectProtocol?
    private var appearanceTimer: Timer?
    private var interface: CPInterfaceController?
    private var template: CPVoiceControlTemplate?
    private var connectionCheck: Task<Void, Never>?

    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene, didConnect interfaceController: CPInterfaceController) {
        CarLog.install(); CarLog.write("didConnect")
        appearanceObserver = NotificationCenter.default.addObserver(forName: Notification.Name("JarvisAppearanceChanged"), object: nil, queue: .main) { [weak self] _ in
            guard let self, let interface = self.interface else { return }
            let updated = self.build(); self.template = updated
            interface.setRootTemplate(updated, animated: false) { [weak self] ok, _ in if ok { Task { @MainActor in self?.show(CarVoice.shared.phase, CarVoice.shared.detail) } } }
        }
        Task { await LockAppearance.refreshShared() }
        appearanceTimer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { _ in Task { await LockAppearance.refreshShared() } }
        interface = interfaceController
        interfaceController.prefersDarkUserInterfaceStyle = true
        let t = build()
        template = t
        CarVoice.shared.onPhase = { [weak self] phase, detail in self?.show(phase, detail) }
        // The voice template as the root screen; if CarPlay refuses it, show a one-item list whose item opens the voice screen.
        interfaceController.setRootTemplate(t, animated: false) { [weak self] ok, err in
            CarLog.write("root voice template ok=\(ok) err=\(String(describing: err))")
            guard let self else { return }
            if ok { self.show(CarVoice.shared.phase, CarVoice.shared.detail); self.checkConnection() }
            else { self.showListFallback(interfaceController, t) }
        }
    }

    private func showListFallback(_ ic: CPInterfaceController, _ voice: CPVoiceControlTemplate) {
        let item = CPListItem(text: "Talk to Jarvis", detailText: "Tap, then speak")
        item.handler = { _, done in
            ic.presentTemplate(voice, animated: true) { ok, err in CarLog.write("present voice ok=\(ok) err=\(String(describing: err))"); done() }
        }
        let list = CPListTemplate(title: "Jarvis", sections: [CPListSection(items: [item])])
        ic.setRootTemplate(list, animated: false) { ok, err in CarLog.write("root list ok=\(ok) err=\(String(describing: err))") }
    }

    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene, didDisconnectInterfaceController interfaceController: CPInterfaceController) {
        appearanceTimer?.invalidate(); appearanceTimer = nil
        if let observer = appearanceObserver { NotificationCenter.default.removeObserver(observer); appearanceObserver = nil }
        connectionCheck?.cancel(); connectionCheck = nil
        CarVoice.shared.onPhase = nil
        Task { @MainActor in CarVoice.shared.stop() }
        interface = nil; template = nil
    }

    private func buttons() -> [CPButton] {
        func button(_ title: String, _ icon: String, _ act: @escaping @MainActor () -> Void) -> CPButton {
            let b = CPButton(image: CarArt.symbol(icon)) { [weak self] _ in Task { @MainActor in self?.connectionCheck?.cancel(); act() } }
            b.title = title; return b
        }
        // Head units may cap action buttons at two: Talk and Daily summary stay here; Stop is always in navigation.
        return [button("Talk", "mic.fill") { CarVoice.shared.talk() },
                button("Daily summary", "sun.max.fill") { CarVoice.shared.summary() },
                button("Stop", "stop.fill") { CarVoice.shared.stop() }]
    }

    private func state(_ id: String, _ titles: [String], _ mode: CarArt.Mode, _ bg: CarBackground, repeats: Bool = true) -> CPVoiceControlState {
        let st: CPVoiceControlState
        let probe = CarArt.orb(mode, bg); CarLog.write("orb \(id): size=\(probe.size) scale=\(probe.scale) frames=\(probe.images?.count ?? 1)")
        if #available(iOS 27.0, *) {
            // Keep the visible orb in the background artwork; native action buttons remain separate and tappable.
            st = CPVoiceControlState(identifier: id, titleVariants: titles, image: nil, backgroundImage: CarArt.voiceBackdrop(mode, bg), repeats: repeats)
        } else {
            st = CPVoiceControlState(identifier: id, titleVariants: titles, image: CarArt.orb(mode, bg).images?.first ?? CarArt.orb(mode, bg), repeats: false)
        }
        if #available(iOS 26.4, *) { st.actionButtons = Array(buttons().prefix(max(1, CPVoiceControlState.maximumActionButtonCount))) }
        return st
    }

    private func build() -> CPVoiceControlTemplate {
        let bg = CarBackground.saved
        let t = CPVoiceControlTemplate(voiceControlStates: [
            state("idle", ["Tap Talk", "Jarvis"], .idle, bg),
            state("listening", ["Listening…"], .listening, bg),
            state("thinking", ["Working on it…"], .thinking, bg),
            state("speaking", ["Jarvis"], .speaking, bg),
            state("error", ["Connection needs attention", "Offline"], .error, bg, repeats: false),
        ])
        if #available(iOS 26.4, *) {
            t.leadingNavigationBarButtons = [CPBarButton(title: "Overview") { [weak self] _ in self?.showOverview() }]
            t.trailingNavigationBarButtons = [CPBarButton(title: "Stop") { [weak self] _ in Task { @MainActor in self?.connectionCheck?.cancel(); CarVoice.shared.stop() } }]
        }
        return t
    }

    func sceneDidBecomeActive(_ scene: UIScene) { checkConnection() }

    private func checkConnection() {
        guard interface != nil, connectionCheck == nil else { return }
        connectionCheck = Task { @MainActor [weak self] in
            defer { self?.connectionCheck = nil }
            await CarVoice.shared.checkConnectionOnOpen()
        }
    }

    // MARK: Overview page
    private func showOverview() {
        guard let ic = interface else { return }
        Task { @MainActor in
            do {
                let o = try await CarVoice.shared.overview()
                var items: [CPInformationItem] = []
                items.append(CPInformationItem(title: "Working now", detail: o.working.isEmpty ? "Nobody is working right now" : o.working.prefix(4).joined(separator: "\n")))
                items.append(CPInformationItem(title: "Waiting for your approval", detail: o.waiting == 0 ? "Nothing" : "\(o.waiting) plan\(o.waiting == 1 ? "" : "s")"))
                items.append(CPInformationItem(title: "Connections", detail: o.attention.isEmpty ? "All \(o.okCount) working" : "\(o.okCount) working, \(o.attention.count) need attention:\n" + o.attention.prefix(3).joined(separator: "\n")))
                if !o.headline.isEmpty { items.append(CPInformationItem(title: "Today", detail: o.headline)) }
                let read = CPTextButton(title: "Read daily summary", textStyle: .normal) { _ in Task { @MainActor in ic.popTemplate(animated: true) { _, _ in }; CarVoice.shared.summary() } }
                let back = CPTextButton(title: "Back", textStyle: .cancel) { _ in ic.popTemplate(animated: true) { _, _ in } }
                let t = CPInformationTemplate(title: "Overview", layout: .leading, items: items, actions: [read, back])
                ic.pushTemplate(t, animated: true) { ok, err in
                    CarLog.write("overview pushed ok=\(ok) err=\(String(describing: err))")
                    if !ok { Task { @MainActor in CarVoice.shared.speakOverview(o) } }
                }
            } catch { CarLog.write("overview failed \(error.localizedDescription)"); CarVoice.shared.speakOverview(nil) }
        }
    }

    private func show(_ phase: CarVoice.Phase, _ detail: String) {
        guard let t = template else { return }
        // state titles are fixed at creation, so errors and what @@NAME@@ said appear as a short alert-free status via the title variants
        CarLog.write("state \(phase.rawValue)")
        t.activateVoiceControlState(withIdentifier: phase.rawValue)
        if phase == .error, !detail.isEmpty, let ic = interface, ic.presentedTemplate == nil {
            let dismiss = CPAlertAction(title: "OK", style: .default) { _ in
                ic.dismissTemplate(animated: true) { _, _ in }
            }
            ic.presentTemplate(CPAlertTemplate(titleVariants: [detail], actions: [dismiss]), animated: true) { _, _ in }
        }
    }
}
