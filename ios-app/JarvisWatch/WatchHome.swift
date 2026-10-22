import SwiftUI

private let accent = Color(red: 0.50, green: 0.42, blue: 1.0)
private let glow = Color(red: 0.20, green: 0.10, blue: 0.45)

struct WatchHome: View {
    @EnvironmentObject var model: WatchModel
    @State private var showVolume = false
    @State private var hideTask: Task<Void, Never>?
    var body: some View {
        ZStack {
            RadialGradient(colors: [glow.opacity(0.9), Color(red: 0.027, green: 0.035, blue: 0.051)], center: .init(x: 0.5, y: 0.3), startRadius: 4, endRadius: 190).ignoresSafeArea()
            ScrollView {
                VStack(spacing: 6) {
                    Text(model.title).font(.system(size: 12, weight: .semibold, design: .rounded)).tracking(1.2).foregroundStyle(accent.opacity(0.95)).textCase(.uppercase)
                    Button(action: model.orbTapped) { Orb(phase: model.phase, level: model.level).frame(width: 118, height: 118) }
                        .buttonStyle(.plain).accessibilityLabel("Talk to Jarvis")
                    if !model.heard.isEmpty { Text("“\(model.heard)”").font(.system(size: 12)).foregroundStyle(.white.opacity(0.55)).multilineTextAlignment(.center) }
                    if !model.text.isEmpty { Text(model.text).font(.system(size: 14, weight: .medium)).foregroundStyle(model.phase == .error ? Color(red: 1, green: 0.45, blue: 0.5) : .white).multilineTextAlignment(.center) }
                    if model.phase == .idle || model.phase == .error {
                        Button { model.summary() } label: { Label("Daily summary", systemImage: "sun.max.fill").font(.system(size: 13, weight: .semibold)) }
                            .tint(accent).padding(.top, 4)
                    }
                }.padding(.horizontal, 6)
            }
            if showVolume { VolumeHUD(value: model.volume).transition(.opacity) }
        }
        // the Digital Crown sets how loud Jarvis talks
        .focusable(true)
        .digitalCrownRotation($model.volume, from: 0, through: 1, by: 0.05, sensitivity: .medium, isContinuous: false, isHapticFeedbackEnabled: true)
        .onChange(of: model.volume) { _, _ in
            withAnimation(.easeOut(duration: 0.15)) { showVolume = true }
            hideTask?.cancel()
            hideTask = Task { try? await Task.sleep(nanoseconds: 1_400_000_000); if !Task.isCancelled { withAnimation(.easeIn(duration: 0.3)) { showVolume = false } } }
        }
    }
}

struct VolumeHUD: View {
    let value: Double
    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: value < 0.01 ? "speaker.slash.fill" : value < 0.4 ? "speaker.wave.1.fill" : value < 0.75 ? "speaker.wave.2.fill" : "speaker.wave.3.fill").font(.system(size: 22)).foregroundStyle(accent)
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.18))
                Capsule().fill(accent).frame(width: 90 * max(0.04, value))
            }.frame(width: 90, height: 6)
            Text("\(Int((value * 100).rounded()))%").font(.system(size: 13, weight: .semibold, design: .rounded)).foregroundStyle(.white)
        }
        .padding(14).background(.black.opacity(0.78), in: RoundedRectangle(cornerRadius: 18))
    }
}

// The Jarvis orb: rings, glow and sparks that breathe when idle, pulse with your voice when listening, spin while working, wave while speaking.
struct Orb: View {
    let phase: WatchModel.Phase
    let level: Double
    var body: some View {
        TimelineView(.animation) { tl in
            Canvas { ctx, size in
                let t = tl.date.timeIntervalSinceReferenceDate
                let c = CGPoint(x: size.width / 2, y: size.height / 2), R = min(size.width, size.height) / 2
                let col = phase == .error ? Color(red: 1, green: 0.36, blue: 0.42) : accent
                let speed: Double = { switch phase { case .idle: return 0.9; case .listening: return 3.5; case .thinking: return 2.6; case .speaking: return 5; case .error: return 0 } }()
                let amp: Double = { switch phase { case .idle: return 0.03; case .listening: return 0.04 + level * 0.14; case .thinking: return 0.02; case .speaking: return 0.10; case .error: return 0 } }()
                let ph = t * speed
                let pulse = 1 + amp * sin(ph)
                ctx.fill(Path(ellipseIn: CGRect(x: c.x - R, y: c.y - R, width: 2 * R, height: 2 * R)),
                         with: .radialGradient(Gradient(colors: [col.opacity(phase == .listening || phase == .speaking ? 0.55 : 0.32), col.opacity(0)]), center: c, startRadius: 0, endRadius: R * pulse))
                for k in 0..<3 {
                    let rad = R * (0.70 - Double(k) * 0.11) * pulse + (phase == .speaking || phase == .listening ? sin(ph + Double(k) * 1.2) * 2.2 : 0)
                    var p = Path()
                    if phase == .thinking {
                        let a0 = ph * (k % 2 == 0 ? 1 : -1) + Double(k)
                        p.addArc(center: c, radius: rad, startAngle: .radians(a0), endAngle: .radians(a0 + .pi * 1.4), clockwise: false)
                    } else { p.addArc(center: c, radius: rad, startAngle: .zero, endAngle: .degrees(360), clockwise: false) }
                    ctx.stroke(p, with: .color(col.opacity(1 - Double(k) * 0.28)), lineWidth: k == 2 ? 2.2 : 1.4)
                }
                for s in 0..<9 {
                    let a = ph * (phase == .thinking ? 2 : 0.6) + Double(s) * 0.7 + Double(s * s) * 0.05
                    let rr = R * (0.80 + Double((s * 7) % 12) / 100) * pulse
                    let sz: Double = s % 3 == 0 ? 3 : 2
                    ctx.fill(Path(ellipseIn: CGRect(x: c.x + rr * cos(a) - sz / 2, y: c.y + rr * sin(a) - sz / 2, width: sz, height: sz)), with: .color(col.opacity(0.35 + Double(s % 3) * 0.2)))
                }
            }
        }
    }
}
