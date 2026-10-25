'use strict';
// Voice notes: @@ASSISTANT@@ leaves you a spoken message instead of text. Made with your ElevenLabs voice through Jarvis' own /api/tts,
// saved as .m4a (plays inline in iMessage) and served to the Jarvis chat.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

module.exports = function makeVoiceNotes(ctx) {
  const DIR = path.join(ctx.DATA, 'voicenotes'); fs.mkdirSync(DIR, { recursive: true });
  const base = () => 'http://127.0.0.1:' + (process.env.JARVIS_PORT || 4777);
  const run = (cmd, args) => new Promise((res) => execFile(cmd, args, { timeout: 60000 }, (e) => res(!e)));
  const speakable = (t) => String(t || '').replace(/[`*_#>|]/g, '').replace(/https?:\/\/\S+/g, 'a link').replace(/\s+/g, ' ').trim().slice(0, 1800);

  // returns { id, file, mime } or null when speech is not available (no key, credits used up...)
  async function make(text, lang) {
    const t = speakable(text); if (!t) return null;
    try {
      const r = await fetch(base() + '/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: t, lang: lang || 'en' }), signal: AbortSignal.timeout(90000) });
      if (!r.ok) return null; const buf = Buffer.from(await r.arrayBuffer()); if (buf.length < 1500) return null;
      const id = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); const mp3 = path.join(DIR, id + '.mp3'); fs.writeFileSync(mp3, buf);
      const m4a = path.join(DIR, id + '.m4a'); const ok = await run('/usr/bin/afconvert', ['-f', 'm4af', '-d', 'aac', '-b', '64000', mp3, m4a]);
      if (ok && fs.existsSync(m4a)) return { id, file: m4a, mime: 'audio/mp4' }; return { id, file: mp3, mime: 'audio/mpeg' };
    } catch { return null; }
  }
  const find = (id) => { id = String(id || '').replace(/[^a-z0-9]/g, ''); for (const [ext, mime] of [['m4a', 'audio/mp4'], ['mp3', 'audio/mpeg']]) { const f = path.join(DIR, id + '.' + ext); if (fs.existsSync(f)) return { file: f, mime }; } return null; };
  // keep the folder small: remove notes older than two weeks
  setInterval(() => { try { for (const f of fs.readdirSync(DIR)) { const p = path.join(DIR, f); if (Date.now() - fs.statSync(p).mtimeMs > 14 * 864e5) fs.unlinkSync(p); } } catch {} }, 6 * 3600e3).unref();

  return {
    make, find,
    async handle(req, res, url, p) {
      if (p !== '/api/voicenote') return false; const f = find(url.searchParams.get('id')); if (!f) return ctx.send(res, 404, { error: 'not found' }), true;
      const st = fs.statSync(f.file); res.writeHead(200, { 'Content-Type': f.mime, 'Content-Length': st.size, 'Cache-Control': 'private, max-age=86400' }); fs.createReadStream(f.file).pipe(res); return true;
    },
  };
};
