import Foundation
import WatchConnectivity
import UIKit

// Apple Watch ⇄ Jarvis: the watch records, sends the audio here; this app runs the same voice pipeline as CarPlay and sends back the answer (text + voice).
final class WatchRelay: NSObject, WCSessionDelegate {
    static let shared = WatchRelay()
    func start() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }
    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) { if activationState == .activated { syncAppearance(LockAppearance.saved()) } }
    func syncAppearance(_ appearance: LockAppearance) {
        let session = WCSession.default
        guard session.activationState == .activated, session.isPaired, session.isWatchAppInstalled, let image = appearance.image else { return }
        let small = UIGraphicsImageRenderer(size: CGSize(width: 128, height: 128), format: { let f = UIGraphicsImageRendererFormat(); f.scale = 1; return f }()).image { _ in image.draw(in: CGRect(x: 0, y: 0, width: 128, height: 128)) }
        guard let png = small.pngData() else { return }
        try? session.updateApplicationContext(["appearance": ["accent": appearance.accent, "motion": appearance.motion, "image": png]])
    }
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) { session.activate() }

    func session(_ session: WCSession, didReceiveMessageData messageData: Data, replyHandler: @escaping (Data) -> Void) {
        replyHandler(Data("ok".utf8))
        guard let req = try? JSONDecoder().decode(WatchRequest.self, from: messageData) else { return }
        var bg: UIBackgroundTaskIdentifier = .invalid
        bg = UIApplication.shared.beginBackgroundTask(withName: "watch-jarvis") { UIApplication.shared.endBackgroundTask(bg) }
        Task {
            await self.handle(req)
            await MainActor.run { UIApplication.shared.endBackgroundTask(bg) }
        }
    }

    // Progress goes live when the watch is awake; the final answer is also queued as a file so it still arrives after the watch screen slept.
    private func send(_ r: WatchResponse) {
        guard let d = try? JSONEncoder().encode(r) else { return }
        if WCSession.default.isReachable { WCSession.default.sendMessageData(d, replyHandler: nil, errorHandler: nil) }
        if r.status != "thinking" {
            let url = FileManager.default.temporaryDirectory.appendingPathComponent("watch-reply-\(r.id).json")
            try? d.write(to: url)
            WCSession.default.transferFile(url, metadata: ["id": r.id])
        }
    }

    private func handle(_ req: WatchRequest) async {
        send(WatchResponse(id: req.id, status: "thinking"))
        let car = await CarVoice.shared
        do {
            var heard: String? = nil
            let reply: String
            if req.kind == "summary" {
                reply = try await car.briefingText()
            } else {
                guard let audio = req.audio else { return send(WatchResponse(id: req.id, status: "error", text: "No audio")) }
                let t = try await car.transcribe(audio)
                if t.isEmpty { return send(WatchResponse(id: req.id, status: "error", text: "I didn't catch that")) }
                heard = t
                send(WatchResponse(id: req.id, status: "thinking", heard: t))
                reply = try await car.chatReply(t)
            }
            let spoken = Self.shorten(reply, summary: req.kind == "summary")
            let mp3 = await car.tts(spoken)
            send(WatchResponse(id: req.id, status: "done", heard: heard, text: reply, audio: mp3))
        } catch {
            send(WatchResponse(id: req.id, status: "error", text: (error as NSError).localizedDescription))
        }
    }

    // the spoken answer is capped so the audio stays small enough for the watch link
    private static func shorten(_ t: String, summary: Bool) -> String {
        let limit = summary ? 1100 : 600
        guard t.count > limit else { return t }
        var out = ""
        for s in t.components(separatedBy: ". ") { if out.count + s.count > limit { break }; out += s + ". " }
        return out.isEmpty ? String(t.prefix(limit)) : out
    }
}

extension CarVoice {
    func transcribe(_ audio: Data) async throws -> String {
        let (j, _) = try await request("/api/stt", method: "POST", body: audio, type: "audio/mp4")
        return (((try? JSONSerialization.jsonObject(with: j)) as? [String: Any])?["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func briefingText() async throws -> String {
        var (d, _) = try await request("/api/briefing", method: "GET")
        var b = ((try? JSONSerialization.jsonObject(with: d)) as? [String: Any])?["briefing"] as? [String: Any]
        if (b?["spoken"] as? String ?? "").isEmpty {
            (d, _) = try await request("/api/briefing", method: "POST", body: Data("{}".utf8), type: "application/json", timeout: 300)
            b = ((try? JSONSerialization.jsonObject(with: d)) as? [String: Any])?["briefing"] as? [String: Any]
        }
        guard let s = b?["spoken"] as? String, !s.isEmpty else { throw NSError(domain: "Jarvis", code: 1, userInfo: [NSLocalizedDescriptionKey: "No summary yet"]) }
        return s
    }

    /// @@ASSISTANT@@ answers (and assigns tasks to the right agent when asked); returns the first answer only.
    func chatReply(_ text: String) async throws -> String {
        let hint = "[@@NAME@@ is using her Apple Watch. Answer in one or two very short spoken sentences, no lists or markdown. If she asks you to do something, hand it to the right specialist agent right away and confirm in one sentence who has it.]\n"
        var body: [String: Any] = ["agentId": "kim", "prompt": hint + text, "allowEdits": false, "voice": true]
        let key = "watch.session"
        if let sid = UserDefaults.standard.string(forKey: key) { body["sessionId"] = sid }
        var req = try await makeRequest("/api/chat", method: "POST", body: try JSONSerialization.data(withJSONObject: body), type: "application/json")
        req.timeoutInterval = 600
        let (bytes, resp) = try await URLSession.shared.bytes(for: req)
        if let h = resp as? HTTPURLResponse, h.statusCode == 401 { throw NSError(domain: "Jarvis", code: 401, userInfo: [NSLocalizedDescriptionKey: "Open Jarvis on the iPhone and sign in once"]) }
        var out = ""
        for try await line in bytes.lines {
            guard line.hasPrefix("data: "), let d = line.dropFirst(6).data(using: .utf8), let ev = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] else { continue }
            switch ev["type"] as? String {
            case "session", "done": if let id = (ev["id"] ?? ev["sessionId"]) as? String { UserDefaults.standard.set(id, forKey: key) }
                if ev["type"] as? String == "done", out.isEmpty, let t = ev["text"] as? String { out = t }
            case "delta": out += (ev["text"] as? String) ?? ""
                if out.contains("\n\n---") { break }
            case "error": throw NSError(domain: "Jarvis", code: 2, userInfo: [NSLocalizedDescriptionKey: (ev["message"] as? String) ?? "Something went wrong"])
            default: break
            }
            if out.contains("\n\n---") { break }
        }
        if let r = out.range(of: "\n\n---") { out = String(out[..<r.lowerBound]) }
        return out.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
