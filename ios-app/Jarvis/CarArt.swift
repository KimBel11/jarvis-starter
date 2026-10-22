import UIKit

// Orb and background artwork for the CarPlay screen. CarPlay only accepts images (no live graphics), so the Jarvis orb is drawn here as short looping animations.
enum CarBackground: String, CaseIterable {
    case aurora, midnight, ember, forest
    var title: String { switch self { case .aurora: return "Aurora (violet)"; case .midnight: return "Midnight (blue)"; case .ember: return "Ember (red)"; case .forest: return "Forest (green)" } }
    var accent: UIColor { switch self {
        case .aurora: return UIColor(red: 0.50, green: 0.42, blue: 1.0, alpha: 1)
        case .midnight: return UIColor(red: 0.25, green: 0.70, blue: 0.95, alpha: 1)
        case .ember: return UIColor(red: 1.0, green: 0.45, blue: 0.30, alpha: 1)
        case .forest: return UIColor(red: 0.25, green: 0.85, blue: 0.60, alpha: 1) } }
    var glow: UIColor { switch self {
        case .aurora: return UIColor(red: 0.20, green: 0.10, blue: 0.45, alpha: 1)
        case .midnight: return UIColor(red: 0.04, green: 0.18, blue: 0.38, alpha: 1)
        case .ember: return UIColor(red: 0.40, green: 0.10, blue: 0.08, alpha: 1)
        case .forest: return UIColor(red: 0.05, green: 0.30, blue: 0.22, alpha: 1) } }
    static var saved: CarBackground {
        get { CarBackground(rawValue: UserDefaults.standard.string(forKey: "carBackground") ?? "") ?? .aurora }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: "carBackground") }
    }
}

enum CarArt {
    static func background(_ bg: CarBackground) -> UIImage {
        let size = CGSize(width: 1600, height: 900)
        let f = UIGraphicsImageRendererFormat(); f.scale = 1; f.opaque = true
        return UIGraphicsImageRenderer(size: size, format: f).image { c in
            let g = c.cgContext, cs = CGColorSpaceCreateDeviceRGB()
            UIColor(red: 0.027, green: 0.035, blue: 0.051, alpha: 1).setFill(); g.fill(CGRect(origin: .zero, size: size))
            func glow(_ center: CGPoint, _ r: CGFloat, _ col: UIColor, _ a: CGFloat) {
                let grad = CGGradient(colorsSpace: cs, colors: [col.withAlphaComponent(a).cgColor, col.withAlphaComponent(0).cgColor] as CFArray, locations: [0, 1])!
                g.drawRadialGradient(grad, startCenter: center, startRadius: 0, endCenter: center, endRadius: r, options: [])
            }
            glow(CGPoint(x: 800, y: 380), 760, bg.glow, 0.95)
            glow(CGPoint(x: 220, y: 780), 520, bg.accent, 0.12)
            glow(CGPoint(x: 1400, y: 120), 520, bg.accent, 0.10)
            // faint stars
            var seed: UInt64 = 7
            for _ in 0..<70 {
                seed = seed &* 6364136223846793005 &+ 1442695040888963407
                let x = CGFloat(seed >> 40 & 0xFFF) / 4095 * size.width
                seed = seed &* 6364136223846793005 &+ 1442695040888963407
                let y = CGFloat(seed >> 40 & 0xFFF) / 4095 * size.height
                UIColor.white.withAlphaComponent(0.10 + CGFloat(seed >> 60 & 7) / 40).setFill()
                g.fillEllipse(in: CGRect(x: x, y: y, width: 2, height: 2))
            }
        }
    }

    enum Mode { case idle, listening, thinking, speaking, error }

    /// A looping orb animation: concentric rings, a core glow and orbiting sparks.
    static func orb(_ mode: Mode, _ bg: CarBackground) -> UIImage {
        let frames = mode == .error ? 1 : 30
        let duration: Double = { switch mode { case .idle: return 4.5; case .listening: return 1.6; case .thinking: return 2.4; case .speaking: return 1.2; case .error: return 1 } }()
        let side: CGFloat = 150, scale: CGFloat = 2
        let f = UIGraphicsImageRendererFormat(); f.scale = scale; f.opaque = false
        let r = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: f)
        let col = mode == .error ? UIColor(red: 1, green: 0.36, blue: 0.42, alpha: 1) : bg.accent
        var imgs: [UIImage] = []
        for i in 0..<frames {
            let t = Double(i) / Double(frames)            // 0…1 through the loop
            let ph = t * 2 * .pi
            imgs.append(r.image { c in
                let g = c.cgContext, cs = CGColorSpaceCreateDeviceRGB(), mid = CGPoint(x: side / 2, y: side / 2)
                let amp: CGFloat = { switch mode { case .idle: return 0.04; case .listening: return 0.10; case .thinking: return 0.03; case .speaking: return 0.13; case .error: return 0 } }()
                let pulse = 1 + amp * CGFloat(sin(ph))
                // core glow: white-hot centre fading into the accent, so it stands out on any background
                let hot = UIColor.white
                let grad = CGGradient(colorsSpace: cs, colors: [hot.withAlphaComponent(0.98).cgColor, col.withAlphaComponent(0.95).cgColor, col.withAlphaComponent(0.0).cgColor] as CFArray, locations: [0, 0.38, 1])!
                g.drawRadialGradient(grad, startCenter: mid, startRadius: 0, endCenter: mid, endRadius: 74 * pulse, options: [])
                // rings: thick and bright
                for k in 0..<3 {
                    let base: CGFloat = 55 - CGFloat(k) * 9
                    let wob = mode == .speaking || mode == .listening ? CGFloat(sin(ph + Double(k) * 1.2)) * 3.2 : CGFloat(sin(ph + Double(k))) * 1
                    let rad = base * pulse + wob
                    g.setLineWidth([4.5, 3.4, 2.4][k]); g.setLineCap(.round)
                    g.setStrokeColor((k == 0 ? hot : col.blended(with: hot, 0.55)).withAlphaComponent(1 - CGFloat(k) * 0.22).cgColor)
                    if mode == .thinking {
                        let a0 = CGFloat(ph) * (k % 2 == 0 ? 1 : -1) + CGFloat(k)
                        g.addArc(center: mid, radius: rad, startAngle: a0, endAngle: a0 + .pi * 1.4, clockwise: false)
                    } else { g.addArc(center: mid, radius: rad, startAngle: 0, endAngle: .pi * 2, clockwise: false) }
                    g.strokePath()
                }
                // sparks
                for s in 0..<9 {
                    let a = ph * (mode == .thinking ? 2 : 1) + Double(s) * 0.7 + Double(s * s) * 0.05
                    let rr = CGFloat(58 + (s * 7) % 12) * pulse
                    g.setFillColor(col.withAlphaComponent(0.35 + CGFloat(s % 3) * 0.2).cgColor)
                    let sz: CGFloat = s % 3 == 0 ? 3.2 : 2
                    g.fillEllipse(in: CGRect(x: mid.x + rr * CGFloat(cos(a)) - sz / 2, y: mid.y + rr * CGFloat(sin(a)) - sz / 2, width: sz, height: sz))
                }
            })
        }
        return frames == 1 ? imgs[0] : (UIImage.animatedImage(with: imgs, duration: duration) ?? imgs[0])
    }

    static func symbol(_ name: String) -> UIImage {
        let cfg = UIImage.SymbolConfiguration(pointSize: 26, weight: .semibold)
        return (UIImage(systemName: name, withConfiguration: cfg) ?? UIImage()).withTintColor(.white, renderingMode: .alwaysOriginal)
    }

    /// The CarPlay orb as the main character: a big, high-contrast scene for the template's full-screen background (the state image itself can only be tiny).
    static func scene(_ mode: Mode, _ bg: CarBackground) -> UIImage {
        let size = CGSize(width: 1600, height: 900)
        let f = UIGraphicsImageRendererFormat(); f.scale = 1; f.opaque = true
        let accent: UIColor = mode == .error ? UIColor(red: 1, green: 0.40, blue: 0.45, alpha: 1) : bg.accent
        let glowCol: UIColor = mode == .error ? UIColor(red: 0.35, green: 0.06, blue: 0.08, alpha: 1) : bg.glow
        return UIGraphicsImageRenderer(size: size, format: f).image { c in
            let g = c.cgContext, cs = CGColorSpaceCreateDeviceRGB(), mid = CGPoint(x: 800, y: 440)
            UIColor(red: 0.027, green: 0.035, blue: 0.051, alpha: 1).setFill(); g.fill(CGRect(origin: .zero, size: size))
            func radial(_ center: CGPoint, _ r0: CGFloat, _ r1: CGFloat, _ stops: [(UIColor, CGFloat)]) {
                let grad = CGGradient(colorsSpace: cs, colors: stops.map { $0.0.cgColor } as CFArray, locations: stops.map { $0.1 })!
                g.drawRadialGradient(grad, startCenter: center, startRadius: r0, endCenter: center, endRadius: r1, options: [])
            }
            // room light: a wide soft glow behind everything
            radial(mid, 0, 900, [(glowCol.withAlphaComponent(1), 0), (glowCol.withAlphaComponent(0.0), 1)])
            radial(mid, 0, 560, [(accent.withAlphaComponent(mode == .idle ? 0.30 : 0.50), 0), (accent.withAlphaComponent(0), 1)])
            // ripples (listening) / waves (speaking) / calm halo (idle)
            if mode == .listening {
                for (i, r) in [380.0, 440.0, 500.0].enumerated() { g.setStrokeColor(accent.withAlphaComponent(0.34 - CGFloat(i) * 0.09).cgColor); g.setLineWidth(5); g.strokeEllipse(in: CGRect(x: mid.x - r, y: mid.y - r, width: r * 2, height: r * 2)) }
            }
            // the three rings
            let ringR: [CGFloat] = [292, 252, 214]
            for (k, r) in ringR.enumerated() {
                g.setStrokeColor(accent.withAlphaComponent([1.0, 0.7, 0.45][k]).cgColor); g.setLineWidth([12, 8, 5][k]); g.setLineCap(.round)
                if mode == .thinking {
                    for seg in 0..<3 { let a0 = CGFloat(seg) * 2.09 + CGFloat(k) * 0.7; g.addArc(center: mid, radius: r, startAngle: a0, endAngle: a0 + 1.45, clockwise: false); g.strokePath() }
                } else if mode == .speaking {
                    let path = CGMutablePath(); let n = 180
                    for i in 0...n { let a = CGFloat(i) / CGFloat(n) * 2 * .pi; let rr = r + sin(a * CGFloat(6 + k * 2)) * (14 - CGFloat(k) * 3); let p = CGPoint(x: mid.x + rr * cos(a), y: mid.y + rr * sin(a)); i == 0 ? path.move(to: p) : path.addLine(to: p) }
                    path.closeSubpath(); g.addPath(path); g.strokePath()
                } else { g.strokeEllipse(in: CGRect(x: mid.x - r, y: mid.y - r, width: r * 2, height: r * 2)) }
            }
            // the glowing sphere
            radial(CGPoint(x: mid.x - 40, y: mid.y - 50), 0, 190, [(UIColor.white.withAlphaComponent(0.95), 0), (accent.withAlphaComponent(0.95), 0.45), (accent.withAlphaComponent(0.30), 1)])
            g.saveGState(); g.addEllipse(in: CGRect(x: mid.x - 170, y: mid.y - 170, width: 340, height: 340)); g.clip()
            radial(mid, 0, 200, [(accent.withAlphaComponent(0.15), 0.55), (UIColor.black.withAlphaComponent(0.35), 1)]); g.restoreGState()
            // sparks
            if mode != .error {
                var seed: UInt64 = 11
                for _ in 0..<42 {
                    seed = seed &* 6364136223846793005 &+ 1442695040888963407; let a = CGFloat(seed >> 40 & 0xFFF) / 4095 * 2 * .pi
                    seed = seed &* 6364136223846793005 &+ 1442695040888963407; let rr = 330 + CGFloat(seed >> 40 & 0xFFF) / 4095 * 170
                    seed = seed &* 6364136223846793005 &+ 1442695040888963407; let sz = 5 + CGFloat(seed >> 40 & 0xFFF) / 4095 * 9
                    g.setFillColor(accent.withAlphaComponent(0.55 + CGFloat(sz) / 30).cgColor); g.fillEllipse(in: CGRect(x: mid.x + rr * cos(a) - sz / 2, y: mid.y + rr * sin(a) * 0.82 - sz / 2, width: sz, height: sz))
                }
            }
        }
    }

    /// A calm dark backdrop with a soft accent glow low on the screen, so the bright orb in front of it stands out.
    static func backdrop(_ bg: CarBackground) -> UIImage {
        let size = CGSize(width: 1600, height: 900)
        let f = UIGraphicsImageRendererFormat(); f.scale = 1; f.opaque = true
        return UIGraphicsImageRenderer(size: size, format: f).image { c in
            let g = c.cgContext, cs = CGColorSpaceCreateDeviceRGB()
            UIColor(red: 0.02, green: 0.027, blue: 0.045, alpha: 1).setFill(); g.fill(CGRect(origin: .zero, size: size))
            func radial(_ center: CGPoint, _ r: CGFloat, _ col: UIColor, _ a: CGFloat) {
                let grad = CGGradient(colorsSpace: cs, colors: [col.withAlphaComponent(a).cgColor, col.withAlphaComponent(0).cgColor] as CFArray, locations: [0, 1])!
                g.drawRadialGradient(grad, startCenter: center, startRadius: 0, endCenter: center, endRadius: r, options: [])
            }
            radial(CGPoint(x: 800, y: 980), 900, bg.glow, 0.95)
            radial(CGPoint(x: 800, y: 420), 520, bg.accent, 0.10)
        }
    }
}

extension UIColor {
    func blended(with other: UIColor, _ t: CGFloat) -> UIColor {
        var a: (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0), b: (CGFloat, CGFloat, CGFloat, CGFloat) = (0, 0, 0, 0)
        getRed(&a.0, green: &a.1, blue: &a.2, alpha: &a.3); other.getRed(&b.0, green: &b.1, blue: &b.2, alpha: &b.3)
        return UIColor(red: a.0 + (b.0 - a.0) * t, green: a.1 + (b.1 - a.1) * t, blue: a.2 + (b.2 - a.2) * t, alpha: 1)
    }
}
