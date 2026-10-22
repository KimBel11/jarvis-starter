'use strict';
// Private links to a file on this Mac (a video, a voice note…) for texting to your phone.
// A link is a long random token for ONE file, valid 48 hours, served over your Tailscale address only. No login is needed to open it.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIME = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.webm': 'video/webm', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
const TTL = 48 * 3600e3;

module.exports = function makeShare(ctx) {
  const FILE = path.join(ctx.DATA, 'shares.json'); let links = {};
  try { links = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  const save = () => { try { fs.writeFileSync(FILE, JSON.stringify(links), { mode: 0o600 }); } catch {} };
  const prune = () => { const now = Date.now(); let ch = false; for (const [k, v] of Object.entries(links)) if (v.exp < now) { delete links[k]; ch = true; } if (ch) save(); };
  setInterval(prune, 3600e3).unref();

  function create(file) {
    const f = path.resolve(file); if (!fs.existsSync(f) || !fs.statSync(f).isFile()) throw new Error('That file does not exist.'); if (!ctx.isAllowed(f)) throw new Error('That file is outside the folders Jarvis may use.');
    const token = crypto.randomBytes(24).toString('hex'); links[token] = { file: f, name: path.basename(f), exp: Date.now() + TTL }; save();
    const host = ctx.remoteHost && ctx.remoteHost(); const base = host ? 'https://' + host : 'http://localhost:' + (process.env.JARVIS_PORT || 4777);
    return { url: `${base}/v/${token}/${encodeURIComponent(path.basename(f))}`, token, local: !host };
  }
  return {
    create,
    async handle(req, res, url, p) {
      if (p === '/api/share/create' && req.method === 'POST') { try { const b = await ctx.readBody(req); return ctx.send(res, 200, create(String(b.file || ''))), true; } catch (e) { return ctx.send(res, 400, { error: String(e.message || e) }), true; } }
      const m = p.match(/^\/v\/([a-f0-9]{48})(?:\/.*)?$/); if (!m) return false;
      const l = links[m[1]]; if (!l || l.exp < Date.now() || !fs.existsSync(l.file)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('This link has expired.'); return true; }
      const st = fs.statSync(l.file); const type = MIME[path.extname(l.file).toLowerCase()] || 'application/octet-stream'; const range = req.headers.range && req.headers.range.match(/bytes=(\d*)-(\d*)/);
      const hdr = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline; filename="' + l.name.replace(/"/g, '') + '"' };
      if (range) { let a = range[1] === '' ? Math.max(0, st.size - +range[2]) : +range[1]; let b = range[1] === '' || range[2] === '' ? st.size - 1 : Math.min(+range[2], st.size - 1); if (a > b || a >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return true; } res.writeHead(206, { ...hdr, 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Content-Length': b - a + 1 }); fs.createReadStream(l.file, { start: a, end: b }).pipe(res); return true; }
      res.writeHead(200, { ...hdr, 'Content-Length': st.size }); fs.createReadStream(l.file).pipe(res); return true;
    },
  };
};
