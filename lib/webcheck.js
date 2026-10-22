'use strict';
// Website health (is it up, how fast) and a live preview picture of each project website, for both projects alike.
// Only addresses that are saved in a project's workspace are ever fetched. Pictures are taken with the Chrome already on this Mac.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ID_RE = /^[a-z0-9-]{1,60}$/;

module.exports = function makeWebcheck(ctx) {
  const DIR = path.join(ctx.DATA, 'shots'); fs.mkdirSync(DIR, { recursive: true });
  const health = new Map(); const shooting = new Map();
  const site = (pid, id) => { const pr = ctx.state.projects.find((p) => p.id === pid); const s = pr && ((pr.workspace || {}).websites || []).find((x) => x.id === id); return s && /^https:\/\//.test(s.url || '') ? s : null; };

  async function check(s) {
    const t0 = Date.now();
    try { const r = await fetch(s.url, { redirect: 'follow', signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'Mozilla/5.0 JarvisCheck' } }); return { id: s.id, up: r.status < 500, status: r.status, ms: Date.now() - t0, finalUrl: r.url, https: r.url.startsWith('https:'), at: Date.now() }; }
    catch (e) { return { id: s.id, up: false, status: 0, ms: Date.now() - t0, error: String(e.message || e).slice(0, 100), at: Date.now() }; }
  }
  async function healthOf(pid, force) {
    const pr = ctx.state.projects.find((p) => p.id === pid); if (!pr) throw new Error('unknown project'); const out = [];
    for (const s of ((pr.workspace || {}).websites || []).filter((x) => /^https:\/\//.test(x.url || ''))) { const k = pid + ':' + s.id; const c = health.get(k); if (!force && c && Date.now() - c.at < 60000) { out.push(c); continue; } const r = await check(s); health.set(k, r); out.push(r); }
    return out;
  }
  const shotFile = (pid, id) => path.join(DIR, pid + '__' + id + '.png');
  function takeShot(s, file) {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(CHROME)) return reject(new Error('Google Chrome is not installed here'));
      const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-shot-')); const tmp = file + '.tmp.png';
      execFile(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--user-data-dir=' + prof, '--window-size=1280,800', '--virtual-time-budget=9000', '--screenshot=' + tmp, s.url], { timeout: 45000 }, (err) => {
        try { fs.rmSync(prof, { recursive: true, force: true }); } catch {}
        if (fs.existsSync(tmp) && fs.statSync(tmp).size > 2000) { fs.renameSync(tmp, file); return resolve(); } try { fs.unlinkSync(tmp); } catch {} reject(new Error('Could not take a picture of the website'));
      });
    });
  }
  return {
    healthOf,
    async handle(req, res, url, p) {
      if (!p.startsWith('/api/web')) return false; const S = (c, b) => (ctx.send(res, c, b), true);
      try {
        const pid = url.searchParams.get('project') || '';
        if (p === '/api/web/health') return S(200, { sites: await healthOf(pid, url.searchParams.get('force') === '1') });
        if (p === '/api/web/shot') {
          const id = url.searchParams.get('id') || ''; if (!ID_RE.test(pid) || !ID_RE.test(id)) return S(400, { error: 'bad request' }); const s = site(pid, id); if (!s) return S(404, { error: 'unknown website' });
          const f = shotFile(pid, id); const fresh = fs.existsSync(f) && Date.now() - fs.statSync(f).mtimeMs < 6 * 3600e3;
          if (!fresh || url.searchParams.get('refresh') === '1') { const k = pid + id; if (!shooting.has(k)) shooting.set(k, takeShot(s, f).finally(() => shooting.delete(k))); try { await shooting.get(k); } catch (e) { if (!fs.existsSync(f)) return S(502, { error: e.message }); } }
          res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }); res.end(fs.readFileSync(f)); return true;
        }
      } catch (e) { return S(400, { error: String(e.message || e) }); }
      return false;
    },
  };
};
