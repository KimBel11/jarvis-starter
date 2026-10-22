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
    private var interface: CPInterfaceController?
    private var template: CPVoiceControlTemplate?

    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene, didConnect interfaceController: CPInterfaceController) {
        CarLog.install(); CarLog.write("didConnect")
        interface = interfaceController
        interfaceController.prefersDarkUserInterfaceStyle = true
        let t = build()
        template = t
        CarVoice.shared.onPhase = { [weak self] phase, detail in self?.show(phase, detail) }
        // The voice template as the root screen; if CarPlay refuses it, show a one-item list whose item opens the voice screen.
        interfaceController.setRootTemplate(t, animated: false) { [weak self] ok, err in
            CarLog.write("root voice template ok=\(ok) err=\(String(describing: err))")
            guard !ok, let self else { return }
            self.showListFallback(interfaceController, t)
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
        CarVoice.shared.onPhase = nil
        Task { @MainActor in CarVoice.shared.stop() }
        interface = nil; template = nil
    }

    private func buttons() -> [CPButton] {
        func button(_ title: String, _ icon: String, _ act: @escaping @MainActor () -> Void) -> CPButton {
            let b = CPButton(image: CarArt.symbol(icon)) { _ in Task { @MainActor in act() } }
            b.title = title; return b
        }
        // left to right: the overview page, then Talk
        return [button("Overview", "square.grid.2x2.fill") { [weak self] in self?.showOverview() },
                button("Talk", "mic.fill") { CarVoice.shared.talk() },
                button("Stop", "stop.fill") { CarVoice.shared.stop() }]
    }

    private func state(_ id: String, _ titles: [String], _ mode: CarArt.Mode, _ bg: CarBackground, repeats: Bool = true) -> CPVoiceControlState {
        let st: CPVoiceControlState
        let probe = CarArt.orb(mode, bg); CarLog.write("orb \(id): size=\(probe.size) scale=\(probe.scale) frames=\(probe.images?.count ?? 1)")
        if #available(iOS 27.0, *) {
            // a bright, thick orb as the state image (CarPlay shows it centred, up to 150 pt) on a dark backdrop so it stands out
            st = CPVoiceControlState(identifier: id, titleVariants: titles, image: CarArt.orb(mode, bg), backgroundImage: CarArt.backdrop(bg), repeats: repeats)
        } else {
            st = CPVoiceControlState(identifier: id, titleVariants: titles, image: CarArt.orb(mode, bg), repeats: repeats)
        }
        if #available(iOS 26.4, *) { st.actionButtons = Array(buttons().prefix(max(1, CPVoiceControlState.maximumActionButtonCount))) }
        return st
    }

    private func build() -> CPVoiceControlTemplate {
        let bg = CarBackground.saved
        let t = CPVoiceControlTemplate(voiceControlStates: [
            state("idle", ["Tap Talk and ask Jarvis anything", "Tap Talk"], .idle, bg),
            state("listening", ["Listening…"], .listening, bg),
            state("thinking", ["Working on it…"], .thinking, bg),
            state("speaking", ["Jarvis"], .speaking, bg),
            state("error", ["Jarvis needs attention. Check your iPhone."], .error, bg, repeats: false),
        ])
        if #available(iOS 26.4, *) {
            t.trailingNavigationBarButtons = [CPBarButton(title: "Stop") { _ in Task { @MainActor in CarVoice.shared.stop() } }]
        }
        return t
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
    }
}
