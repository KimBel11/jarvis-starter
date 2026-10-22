'use strict';
// Jarvis orb: a living canvas orb that reacts to idle / listening / thinking / speaking / error.
const ORB_STATES = {
  idle:      { amp: 0.05, spd: 0.5, hue: 190, glow: 0.55, spin: 0, rip: 0 },
  listening: { amp: 0.07, spd: 1.1, hue: 158, glow: 0.85, spin: 0, rip: 1 },
  thinking:  { amp: 0.10, spd: 2.3, hue: 268, glow: 0.95, spin: 1, rip: 0 },
  speaking:  { amp: 0.08, spd: 1.6, hue: 28,  glow: 0.95, spin: 0, rip: 1 },
  error:     { amp: 0.12, spd: 1.8, hue: 352, glow: 0.9,  spin: 0, rip: 0 },
};
const MODEL_HUE = { claude: 20, codex: 226, gemini: 268 };
const MODEL_LM = { claude: -22, codex: -20, gemini: -18 }; // darker layers so additive blending stays orange / blue instead of washing out to yellow / cyan
for (const k of Object.keys(ORB_STATES)) { ORB_STATES[k].sat = 95; ORB_STATES[k].spread = 26; ORB_STATES[k].lm = 0; } // colour variation between the morphing layers
class Orb {
  static all = new Set();
  static running = false;
  static model = null; // 'claude' | 'codex'
  static level = 0; // 0..1 live audio level (mic or speech), set from outside
  constructor(canvas) {
    this.c = canvas; this.x = canvas.getContext('2d');
    this.state = (window.Jarvis && Jarvis.state) || 'idle';
    this.p = { ...ORB_STATES[this.state] };
    this.t = Math.random() * 10; this.lv = 0;
    this.parts = Array.from({ length: 56 }, () => ({ a: Math.random() * 6.283, r: 1.22 + Math.random() * 0.6, s: 0.08 + Math.random() * 0.35, z: Math.random() }));
    this.resize();
    if (window.ResizeObserver) { this.observer=new ResizeObserver(() => this.resize());this.observer.observe(canvas); }
    Orb.all.add(this); Orb.start();
  }
  resize() { const d = Math.min(window.devicePixelRatio || 1, 2); const w = this.c.clientWidth || 160, h = this.c.clientHeight || 160; this.c.width = Math.round(w * d); this.c.height = Math.round(h * d); }
  setState(s) { this.state = ORB_STATES[s] ? s : 'idle'; }
  static setAll(s) { for (const o of Orb.all) o.setState(s); }
  static start() {
    if (Orb.running) return; Orb.running = true; let last = performance.now();
    const loop = (now) => {
      const raw = Math.min(0.5, (now - last) / 1000), dt = Math.min(0.05, raw); last = now;
      if (!document.hidden) for (const o of [...Orb.all]) { if (!o.c.isConnected) { o.observer?.disconnect();Orb.all.delete(o); continue; } o.frame(dt, raw); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  frame(dt, raw) {
    const { x, c, p } = this; let T = ORB_STATES[this.preview?'idle':this.state]; const k = 1 - Math.pow(0.001, raw || dt); // colour/shape easing uses real elapsed time, so it is frame-rate independent
    const appearance = window.JarvisAppearance?.get();
    if (appearance && (this.state === 'idle'||this.preview)) {
      const rgb = appearance.accent.slice(1).match(/../g).map(h => parseInt(h, 16) / 255);
      const max = Math.max(...rgb), min = Math.min(...rgb), d = max - min;
      let hue = 0;
      if (d) hue = (max === rgb[0] ? (rgb[1]-rgb[2])/d + (rgb[1]<rgb[2]?6:0) : max === rgb[1] ? (rgb[2]-rgb[0])/d+2 : (rgb[0]-rgb[1])/d+4)*60;
      const light=(max+min)/2, sat=d?100*d/(1-Math.abs(2*light-1)):0;
      T = { ...T, hue, sat, spread: 8, lm: -10 };
    }
    // while a model is working the orb takes its colour: Claude orange, Codex blue (idle and errors keep their own colours)
    const mh = MODEL_HUE[Orb.model]; if (!this.preview && mh !== undefined && this.state !== 'idle' && this.state !== 'error') T = { ...T, hue: mh, spread: 5, lm: MODEL_LM[Orb.model] };
    for (const key of Object.keys(T)) p[key] += (T[key] - p[key]) * Math.min(1, k * 1.6);
    let target = this.preview?0:Orb.level; if (!this.preview && this.state === 'speaking') target = Math.max(target, 0.22 + 0.14 * Math.sin(this.t * 4.2));
    this.lv += (target - this.lv) * Math.min(1, dt * 14);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.dataset.motion === 'reduced';
    const shape=appearance?.orb||'aurora', effect=appearance?.effect||'particles', motion=appearance?.motion||'subtle';
    if (reduced) {dt=0;this.lv=0;} else dt*=motion==='full'?1.5:motion==='subtle'?.55:.8;
    this.t += dt * p.spd;
    const w = c.width, h = c.height, cx = w / 2 + (!reduced&&motion==='drift'?Math.sin(this.t*.45)*w*.025:0), cy = h / 2 + (!reduced&&motion==='levitate'?Math.sin(this.t*.65)*h*.035:0), R = Math.min(w, h) * 0.25 * (!reduced&&motion==='subtle'?1+Math.sin(this.t*.8)*.018:1), t = this.t, lv = this.lv;
    const amp = p.amp + lv * 0.12, hue = p.hue;
    x.clearRect(0, 0, w, h); x.globalCompositeOperation = 'lighter';
    // halo
    // soft halo that always fades to nothing INSIDE the canvas (never clipped into a visible edge)
    const halo = Math.min(R * (1.9 + lv * 0.4), Math.min(w, h) * 0.49);
    let g = x.createRadialGradient(cx, cy, R * 0.3, cx, cy, halo);
    g.addColorStop(0, `hsla(${hue},${p.sat}%,60%,${0.26 * p.glow})`); g.addColorStop(0.6, `hsla(${hue + 30},${p.sat}%,55%,${0.06 * p.glow})`); g.addColorStop(1, `hsla(${hue},${p.sat}%,50%,0)`);
    if(effect!=='clean'){x.fillStyle = g; x.beginPath(); x.arc(cx, cy, halo, 0, 6.283); x.fill();}
    // ripples
    if (effect==='rings' || (effect!=='clean' && p.rip > 0.02)) for (let i = 0; i < 3; i++) {
      const ph = (this.t * 0.35 + i / 3) % 1, rr = Math.min(R * (1.05 + ph * (0.9 + lv)),Math.min(w,h)*.45);
      x.strokeStyle = `hsla(${hue},${p.sat}%,70%,${(1 - ph) * 0.35 * (effect==='rings'?.7:p.rip)})`; x.lineWidth = Math.max(1, w * 0.004); x.beginPath(); x.arc(cx, cy, rr, 0, 6.283); x.stroke();
    }
    if(shape==='halo'||shape==='orbit'){
      for(let i=0;i<(shape==='halo'?3:2);i++){x.save();x.translate(cx,cy);x.rotate((i?-.6:.5)+(reduced?0:t*.12));x.scale(1,shape==='halo'?1:.42);x.strokeStyle=`hsla(${hue+i*8},${p.sat}%,${70-i*8}%,${.85-i*.2})`;x.lineWidth=R*(shape==='halo'?.07:.025);x.beginPath();x.arc(0,0,R*(1.1+i*.15),0,Math.PI*2);x.stroke();x.restore();}
    }
    // Actual silhouette selection is shared by preview, dock and voice scene.
    if(shape!=='halo'){
    // morphing blobs
    const N = shape==='crystal'?6:80;
    for (let i = 0; i < 4; i++) {
      const hi = hue + (i - 1.5) * p.spread, rot = t * (0.32 + i * 0.16) * (i % 2 ? -1 : 1);
      x.beginPath();
      for (let j = 0; j <= N; j++) {
        const a = (j / N) * 6.283;
        const r = R * (shape==='crystal'?.9:1) * (1 + (shape==='minimal'||shape==='crystal'?0:amp) * (Math.sin(a * 3 + t * 1.3 + i * 2) * 0.6 + Math.sin(a * 5 - t * 0.9 + i) * 0.3 + Math.sin(a * 2 + t * 0.7 - i) * 0.5)) * (1 + 0.035 * i);
        const rotation=shape==='minimal'?0:shape==='crystal'?(reduced?0:t*.08)+Math.PI/6:rot;const px = cx + Math.cos(a + rotation) * r, py = cy + Math.sin(a + rotation) * r;
        j ? x.lineTo(px, py) : x.moveTo(px, py);
      }
      x.closePath();
      g = x.createRadialGradient(cx - R * 0.2, cy - R * 0.25, R * 0.1, cx, cy, R * 1.25);
      g.addColorStop(0, `hsla(${hi},${p.sat}%,${78 + p.lm}%,0.55)`); g.addColorStop(0.6, `hsla(${hi},${p.sat}%,${55 + p.lm}%,0.22)`); g.addColorStop(1, `hsla(${hi},${p.sat}%,${45 + p.lm}%,0.05)`);
      x.fillStyle = g; x.fill();if(shape==='crystal'){x.strokeStyle=`hsla(${hi},${p.sat}%,80%,.3)`;x.lineWidth=Math.max(1,w*.002);x.stroke();}
    }
    // bright core
    g = x.createRadialGradient(cx - R * 0.15, cy - R * 0.2, 0, cx, cy, R * 0.7);
    g.addColorStop(0, `hsla(${hue},${p.sat}%,${92 + p.lm * 0.9}%,${0.75 + lv * 0.25})`); g.addColorStop(0.5, `hsla(${hue},${p.sat}%,${70 + p.lm}%,0.25)`); g.addColorStop(1, `hsla(${hue},${p.sat}%,60%,0)`);
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, R * 0.7, 0, 6.283); x.fill();
    }
    // orbiting particles
    if(effect==='particles') for (const q of this.parts) {
      q.a += q.s * dt * (1 + p.spin * 3.5 + lv * 2);
      const rr = R * q.r * (1 + lv * 0.18), px = cx + Math.cos(q.a) * rr, py = cy + Math.sin(q.a) * rr * (0.92 + 0.08 * Math.sin(t + q.z * 6));
      x.fillStyle = `hsla(${hue + q.z * 40},${p.sat}%,75%,${0.18 + q.z * 0.55})`; x.beginPath(); x.arc(px, py, Math.max(0.6, w * (0.0035 + q.z * 0.004)), 0, 6.283); x.fill();
    }
    // thinking comet arc
    if (p.spin > 0.04) {
      x.lineCap = 'round';
      for (let i = 0; i < 2; i++) {
        const a0 = t * 2.4 * (i ? -0.7 : 1) + i * 3, len = 1.25;
        x.strokeStyle = `hsla(${hue + i * 40},${p.sat}%,75%,${0.75 * p.spin})`; x.lineWidth = Math.max(1.5, w * 0.009); x.beginPath(); x.arc(cx, cy, R * (1.17 + i * 0.1), a0, a0 + len); x.stroke();
      }
    }
    x.globalCompositeOperation = 'source-over';
  }
}
window.Orb = Orb;
