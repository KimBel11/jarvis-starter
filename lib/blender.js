'use strict';
// Blender plugin: headless inspect / GLB conversion / preview render for .blend files, plus plugin status.
// Blender never saves the source file; results are written to data/models and data/renders.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const BIN = '/Applications/Blender.app/Contents/MacOS/Blender';
const BIG = 400 * 1024 * 1024; // files above this need an explicit "force" (slow, and can crash on huge scenes)

module.exports = function makeBlender(ctx) {
  const TOOLS = path.join(ctx.ROOT, 'tools', 'blender');
  const MODELS = path.join(ctx.DATA, 'models');
  const RENDERS = path.join(ctx.DATA, 'renders');
  for (const d of [MODELS, RENDERS]) fs.mkdirSync(d, { recursive: true });
  let busy = null, version = null;
  const slug = (s) => String(s).toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'model';
  const installed = () => fs.existsSync(BIN);

  function run(blend, script, args, timeout) {
    return new Promise((resolve, reject) => {
      if (!installed()) return reject(new Error('Blender is not installed at /Applications/Blender.app'));
      if (busy) return reject(Object.assign(new Error('Blender is busy with: ' + busy), { status: 409 }));
      busy = path.basename(blend) + ' (' + path.basename(script) + ')';
      execFile(BIN, ['-b', '--factory-startup', '-noaudio', blend, '--python', path.join(TOOLS, script), '--', ...args], { timeout, maxBuffer: 40 * 1024 * 1024 }, (err, so, se) => {
        busy = null;
        const out = String(so || '') + '\n' + String(se || '');
        const m = out.match(/JARVIS_JSON_START\s*([\s\S]*?)\s*JARVIS_JSON_END/);
        if (m) { try { return resolve(JSON.parse(m[1])); } catch {} }
        reject(new Error(err && err.killed ? 'Blender timed out' : err ? 'Blender failed: ' + (String(se).trim().split('\n').pop() || err.message).slice(0, 200) : 'Blender gave no result'));
      });
    });
  }
  function okBlend(p) {
    const f = path.resolve(String(p || '')); if (!/\.blend$/i.test(f) || !fs.existsSync(f)) throw new Error('Not a .blend file');
    if (!ctx.state.projects.some((x) => ctx.inside(f, x.path))) throw new Error('File is outside your projects');
    return f;
  }
  const sizeGuard = (f, force) => { const s = fs.statSync(f).size; if (s > BIG && !force) { const e = new Error(`This file is ${(s / 1e9).toFixed(1)} GB. Opening it headless is slow and can crash Blender. Use a smaller copy or the ready-made .glb files.`); e.status = 413; e.big = true; throw e; } return s; };

  async function getVersion() { if (version || !installed()) return version; version = await new Promise((r) => execFile(BIN, ['--version'], { timeout: 15000 }, (e, so) => r(e ? null : String(so).split('\n')[0].trim()))); return version; }
  const skillOk = (dir) => fs.existsSync(path.join(ctx.HOME, dir, 'skills', 'blender-3d', 'SKILL.md'));

  return {
    BIN, installed, getVersion,
    async status() { return { installed: installed(), bin: BIN, version: await getVersion(), skills: { claude: skillOk('.claude'), codex: skillOk('.codex') }, scripts: fs.existsSync(TOOLS) ? fs.readdirSync(TOOLS).filter((f) => f.endsWith('.py')) : [], busy, toolsDir: TOOLS }; },
    async inspect(p, force) { const f = okBlend(p); sizeGuard(f, force); return run(f, 'inspect_blend.py', [], 10 * 60 * 1000); },
    async convert(p, opt = {}) {
      const f = okBlend(p); const st = fs.statSync(f); sizeGuard(f, opt.force);
      const id = `${slug(path.basename(f))}-${Math.round(st.mtimeMs / 1000).toString(36)}${opt.draco ? '-d' : ''}.glb`; const out = path.join(MODELS, id);
      if (fs.existsSync(out)) return { ok: true, id, size: fs.statSync(out).size, cached: true };
      const r = await run(f, 'export_glb.py', [out, ...(opt.draco ? ['--draco'] : [])], 15 * 60 * 1000);
      if (!r.ok) throw new Error(r.error || 'Export failed'); return { ok: true, id, size: r.size };
    },
    async render(p, opt = {}) {
      const f = okBlend(p); const st = fs.statSync(f); sizeGuard(f, opt.force); const angle = ['front', 'rear', 'side', 'top', 'three_quarter'].includes(opt.angle) ? opt.angle : 'three_quarter';
      const id = `${slug(path.basename(f))}-${Math.round(st.mtimeMs / 1000).toString(36)}-${angle}.png`; const out = path.join(RENDERS, id);
      if (fs.existsSync(out)) return { ok: true, id, cached: true };
      const r = await run(f, 'render_preview.py', [out, '--size', '1280x800', '--samples', '24', '--angle', angle], 15 * 60 * 1000);
      if (!r.ok) throw new Error(r.error || 'Render failed'); return { ok: true, id };
    },
    async handle(req, res, url, p) {
      const S = (c, b) => (ctx.send(res, c, b), true);
      try {
        if (p === '/api/blender/status') return S(200, await this.status());
        if (p === '/api/blender/open-app' && req.method === 'POST') { if (!installed()) return S(400, { error: 'Blender is not installed' }); execFile('open', ['-a', 'Blender'], () => {}); return S(200, { ok: true }); }
        if (p === '/api/blender/inspect' && req.method === 'POST') { const b = await ctx.readBody(req); return S(200, await this.inspect(b.path, !!b.force)); }
        if (p === '/api/blender/convert' && req.method === 'POST') { const b = await ctx.readBody(req); return S(200, await this.convert(b.path, { draco: b.draco !== false, force: !!b.force })); }
        if (p === '/api/blender/render' && req.method === 'POST') { const b = await ctx.readBody(req); return S(200, await this.render(b.path, { angle: b.angle, force: !!b.force })); }
        const serve = (dir, id, type) => { if (!/^[a-z0-9-]+\.(glb|png)$/.test(id)) return S(404, { error: 'not found' }); const f = path.join(dir, id); if (!fs.existsSync(f)) return S(404, { error: 'not found' }); res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=300' }); fs.createReadStream(f).pipe(res); return true; };
        if (p === '/api/blender/model') return serve(MODELS, url.searchParams.get('id') || '', 'model/gltf-binary');
        if (p === '/api/blender/render-file') return serve(RENDERS, url.searchParams.get('id') || '', 'image/png');
      } catch (e) { return S(e.status || 400, { error: String(e.message || e), big: !!e.big }); }
      return false;
    },
  };
};
