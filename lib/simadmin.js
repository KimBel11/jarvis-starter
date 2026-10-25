'use strict';
// Admin app in the iOS Simulator: open it, keep it running, look at its screen from anywhere.
// The app is signed in once by @@NAME@@ inside the Simulator; the Simulator keeps that session, so it stays on the admin account.
// Jarvis never types passwords. Screens of the admin app are sensitive, so remote sessions need the passphrase step-up (see remote.js).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, execFileSync, spawn } = require('child_process');

const run = (cmd, args, ms = 30000) => new Promise((resolve) => execFile(cmd, args, { timeout: ms, maxBuffer: 20 * 1024 * 1024, encoding: 'utf8' }, (err, out, errOut) => resolve({ ok: !err, out: out || '', err: (errOut || (err && err.message) || '').trim() })));
const BUNDLE_RE = /^[A-Za-z0-9.-]{3,120}$/;

module.exports = function makeSim(ctx) {
  const FILE = path.join(ctx.DATA, 'sim.json'); let st = { keep: {}, device: {} };
  try { st = { ...st, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}
  const save = () => { try { fs.writeFileSync(FILE, JSON.stringify(st)); } catch {} };
  const project = (id) => ctx.state.projects.find((p) => p.id === id);
  const simApp = (pr) => ((pr && pr.workspace && pr.workspace.apps) || []).find((a) => a.sim && a.sim.bundleId);

  async function devices() {
    const r = await run('xcrun', ['simctl', 'list', 'devices', 'available', '-j']); if (!r.ok) return [];
    let j; try { j = JSON.parse(r.out); } catch { return []; } const out = [];
    for (const [rt, list] of Object.entries(j.devices || {})) for (const d of list) if (/iPhone|iPad/.test(d.name)) out.push({ udid: d.udid, name: d.name, state: d.state, runtime: rt.replace(/.*SimRuntime\./, '').replace(/-/g, '.') });
    return out;
  }
  async function pick(pid) {
    const all = await devices(); if (!all.length) return { all, dev: null };
    const want = st.device[pid]; let dev = all.find((d) => d.udid === want) || all.find((d) => d.state === 'Booted') || all.find((d) => /iPhone .*Pro$/.test(d.name)) || all[0];
    return { all, dev };
  }
  async function installed(udid, bundle) { const r = await run('xcrun', ['simctl', 'get_app_container', udid, bundle]); return r.ok; }
  async function running(udid, bundle) { const r = await run('xcrun', ['simctl', 'spawn', udid, 'launchctl', 'list']); return r.ok && r.out.includes('UIKitApplication:' + bundle); }
  // newest simulator build of this app inside the project (dev-caches/DerivedData-sim), matched by bundle id
  const builtApp = (pr, bundle) => {
    const base = path.join(pr.path, 'dev-caches', 'DerivedData-sim', 'Build', 'Products'); let best = null;
    let cfgs = []; try { cfgs = fs.readdirSync(base).filter((x) => /-iphonesimulator$/.test(x)); } catch { return null; }
    for (const c of cfgs) { let apps = []; try { apps = fs.readdirSync(path.join(base, c)).filter((x) => x.endsWith('.app')); } catch {} for (const a of apps) { const f = path.join(base, c, a); let id = ''; try { id = execFileSync('plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', path.join(f, 'Info.plist')], { encoding: 'utf8', timeout: 5000 }).trim(); } catch {} if (id === bundle) { const m = fs.statSync(f).mtimeMs; if (!best || m > best.m) best = { f, m }; } } }
    return best;
  };
  const jobs = {}; // project id -> { running, ok, startedAt, finishedAt, tail }
  function build(pid) {
    const pr = project(pid); const app = simApp(pr); if (!app || !app.sim.build) throw new Error('No build command is set up for this app'); if (jobs[pid] && jobs[pid].running) throw new Error('A build is already running');
    const b = app.sim.build; const cwd = path.resolve(pr.path, b.cwd || '.'); if (!fs.existsSync(cwd)) throw new Error('Build folder not found');
    const dd = path.join(pr.path, 'dev-caches', 'DerivedData-sim'); fs.mkdirSync(dd, { recursive: true });
    const args = [...(b.args || []), '-derivedDataPath', dd, 'build']; const j = (jobs[pid] = { running: true, ok: null, startedAt: Date.now(), tail: [], note: '' });
    const env = { ...process.env, HOME: ctx.HOME, PATH: [path.join(ctx.HOME, '.local/node/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':') };
    const child = spawn('xcodebuild', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }); let buf = '';
    const feed = (d) => { buf += d.toString(); const lines = buf.split('\n'); buf = lines.pop(); for (const l of lines) { if (l.trim()) { j.tail.push(l.slice(0, 160)); if (j.tail.length > 14) j.tail.shift(); } } };
    child.stdout.on('data', feed); child.stderr.on('data', feed);
    child.on('close', async (code) => { j.running = false; j.ok = code === 0; j.finishedAt = Date.now(); if (j.ok) { try { await install(pid); j.note = 'Installed and opened.'; } catch (e) { j.note = e.message; } } });
    child.on('error', (e) => { j.running = false; j.ok = false; j.note = e.message; });
    return j;
  }

  async function status(pid) {
    const pr = project(pid); const app = simApp(pr); if (!app) return { enabled: false };
    const { all, dev } = await pick(pid); if (!dev) return { enabled: true, error: 'No iOS Simulator found. Install Xcode and an iOS runtime.', devices: [] };
    const b = app.sim.bundleId; const booted = dev.state === 'Booted'; const inst = booted ? await installed(dev.udid, b) : null; const runn = booted && inst ? await running(dev.udid, b) : false;
    return { enabled: true, app: app.name, label: app.sim.label || '', bundleId: b, device: dev, devices: all, booted, installed: inst, running: runn, keep: !!st.keep[pid], buildAvailable: !!builtApp(pr, b), builtAt: (builtApp(pr, b) || {}).m || null, canBuild: !!app.sim.build, build: jobs[pid] || null, checkedAt: Date.now() };
  }
  async function open(pid) {
    const pr = project(pid); const app = simApp(pr); if (!app) throw new Error('No simulator app for this project'); const { dev } = await pick(pid); if (!dev) throw new Error('No iOS Simulator found');
    const b = app.sim.bundleId; if (!BUNDLE_RE.test(b)) throw new Error('bad bundle id');
    if (dev.state !== 'Booted') { const r = await run('xcrun', ['simctl', 'boot', dev.udid], 90000); if (!r.ok && !/current state: Booted/i.test(r.err)) throw new Error('Could not start the Simulator: ' + r.err.slice(0, 160)); await run('xcrun', ['simctl', 'bootstatus', dev.udid], 90000); }
    // simctl runs the device in the background; Jarvis owns the preview UI.
    if (!(await installed(dev.udid, b))) throw new Error(`${app.name} is not installed in this Simulator yet. Use "Install latest build".`);
    const l = await run('xcrun', ['simctl', 'launch', dev.udid, b]); if (!l.ok) throw new Error('Could not open the app: ' + l.err.slice(0, 160));
    return status(pid);
  }
  async function install(pid) {
    const pr = project(pid); const app = simApp(pr); if (!app) throw new Error('No simulator app'); const { dev } = await pick(pid); if (!dev) throw new Error('No iOS Simulator found'); const bb = builtApp(pr, app.sim.bundleId); const f = bb && bb.f;
    if (!f) throw new Error('No simulator build found. Build it first (Apps tab › Simulator release build).');
    if (dev.state !== 'Booted') { await run('xcrun', ['simctl', 'boot', dev.udid], 90000); await run('xcrun', ['simctl', 'bootstatus', dev.udid], 90000); }
    const r = await run('xcrun', ['simctl', 'install', dev.udid, f], 120000); if (!r.ok) throw new Error('Install failed: ' + r.err.slice(0, 160)); return open(pid);
  }
  async function stop(pid) { const pr = project(pid); const app = simApp(pr); if (!app) throw new Error('No simulator app'); const { dev } = await pick(pid); if (dev && dev.state === 'Booted') await run('xcrun', ['simctl', 'terminate', dev.udid, app.sim.bundleId]); st.keep[pid] = false; save(); return status(pid); }
  async function shot(pid) {
    const { dev } = await pick(pid); if (!dev || dev.state !== 'Booted') throw new Error('The Simulator is not running'); const f = path.join(os.tmpdir(), 'jarvis-sim-' + process.pid + '.jpg');
    const r = await run('xcrun', ['simctl', 'io', dev.udid, 'screenshot', '--type=jpeg', f]); if (!r.ok) throw new Error('Could not take a picture of the screen'); const buf = fs.readFileSync(f); try { fs.unlinkSync(f); } catch {} return buf;
  }
  // keep-alive: every 30 s, if "keep it open" is on, start the Simulator / the app again when it is not running
  let busy = false;
  setInterval(async () => {
    if (busy) return; const pids = Object.keys(st.keep).filter((k) => st.keep[k]); if (!pids.length) return; busy = true;
    try { for (const pid of pids) { const s = await status(pid); if (s.enabled && !s.error && (!s.booted || !s.running)) await open(pid).catch(() => {}); } } finally { busy = false; }
  }, 30000).unref();

  return {
    async handle(req, res, url, p) {
      if (!p.startsWith('/api/sim')) return false; const S = (c, b) => (ctx.send(res, c, b), true);
      try {
        const pid = url.searchParams.get('project') || '';
        if (p === '/api/sim/status') return S(200, await status(pid));
        if (p === '/api/sim/shot') { const buf = await shot(pid); res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' }); res.end(buf); return true; }
        const b = req.method === 'POST' ? await ctx.readBody(req) : {}; const id = b.project || pid; if (!project(id)) return S(404, { error: 'unknown project' });
        if (p === '/api/sim/open' && req.method === 'POST') return S(200, await open(id));
        if (p === '/api/sim/build' && req.method === 'POST') { build(id); return S(200, await status(id)); }
        if (p === '/api/sim/install' && req.method === 'POST') return S(200, await install(id));
        if (p === '/api/sim/stop' && req.method === 'POST') return S(200, await stop(id));
        if (p === '/api/sim/keep' && req.method === 'POST') { st.keep[id] = !!b.on; save(); if (b.on) await open(id).catch(() => {}); return S(200, await status(id)); }
        if (p === '/api/sim/device' && req.method === 'POST') { const all = await devices(); if (!all.some((d) => d.udid === b.udid)) return S(400, { error: 'unknown device' }); st.device[id] = b.udid; save(); return S(200, await status(id)); }
      } catch (e) { return S(400, { error: String(e.message || e) }); }
      return false;
    },
  };
};
