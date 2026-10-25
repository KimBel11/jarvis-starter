'use strict';
// Per-project workspace: apps, websites, social media, video editing/generation, each tied to an agent.
// Static knowledge lives in state.json (editable); live details (versions, recent files, raw footage) are resolved here.
const fs = require('fs');
const path = require('path');

const DEFAULTS = {}; // no pre-filled projects: every workspace is set up by its owner
const VIDEO_X = /\.(mp4|mov|m4v|webm)$/i, IMG_X = /\.(jpg|jpeg|png|webp|heic)$/i;

module.exports = function makeWorkspace(ctx) {
  const abs = (p, rel) => (rel ? path.resolve(p.path, rel) : p.path);
  function ensure() {
    let changed = false;
    for (const p of ctx.state.projects) if (!p.workspace && DEFAULTS[p.id]) { p.workspace = JSON.parse(JSON.stringify(DEFAULTS[p.id])); changed = true; }
    for (const p of ctx.state.projects) { const so = p.workspace && p.workspace.social; const d = DEFAULTS[p.id] && DEFAULTS[p.id].social; if (so && d) { for (const k of ['ledger', 'ledgerFormat', 'finalDirs']) if (so[k] == null) { so[k] = d[k]; changed = true; } } }
    // apps added before bundle ids / simulator access existed get them from the defaults
    for (const p of ctx.state.projects) for (const a of (p.workspace && p.workspace.apps) || []) { const d = ((DEFAULTS[p.id] || {}).apps || []).find((x) => x.id === a.id); if (d) for (const k of ['bundleId', 'sim']) if (a[k] == null && d[k] != null) { a[k] = JSON.parse(JSON.stringify(d[k])); changed = true; } if (d && d.sim && a.sim && !a.sim.build && d.sim.build) { a.sim.build = JSON.parse(JSON.stringify(d.sim.build)); changed = true; } }
    if (changed) ctx.saveState(ctx.state);
  }
  function appInfo(dir) {
    const out = { exists: fs.existsSync(dir) };
    if (!out.exists) return out;
    try { const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); out.name = pkg.name; out.version = pkg.version; out.expo = (pkg.dependencies || {}).expo || null; out.rn = (pkg.dependencies || {})['react-native'] || null; out.scripts = Object.keys(pkg.scripts || {}); } catch {}
    try { const j = JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8')).expo || {}; out.appName = j.name; out.appVersion = j.version; out.bundleId = j.ios && j.ios.bundleIdentifier; out.buildNumber = j.ios && j.ios.buildNumber; out.androidPackage = j.android && j.android.package; out.versionCode = j.android && j.android.versionCode; } catch {}
    try { const ios = path.join(dir, 'ios'); const w = fs.readdirSync(ios).find((f) => f.endsWith('.xcworkspace')); if (w) out.xcworkspace = path.join(ios, w); } catch {}
    return out;
  }
  const filesIn = (data, dir, test, n) => (data ? data.all.filter((f) => f.path.startsWith(dir + path.sep) && test(f)).sort((a, b) => b.mtime - a.mtime) : []);
  function resolve(p) {
    const w = p.workspace; if (!w) return null; const sc = ctx.getScan(p); const d = sc && sc.data;
    const slim = (f) => ({ path: f.path, rel: path.relative(p.path, f.path), size: f.size, mtime: f.mtime, kind: f.kind });
    const apps = (w.apps || []).map((a) => { const dir = abs(p, a.path); const info = appInfo(dir); const recent = d ? d.all.filter((f) => f.path.startsWith(dir + path.sep) && !/\/(ios|android)\/(Pods|build)\//.test(f.path)).sort((x, y) => y.mtime - x.mtime).slice(0, 6).map(slim) : []; return { ...a, abs: dir, info, recent }; });
    const websites = (w.websites || []).map((s) => { const dir = abs(p, s.path); const recent = d ? d.all.filter((f) => f.path.startsWith(dir + path.sep)).sort((x, y) => y.mtime - x.mtime).slice(0, 5).map(slim) : []; return { ...s, abs: dir, exists: fs.existsSync(dir), recent }; });
    const social = w.social ? (() => { const dir = abs(p, w.social.path); const files = filesIn(d, dir, (f) => f.kind === 'video' || f.kind === 'image' || f.kind === 'doc'); return { ...w.social, abs: dir, exists: fs.existsSync(dir), count: files.length, recent: files.slice(0, 6).map(slim) }; })() : null;
    const vid = w.video ? (() => { const raw = abs(p, w.video.rawPath), ready = abs(p, w.video.readyPath), gen = abs(p, w.video.genPath); const rf = filesIn(d, raw, (f) => VIDEO_X.test(f.path) || IMG_X.test(f.path)); const df = filesIn(d, ready, (f) => VIDEO_X.test(f.path)); const gf = filesIn(d, gen, (f) => VIDEO_X.test(f.path)); return { ...w.video, rawAbs: raw, readyAbs: ready, genAbs: gen, raw: { exists: fs.existsSync(raw), count: rf.length, recent: rf.slice(0, 8).map(slim) }, ready: { exists: fs.existsSync(ready), count: df.length, recent: df.slice(0, 8).map(slim) }, generated: { exists: fs.existsSync(gen), count: gf.length, recent: gf.slice(0, 8).map(slim) } }; })() : null;
    const M = /\.(glb|gltf|blend|usdz|fbx|obj)$/i;
    const mfiles = d ? d.all.filter((f) => M.test(f.path) && !/\/(node_modules|Pods)\//.test(f.path)).sort((a, b) => b.mtime - a.mtime) : [];
    const models = { count: mfiles.length, glb: mfiles.filter((f) => /\.glb$/i.test(f.path)).length, blend: mfiles.filter((f) => /\.blend$/i.test(f.path)).length, files: mfiles.slice(0, 300).map((f) => ({ ...slim(f), ext: path.extname(f.path).slice(1).toLowerCase(), folder: path.dirname(path.relative(p.path, f.path)) })) };
    let study = null; if (w.study) { const folders = ['Sources', 'Notes', 'Assignments', 'Outputs'].map((n) => { const dir = path.join(p.path, n); const files = d ? d.all.filter((f) => f.path.startsWith(dir + path.sep)) : []; return { name: n, abs: dir, exists: fs.existsSync(dir), count: files.length, recent: files.sort((a, b) => b.mtime - a.mtime).slice(0, 5).map(slim) }; }); study = { ...w.study, folders }; }
    return { project: p.id, scanning: !!(sc && sc.running) || !d, apps, websites, social, video: vid, models, study };
  }
  function clean(w) {
    const s = (x, n = 300) => String(x == null ? '' : x).slice(0, n);
    const list = (arr, f) => (Array.isArray(arr) ? arr.slice(0, 20).map(f) : []);
    const cmd = (c) => ({ label: s(c.label, 60), cmd: s(c.cmd, 500) });
    const lnk = (l) => ({ label: s(l.label, 60), url: /^https?:\/\//.test(l.url || '') ? s(l.url, 300) : '' });
    const base = (a) => ({ id: s(a.id, 40), name: s(a.name, 80), kind: s(a.kind, 20), platforms: s(a.platforms, 80), path: s(a.path, 300), stack: s(a.stack, 80), agent: s(a.agent, 40), url: /^https?:\/\//.test(a.url || '') ? s(a.url, 300) : '', store: s(a.store, 80), theme: s(a.theme, 40), connection: s(a.connection, 20), notes: s(a.notes, 1500), commands: list(a.commands, cmd), links: list(a.links, lnk) });
    const out = { apps: list(w.apps, base), websites: list(w.websites, base) };
    if (w.social) out.social = { path: s(w.social.path), platforms: list(w.social.platforms, (x) => s(x, 20)), poster: s(w.social.poster, 40), analyst: s(w.social.analyst, 40), ledger: s(w.social.ledger, 300), ledgerFormat: s(w.social.ledgerFormat, 20), finalDirs: list(w.social.finalDirs, (x) => s(x, 300)) };
    if (w.study) out.study = { subject: s(w.study.subject, 200), goal: s(w.study.goal, 600), rules: s(w.study.rules, 4000), model: s(w.study.model, 60), sources: list(w.study.sources, (x) => s(x, 400)) };
    if (w.video) out.video = { rawPath: s(w.video.rawPath), readyPath: s(w.video.readyPath), genPath: s(w.video.genPath), editor: s(w.video.editor, 40), generator: s(w.video.generator, 40) };
    return out;
  }
  ensure();
  return {
    ensure, resolve,
    async handle(req, res, url, p) {
      const S = (c, b) => (ctx.send(res, c, b), true);
      try {
        if (p === '/api/workspace') { const pr = ctx.state.projects.find((x) => x.id === url.searchParams.get('project')); if (!pr) return S(404, { error: 'unknown project' }); ensure(); return S(200, resolve(pr) || { project: pr.id, apps: [], websites: [], social: null, video: null }); }
        if (p === '/api/workspace-update' && req.method === 'POST') { const b = await ctx.readBody(req); const pr = ctx.state.projects.find((x) => x.id === b.project); if (!pr) return S(404, { error: 'unknown project' }); pr.workspace = clean(b.workspace || {}); ctx.saveState(ctx.state); return S(200, { ok: true }); }
      } catch (e) { return S(400, { error: String(e.message || e) }); }
      return false;
    },
  };
};
