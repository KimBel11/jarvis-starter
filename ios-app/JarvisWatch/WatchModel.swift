import Foundation
import SwiftUI
import AVFoundation
import WatchConnectivity
import WatchKit

// Jarvis on the Apple Watch: tap the orb, talk, and the iPhone (which holds your Jarvis login) does the work and sends the answer back.
@MainActor
final class WatchModel: NSObject, ObservableObject, WCSessionDelegate, AVAudioPlayerDelegate {
    enum Phase { case idle, listening, thinking, speaking, error }
    @Published var phase: Phase = .idle
    @Published var heard = ""
    @Published var text = ""
    @Published var level: Double = 0
    /// Jarvis' voice volume, turned with the Digital Crown (kept between launches)
    @Published var volume: Double = UserDefaults.standard.object(forKey: "voiceVolume") as? Double ?? 0.8 {
        didSet { let v = max(0, min(1, volume)); UserDefaults.standard.set(v, forKey: "voiceVolume"); player?.volume = Float(v) }
    }

    @Published var appearanceImage: UIImage? = (UserDefaults.standard.data(forKey: "orbAppearanceImage")).flatMap { UIImage(data: $0) }
    @Published var appearanceAccent: String = UserDefaults.standard.string(forKey: "orbAppearanceAccent") ?? "#a78bfa"
    @Published var appearanceMotion: String = UserDefaults.standard.string(forKey: "orbAppearanceMotion") ?? "subtle"
    var appearanceColor: Color { let n = UInt32(appearanceAccent.dropFirst(), radix: 16) ?? 0xa78bfa; return Color(red: Double((n >> 16) & 255)/255, green: Double((n >> 8) & 255)/255, blue: Double(n & 255)/255) }
    private func receiveAppearance(_ context: [String: Any]) {
        guard let a = context["appearance"] as? [String: Any], let hex = a["accent"] as? String, hex.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil, let data = a["image"] as? Data, data.count < 200000, let image = UIImage(data: data) else { return }
        appearanceImage = image; appearanceAccent = hex; appearanceMotion = a["motion"] as? String ?? "subtle"
        UserDefaults.standard.set(data, forKey: "orbAppearanceImage"); UserDefaults.standard.set(hex, forKey: "orbAppearanceAccent"); UserDefaults.standard.set(appearanceMotion, forKey: "orbAppearanceMotion")
    }
    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) { Task { @MainActor in self.receiveAppearance(applicationContext) } }
    private var recorder: AVAudioRecorder?
    private var timer: Timer?
    private var player: AVAudioPlayer?
    private var pendingId: String?
    private var lastSentId: String? { get { UserDefaults.standard.string(forKey: "lastSentId") } set { UserDefaults.standard.set(newValue, forKey: "lastSentId") } }
    private var timeout: Task<Void, Never>?

    override init() {
        super.init()
        if WCSession.isSupported() { WCSession.default.delegate = self; WCSession.default.activate() }
    }

    var title: String {
        switch phase {
        case .idle: return "Tap the orb"
        case .listening: return "Listening…"
        case .thinking: return heard.isEmpty ? "Working on it…" : "Working on it…"
        case .speaking: return "Jarvis"
        case .error: return "Jarvis"
        }
    }

    // MARK: buttons
    func orbTapped() {
        switch phase {
        case .idle, .error: startListening()
        case .listening: stopListening(send: true)
        case .speaking: stopPlayback(); phase = .idle
        case .thinking: pendingId = nil; lastSentId = nil; timeout?.cancel(); phase = .idle
        }
    }
    func summary() {
        guard phase == .idle || phase == .error else { return }
        text = ""; heard = ""
        send(WatchRequest(id: UUID().uuidString, kind: "summary", audio: nil))
    }

    // MARK: recording
    private func startListening() {
        stopPlayback(); text = ""; heard = ""
        AVAudioApplication.requestRecordPermission { ok in
            Task { @MainActor in
                guard ok else { self.fail("Allow the microphone in the Watch app settings"); return }
                self.beginRecording()
            }
        }
    }
    private func beginRecording() {
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playAndRecord, mode: .default)
        try? s.setActive(true)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("watch-voice.m4a")
        try? FileManager.default.removeItem(at: url)
        let settings: [String: Any] = [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 16000, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 32000]
        guard let r = try? AVAudioRecorder(url: url, settings: settings) else { fail("Could not start the microphone"); return }
        r.isMeteringEnabled = true; r.record(); recorder = r
        phase = .listening; WKInterfaceDevice.current().play(.start)
        let started = Date(); var heardVoice = false; var lastVoice = Date()
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] t in
            Task { @MainActor in
                guard let self, let r = self.recorder else { t.invalidate(); return }
                r.updateMeters(); let db = r.averagePower(forChannel: 0)
                self.level = max(0, min(1, Double((db + 55) / 45)))
                let now = Date()
                if db > -34 { heardVoice = true; lastVoice = now }
                if (heardVoice && now.timeIntervalSince(lastVoice) > 1.2) || (!heardVoice && now.timeIntervalSince(started) > 8) || now.timeIntervalSince(started) > 30 {
                    t.invalidate(); self.stopListening(send: heardVoice)
                }
            }
        }
    }
    private func stopListening(send go: Bool) {
        timer?.invalidate(); timer = nil
        let url = recorder?.url
        recorder?.stop(); recorder = nil; level = 0
        WKInterfaceDevice.current().play(.stop)
        guard go, let url, let data = try? Data(contentsOf: url), data.count > 800 else { phase = .idle; return }
        send(WatchRequest(id: UUID().uuidString, kind: "voice", audio: data))
    }

    // MARK: talking to the iPhone
    private func send(_ req: WatchRequest) {
        guard WCSession.default.isReachable else { fail("Can't reach your iPhone. Open Jarvis on it."); return }
        guard let d = try? JSONEncoder().encode(req) else { return }
        pendingId = req.id; lastSentId = req.id; phase = .thinking
        WCSession.default.sendMessageData(d, replyHandler: { _ in }, errorHandler: { [weak self] e in
            Task { @MainActor in self?.fail("Can't reach your iPhone. Open Jarvis on it.") }
        })
        timeout?.cancel()
        timeout = Task { try? await Task.sleep(nanoseconds: 150_000_000_000); if !Task.isCancelled, self.pendingId == req.id { self.fail("That took too long") } }
    }
    nonisolated func session(_ session: WCSession, didReceiveMessageData messageData: Data) {
        guard let r = try? JSONDecoder().decode(WatchResponse.self, from: messageData) else { return }
        Task { @MainActor in self.receive(r) }
    }
    nonisolated func session(_ session: WCSession, didReceive file: WCSessionFile) {
        guard let d = try? Data(contentsOf: file.fileURL), let r = try? JSONDecoder().decode(WatchResponse.self, from: d) else { return }
        Task { @MainActor in self.receive(r) }
    }
    private var handled = Set<String>()
    private func receive(_ r: WatchResponse) {
        guard r.id == pendingId || (r.status != "thinking" && (phase == .thinking || phase == .idle) && !handled.contains(r.id) && r.id == lastSentId) else { return }
        if r.status != "thinking" { guard !handled.contains(r.id) else { return }; handled.insert(r.id) }
        pendingId = r.id
        if let h = r.heard { heard = h }
        switch r.status {
        case "done":
            timeout?.cancel(); text = r.text ?? ""
            if let a = r.audio { play(a) } else { phase = .idle; WKInterfaceDevice.current().play(.success) }
        case "error": fail(r.text ?? "Something went wrong")
        default: phase = .thinking
        }
    }
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) { let context = session.receivedApplicationContext; Task { @MainActor in self.receiveAppearance(context) } }
    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {}

    // MARK: speaking
    private func play(_ data: Data) {
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playback, mode: .default)
        try? s.setActive(true)
        guard let p = try? AVAudioPlayer(data: data) else { phase = .idle; return }
        p.delegate = self; p.volume = Float(max(0, min(1, volume))); player = p; phase = .speaking
        WKInterfaceDevice.current().play(.success)
        p.prepareToPlay(); p.play()
    }
    private func stopPlayback() { player?.stop(); player = nil }
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in if self.phase == .speaking { self.phase = .idle }; self.player = nil }
    }

    private func fail(_ msg: String) {
        timeout?.cancel(); pendingId = nil; text = msg; phase = .error
        WKInterfaceDevice.current().play(.failure)
        Task { try? await Task.sleep(nanoseconds: 8_000_000_000); if self.phase == .error { self.phase = .idle } }
    }
}
