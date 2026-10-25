'use strict';
// Jarvis profile pictures: one picture for every orb style and colour (public/avatars/<orb>-<colour>.jpg).
// When the owner changes the orb or the colour, Jarvis texts the matching picture to them over iMessage with the steps to set it.
// (Apple has no way to change a profile photo from code, so the owner taps once to save and set it.)
const fs = require('fs');
const path = require('path');

const COLORS = [['glacier', '#2dd4ee', 'Glacier'], ['champagne', '#d7ad6a', 'Champagne'], ['amethyst', '#a78bfa', 'Amethyst'], ['jade', '#55d6a1', 'Jade'], ['rose', '#ee92b8', 'Rose'], ['sapphire', '#5897ff', 'Sapphire'], ['ember', '#ff9364', 'Ember'], ['ruby', '#f06b83', 'Ruby'], ['ice', '#d6f5ff', 'Ice'], ['indigo', '#7569ee', 'Indigo']];
const ORBS = { aurora: 'Aurora', orbit: 'Orbit', minimal: 'Minimal', crystal: 'Crystal', halo: 'Halo' };

module.exports = function makeAvatar(ctx, deps) {
  const DIR = path.join(ctx.ROOT || path.dirname(__dirname), 'public', 'avatars');
  const FILE = path.join(ctx.DATA, 'avatar.json');
  let st = { last: null, at: 0 }; try { st = { ...st, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}
  const save = () => { try { fs.writeFileSync(FILE, JSON.stringify(st), { mode: 0o600 }); } catch {} };
  const rgb = (h) => h.slice(1).match(/../g).map((v) => parseInt(v, 16));
  const nearest = (hex) => { const a = rgb(/^#[0-9a-f]{6}$/i.test(hex) ? hex : '#2dd4ee'); return [...COLORS].sort((x, y) => rgb(x[1]).reduce((s, v, i) => s + (v - a[i]) ** 2, 0) - rgb(y[1]).reduce((s, v, i) => s + (v - a[i]) ** 2, 0))[0]; };
  const pick = (orb, accent) => { const o = ORBS[orb] ? orb : 'aurora'; const c = nearest(accent); const key = `${o}-${c[0]}`; return { key, orb: o, orbName: ORBS[o], color: c[0], colorName: c[2], file: path.join(DIR, key + '.jpg') }; };
  const MSG = (p) => `Your Jarvis profile picture is ready: ${p.orbName} · ${p.colorName}\n{link}\n\nTo use it:\n1. Tap the link, then tap and hold the picture → Save to Photos.\n2. Contacts → Jarvis → Edit → Add Photo → choose it. (If Jarvis has its own Apple ID: Messages → open it → its name → Name & Photo.)\nI send a new picture every time you change the orb or the colour.`;

  async function send(p) {
    if (!fs.existsSync(p.file)) return { sent: false, reason: 'No picture for ' + p.key };
    if (!deps.imessage || !deps.imessage.sendLink) return { sent: false, reason: 'iMessage is not available' };
    const r = await deps.imessage.sendLink(MSG(p), p.file);
    if (r.sent) { st.last = p.key; st.at = Date.now(); save(); }
    return { ...r, key: p.key };
  }

  return {
    pick, list: () => fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith('.jpg')) : [],
    async handle(req, res, url, p) {
      const S = ctx.send;
      if (p === '/api/avatar/list' && req.method === 'GET') return S(res, 200, { avatars: this.list(), last: st.last, colors: COLORS.map((c) => c[0]), orbs: Object.keys(ORBS) }), true;
      if (p === '/api/avatar/changed' && req.method === 'POST') {
        const b = await ctx.readBody(req); const pk = pick(String(b.orb || ''), String(b.accent || ''));
        if (pk.key === st.last) return S(res, 200, { sent: false, reason: 'unchanged', key: pk.key }), true;
        try { return S(res, 200, await send(pk)), true; } catch (e) { return S(res, 500, { error: String(e.message || e) }), true; }
      }
      if (p === '/api/avatar/send-test' && req.method === 'POST') {
        const b = await ctx.readBody(req); const pk = pick(String(b.orb || 'aurora'), String(b.accent || '#7569ee'));
        try { return S(res, 200, await send(pk)), true; } catch (e) { return S(res, 500, { error: String(e.message || e) }), true; }
      }
      return false;
    },
  };
};
