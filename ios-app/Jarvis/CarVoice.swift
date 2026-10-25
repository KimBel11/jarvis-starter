import Foundation
import AVFoundation
import WebKit

// The Jarvis brain for the car: listen → /api/stt → /api/chat (@@ASSISTANT@@ assigns tasks to the right agent) → /api/tts → speak.
// It talks to the same private Jarvis server as the app and reuses the app's saved login.
@MainActor
final class CarVoice: NSObject {
    static let shared = CarVoice()
    enum Phase: String { case idle, listening, thinking, speaking, error }
    private(set) var phase: Phase = .idle { didSet { if phase != oldValue { onPhase?(phase, detail) } } }
    private(set) var detail = ""
    var onPhase: ((Phase, String) -> Void)?

    private var work: Task<Void, Never>?
    private var recorder: AVAudioRecorder?
    private var meterTimer: Timer?
    private var player: AVAudioPlayer?
    private var playDone: CheckedContinuation<Void, Never>?
    private var cookieHeader: String?
    private var sessionId: String? { get { UserDefaults.standard.string(forKey: "car.session") } set { UserDefaults.standard.set(newValue, forKey: "car.session") } }
    private var conversation = false
    private var activeSpeaker: Speaker?
    private let localSpeech = AVSpeechSynthesizer()
    private var lastConnectionCheck = Date.distantPast

    // MARK: Buttons
    func talk() {
        if phase == .listening { finishListening(); return }
        stop(); conversation = true
        work = Task { await self.turn() }
    }
    func summary() {
        stop(); conversation = false
        work = Task { await self.readSummary() }
    }
    func stop() {
        work?.cancel(); work = nil; conversation = false
        localSpeech.stopSpeaking(at: .immediate)
        activeSpeaker?.cancel(); activeSpeaker = nil
        finishNow?(); finishNow = nil
        meterTimer?.invalidate(); recorder?.stop(); recorder = nil
        player?.stop(); player = nil; playDone?.resume(); playDone = nil
        phase = .idle; detail = ""
        try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
    }

    // MARK: A voice turn
    private func turn() async {
        var empty = 0
        while !Task.isCancelled && conversation {
            guard let text = await listen() else { empty += 1; if empty >= 1 { break } else { continue } }
            empty = 0
            if Task.isCancelled { return }
            phase = .thinking; detail = text
            await ask(text)
            if Task.isCancelled { return }
        }
        if !Task.isCancelled && phase != .error { phase = .idle; detail = ""; try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation]) }
    }

    private func session() {
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP])
        try? s.setActive(true)
    }

    // MARK: Listening (records until you stop talking)
    private func listen() async -> String? {
        let granted: Bool = await withCheckedContinuation { c in
            if #available(iOS 17.0, *) { AVAudioApplication.requestRecordPermission { c.resume(returning: $0) } }
            else { AVAudioSession.sharedInstance().requestRecordPermission { c.resume(returning: $0) } }
        }
        guard granted else { fail("Allow the microphone for Jarvis on your iPhone"); return nil }
        session()
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("car-\(UUID().uuidString).m4a")
        let settings: [String: Any] = [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 16000, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 32000]
        guard let rec = try? AVAudioRecorder(url: url, settings: settings) else { fail("Could not start the microphone"); return nil }
        rec.isMeteringEnabled = true; rec.record(); recorder = rec
        phase = .listening; detail = ""
        let started = Date()
        var heard = false, lastVoice = Date()
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            var finished = false
            let done = { if !finished { finished = true; c.resume() } }
            finishNow = done
            meterTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] t in
                guard let self else { t.invalidate(); done(); return }
                rec.updateMeters()
                let db = rec.averagePower(forChannel: 0)
                let now = Date()
                if db > -36 { heard = true; lastVoice = now }
                if (heard && now.timeIntervalSince(lastVoice) > 1.3) || (!heard && now.timeIntervalSince(started) > 9) || now.timeIntervalSince(started) > 45 { t.invalidate(); done() }
            }
        }
        finishNow = nil; meterTimer?.invalidate(); meterTimer = nil
        rec.stop(); recorder = nil
        defer { try? FileManager.default.removeItem(at: url) }
        if !heard || Task.isCancelled { return nil }
        phase = .thinking; detail = ""
        guard let data = try? Data(contentsOf: url), data.count > 800 else { return nil }
        do {
            let (j, _) = try await request("/api/stt", method: "POST", body: data, type: "audio/mp4")
            let t = ((try? JSONSerialization.jsonObject(with: j)) as? [String: Any])?["text"] as? String ?? ""
            return t.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : t
        } catch { fail(message(error)); return nil }
    }
    private var finishNow: (() -> Void)?
    private func finishListening() { finishNow?() }

    // MARK: Ask @@ASSISTANT@@ (it assigns work to the right agent)
    private func ask(_ text: String) async {
        let hint = "[@@NAME@@ is driving. Answer in one to three short spoken sentences, no lists or markdown. If she asks you to do something, hand it to the right specialist agent right away and confirm in one sentence who has it. Ask a question only if you really cannot start.]\n"
        var body: [String: Any] = ["agentId": "kim", "prompt": hint + text, "allowEdits": false, "voice": true]
        if let sid = sessionId { body["sessionId"] = sid }
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }
        let speaker = Speaker(self); activeSpeaker = speaker
        do {
            var req = try await makeRequest("/api/chat", method: "POST", body: data, type: "application/json")
            req.timeoutInterval = 600
            let (bytes, resp) = try await URLSession.shared.bytes(for: req)
            if let h = resp as? HTTPURLResponse, h.statusCode == 401 { fail("Open Jarvis on the iPhone and sign in once"); return }
            var buf = "", got = false, cut2 = false
            for try await line in bytes.lines {
                if Task.isCancelled { return }
                guard line.hasPrefix("data: "), let d = line.dropFirst(6).data(using: .utf8), let ev = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { continue }
                switch ev["type"] as? String {
                case "session": if let id = ev["id"] as? String { sessionId = id }
                case "delta":
                    if cut2 { break }
                    buf += (ev["text"] as? String) ?? ""
                    // "Always both" adds a written second opinion after the answer: only the first answer is spoken in the car
                    if let r = buf.range(of: "\n\n---") { buf = String(buf[..<r.lowerBound]); cut2 = true }
                    while let cut = Self.sentenceEnd(buf) { speaker.add(String(buf[..<cut])); buf = String(buf[cut...]); got = true }
                case "done":
                    if let id = ev["sessionId"] as? String { sessionId = id }
                    if !got && buf.trimmingCharacters(in: .whitespaces).isEmpty, let t = ev["text"] as? String { buf = t }
                case "error": fail((ev["message"] as? String) ?? "Something went wrong"); return
                default: break
                }
            }
            if !buf.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { speaker.add(buf) }
            await speaker.finish()
        } catch { if !Task.isCancelled { fail(message(error)) } }
    }

    private static func sentenceEnd(_ s: String) -> String.Index? {
        guard s.count > 24 else { return nil }
        var i = s.startIndex
        while i < s.endIndex {
            let c = s[i]
            if ".!?؟۔\n".contains(c) {
                let n = s.index(after: i)
                if n == s.endIndex { return nil }
                if s[n] == " " || s[n] == "\n" || c == "\n" { if s.distance(from: s.startIndex, to: n) >= 20 { return n } }
            }
            i = s.index(after: i)
        }
        return nil
    }

    /// Fallback when the overview page cannot be shown: say it out loud.
    func speakOverview(_ o: Overview?) {
        stop(); conversation = false
        work = Task {
            let speaker = Speaker(self); self.activeSpeaker = speaker; self.phase = .thinking
            guard let o else { speaker.add("I couldn't get the overview right now."); await speaker.finish(); self.phase = .idle; return }
            speaker.add(o.working.isEmpty ? "Nobody is working right now." : "Working now: " + o.working.prefix(3).joined(separator: ". ") + ".")
            speaker.add(o.waiting == 0 ? "Nothing waits for your approval." : "\(o.waiting) plan\(o.waiting == 1 ? "" : "s") wait for your approval.")
            speaker.add(o.attention.isEmpty ? "All connections work." : "\(o.attention.count) connections need attention.")
            await speaker.finish(); self.phase = .idle
        }
    }

    // MARK: Overview (what is running, what waits for approval, what needs attention)
    struct Overview { var working: [String]; var waiting: Int; var attention: [String]; var okCount: Int; var headline: String }
    func overview() async throws -> Overview {
        let (td, _) = try await request("/api/team", method: "GET")
        let team = (try? JSONSerialization.jsonObject(with: td)) as? [String: Any] ?? [:]
        var working: [String] = []; var waiting = 0
        for a in (team["agents"] as? [[String: Any]]) ?? [] {
            guard let st = a["status"] as? [String: Any] else { continue }
            waiting += (st["waiting"] as? [Any])?.count ?? 0
            let state = st["state"] as? String ?? "idle"
            if state != "idle" { let title = (st["current"] as? [String: Any])?["title"] as? String ?? state; working.append("\((a["name"] as? String) ?? "Agent"): \(title)") }
        }
        var attention: [String] = []; var ok = 0
        if let (bd, _) = try? await request("/api/background/status", method: "GET"), let b = (try? JSONSerialization.jsonObject(with: bd)) as? [String: Any] {
            for s in (b["services"] as? [[String: Any]]) ?? [] { let status = s["status"] as? String ?? ""; if status == "ok" { ok += 1 } else if status == "fail" || status == "warn" { attention.append((s["label"] as? String) ?? "Connection") } }
        }
        var headline = ""
        if let (bd, _) = try? await request("/api/briefing", method: "GET"), let j = (try? JSONSerialization.jsonObject(with: bd)) as? [String: Any], let br = j["briefing"] as? [String: Any] { headline = (br["headline"] as? String) ?? "" }
        return Overview(working: working, waiting: waiting, attention: attention, okCount: ok, headline: headline)
    }

    // MARK: Daily summary
    private func readSummary() async {
        phase = .thinking; detail = "Daily summary"
        let speaker = Speaker(self); activeSpeaker = speaker
        do {
            var (d, _) = try await request("/api/briefing", method: "GET")
            var b = ((try? JSONSerialization.jsonObject(with: d)) as? [String: Any])?["briefing"] as? [String: Any]
            if b == nil || (b?["spoken"] as? String ?? "").isEmpty {
                speaker.add("I am writing today's summary now. One moment.")
                (d, _) = try await request("/api/briefing", method: "POST", body: Data("{}".utf8), type: "application/json", timeout: 300)
                b = ((try? JSONSerialization.jsonObject(with: d)) as? [String: Any])?["briefing"] as? [String: Any]
            }
            guard let spoken = b?["spoken"] as? String, !spoken.isEmpty else { fail("No summary yet"); return }
            for part in spoken.components(separatedBy: ". ") where !part.isEmpty { speaker.add(part.hasSuffix(".") ? part : part + ".") }
            await speaker.finish()
        } catch { if !Task.isCancelled { fail(message(error)) } }
        if !Task.isCancelled && phase != .error { phase = .idle; detail = "" ; try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation]) }
    }

    // MARK: Speaking
    final class Speaker {
        private unowned let owner: CarVoice
        private var jobs: [Task<Data?, Never>] = []
        private var loop: Task<Void, Never>?
        private var next = 0
        init(_ o: CarVoice) { owner = o }
        func cancel() { cancelled = true; loop?.cancel(); jobs.forEach { $0.cancel() } }
        private var cancelled = false
        func add(_ text: String) {
            let t = Self.clean(text); if t.isEmpty || cancelled { return }
            let o = owner
            jobs.append(Task { await o.tts(t) })
            if loop == nil { loop = Task { [weak self] in await self?.run() } }
        }
        private func run() async {
            while !Task.isCancelled {
                if next < jobs.count {
                    let job = jobs[next]; next += 1
                    if let data = await job.value, !Task.isCancelled, !cancelled { await owner.play(data) }
                } else { try? await Task.sleep(nanoseconds: 60_000_000); if next >= jobs.count && finishing { return } }
            }
        }
        private var finishing = false
        func finish() async { finishing = true; await loop?.value }
        static func clean(_ t: String) -> String {
            t.replacingOccurrences(of: "```[\\s\\S]*?```", with: " ", options: .regularExpression)
             .replacingOccurrences(of: "https?://\\S+", with: "a link", options: .regularExpression)
             .replacingOccurrences(of: "\\[([^\\]]+)\\]\\([^)]+\\)", with: "$1", options: .regularExpression)
             .replacingOccurrences(of: "[*_#>~|`]", with: "", options: .regularExpression)
             .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }
    func tts(_ text: String) async -> Data? {
        let lang = text.range(of: "[\u{0600}-\u{06FF}]", options: .regularExpression) != nil ? "ar" : (text.range(of: "[åäöÅÄÖ]|\\b(och|att|det|är|jag|inte|som|för|med)\\b", options: .regularExpression) != nil ? "sv" : "en")
        let body = try? JSONSerialization.data(withJSONObject: ["text": text, "lang": lang])
        for _ in 0..<3 {
            if Task.isCancelled { return nil }
            if let (d, _) = try? await request("/api/tts", method: "POST", body: body, type: "application/json"), d.count > 500 { return d }
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
        return nil
    }
    fileprivate func play(_ data: Data) async {
        session()
        guard let p = try? AVAudioPlayer(data: data) else { return }
        p.delegate = self; player = p; phase = .speaking; detail = ""
        p.prepareToPlay(); p.play()
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in playDone = c }
        player = nil
    }

    // MARK: Network (same private server and login as the app)
    /// Probe the authenticated server on entry; local speech still works when it is offline.
    func checkConnectionOnOpen() async {
        guard (phase == .idle || phase == .error), Date().timeIntervalSince(lastConnectionCheck) > 20 else { return }
        lastConnectionCheck = Date()
        cookieHeader = nil
        do {
            let (data, _) = try await request("/api/team", method: "GET", timeout: 6)
            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any], json["agents"] is [Any] else {
                throw NSError(domain: "Jarvis", code: 401, userInfo: [NSLocalizedDescriptionKey: "When parked, open Jarvis on your iPhone and sign in."])
            }
            if !Task.isCancelled, phase == .error { detail = ""; phase = .idle }
        } catch {
            guard !Task.isCancelled, phase == .idle || phase == .error else { return }
            fail(message(error))
        }
    }

    private func fail(_ msg: String) {
        guard !Task.isCancelled else { return }
        activeSpeaker?.cancel(); player?.stop(); player = nil
        playDone?.resume(); playDone = nil
        conversation = false; detail = msg
        if phase == .error { onPhase?(.error, msg) } else { phase = .error }
        localSpeech.stopSpeaking(at: .immediate)
        localSpeech.delegate = self
        let audio = AVAudioSession.sharedInstance()
        try? audio.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try? audio.setActive(true)
        let utterance = AVSpeechUtterance(string: msg)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-GB")
        localSpeech.speak(utterance)
    }
    private func message(_ e: Error) -> String {
        if e is URLError { return "I cannot reach Jarvis. When parked, check Tailscale and the connection to your Mac." }
        return (e as NSError).localizedDescription
    }
    private func loadCookies() async -> String {
        if let c = cookieHeader { return c }
        guard let host = URL(string: Prefs.server)?.host else { return "" }
        let cookies: [HTTPCookie] = await withCheckedContinuation { c in WKWebsiteDataStore.default().httpCookieStore.getAllCookies { c.resume(returning: $0) } }
        let h = cookies.filter { host.hasSuffix($0.domain.trimmingCharacters(in: CharacterSet(charactersIn: "."))) || $0.domain == host }.map { "\($0.name)=\($0.value)" }.joined(separator: "; ")
        cookieHeader = h; return h
    }
    func makeRequest(_ path: String, method: String, body: Data?, type: String?, timeout: TimeInterval = 60) async throws -> URLRequest {
        guard let url = URL(string: Prefs.server.trimmingCharacters(in: .whitespaces) + path) else { throw URLError(.badURL) }
        var r = URLRequest(url: url, timeoutInterval: timeout); r.httpMethod = method; r.httpBody = body
        if let type { r.setValue(type, forHTTPHeaderField: "Content-Type") }
        let ck = await loadCookies(); if !ck.isEmpty { r.setValue(ck, forHTTPHeaderField: "Cookie") }
        r.httpShouldHandleCookies = false
        return r
    }
    func request(_ path: String, method: String, body: Data? = nil, type: String? = nil, timeout: TimeInterval = 60) async throws -> (Data, HTTPURLResponse) {
        let r = try await makeRequest(path, method: method, body: body, type: type, timeout: timeout)
        let (d, resp) = try await URLSession.shared.data(for: r)
        let h = resp as! HTTPURLResponse
        if h.statusCode == 401 { cookieHeader = nil; throw NSError(domain: "Jarvis", code: 401, userInfo: [NSLocalizedDescriptionKey: "Open Jarvis on the iPhone and sign in once"]) }
        if h.statusCode >= 400 { throw NSError(domain: "Jarvis", code: h.statusCode, userInfo: [NSLocalizedDescriptionKey: "Jarvis answered \(h.statusCode)"]) }
        return (d, h)
    }
}

extension CarVoice: AVAudioPlayerDelegate {
    nonisolated func audioPlayerDidFinishPlaying(_ p: AVAudioPlayer, successfully: Bool) { Task { @MainActor in self.playDone?.resume(); self.playDone = nil } }
}

extension CarVoice: AVSpeechSynthesizerDelegate {
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in
            if self.phase == .error {
                try? AVAudioSession.sharedInstance().setActive(false, options: [.notifyOthersOnDeactivation])
            }
        }
    }
}
