'use strict';
// Developer tools hub: Visual Studio Code and Obsidian next to Jarvis.
// - "Open in VS Code": creates a multi-folder workspace (project + shared folders + connected side projects) and VS Code tasks, then opens it.
// - Obsidian: turns a project folder (or the Jarvis Hub) into a vault with a generated home note, and opens it.
// - Jarvis Hub: one vault with a note per project (status, links, agents, tasks) plus links into each project's notes folders. It is rebuilt on demand and daily.
// Nothing is deleted or overwritten: files that Jarvis writes are named so, and existing ones are left alone.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const run = (cmd, args, ms = 15000) => new Promise((res) => execFile(cmd, args, { timeout: ms, encoding: 'utf8', maxBuffer: 5e6 }, (e, out, err) => res({ ok: !e, out: out || '', err: (err || (e && e.message) || '').trim() })));
const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };
const VSCODE = '/Applications/Visual Studio Code.app';
const OBS_APPS = ['/Applications/Obsidian.app', path.join(os.homedir(), 'Applications', 'Obsidian.app')];
const safeName = (s) => String(s).replace(/[\/\\:*?"<>|]/g, '').trim().slice(0, 60) || 'Project';
const SKIP_DIRS = ['node_modules', '.git', 'build', 'dist', 'DerivedData', 'Pods', '.next', '.expo', 'dev-caches'];

module.exports = function makeDevtools(ctx) {
  const project = (id) => ctx.state.projects.find((p) => p.id === id);
  const HUB = path.join(ctx.DRIVE, 'Jarvis Hub');
  const obsApp = () => OBS_APPS.find(exists) || null;

  async function detect() {
    const code = exists(VSCODE); const cli = code ? path.join(VSCODE, 'Contents/Resources/app/bin/code') : null; const obs = obsApp();
    const brew = exists('/opt/homebrew/bin/brew'); let ver = null; if (code) { const r = await run('defaults', ['read', path.join(VSCODE, 'Contents/Info'), 'CFBundleShortVersionString']); ver = r.ok ? r.out.trim() : null; }
    let ov = null; if (obs) { const r = await run('defaults', ['read', path.join(obs, 'Contents/Info'), 'CFBundleShortVersionString']); ov = r.ok ? r.out.trim() : null; }
    return { vscode: { installed: code, version: ver, cli: cli && exists(cli) ? cli : null }, obsidian: { installed: !!obs, version: ov, path: obs }, brew, hub: { path: HUB, exists: exists(HUB), notes: exists(path.join(HUB, 'Home.md')) } };
  }

  /* ---------- VS Code ---------- */
  function workspaceFile(pr) {
    const folders = [{ name: pr.name, path: pr.path }]; const add = (p, name) => { if (p && exists(p) && !folders.some((f) => f.path === p)) folders.push({ name, path: p }); };
    for (const d of pr.sharedPaths || []) add(d, path.basename(d));
    const par = pr.parent && project(pr.parent); if (par) add(par.path, par.name + ' (main project)');
    for (const k of ctx.state.projects.filter((x) => x.parent === pr.id)) add(k.path, k.name + ' (side project)');
    const ws = { folders, settings: { 'files.exclude': Object.fromEntries(SKIP_DIRS.map((d) => ['**/' + d, true])), 'search.exclude': Object.fromEntries(SKIP_DIRS.map((d) => ['**/' + d, true])), 'files.watcherExclude': Object.fromEntries(SKIP_DIRS.map((d) => ['**/' + d + '/**', true])), 'files.autoSave': 'afterDelay', 'editor.formatOnSave': false, 'terminal.integrated.cwd': pr.path }, extensions: { recommendations: ['anthropic.claude-code', 'yzhang.markdown-all-in-one', 'esbenp.prettier-vscode'] } };
    const f = path.join(pr.path, safeName(pr.name) + '.code-workspace');
    if (!exists(f)) fs.writeFileSync(f, JSON.stringify(ws, null, 2) + '\n'); else { // keep @@NAME@@’s edits, only add folders that are missing
      try { const cur = JSON.parse(fs.readFileSync(f, 'utf8')); let ch = false; for (const x of folders) if (!(cur.folders || []).some((y) => path.resolve(pr.path, y.path) === x.path)) { (cur.folders = cur.folders || []).push(x); ch = true; } if (ch) fs.writeFileSync(f, JSON.stringify(cur, null, 2) + '\n'); } catch {}
    }
    // tasks from the project's saved commands (only when the project has no tasks yet)
    try {
      const tf = path.join(pr.path, '.vscode', 'tasks.json'); const apps = ((pr.workspace || {}).apps || []).concat(((pr.workspace || {}).websites || []));
      const cmds = apps.flatMap((a) => (a.commands || []).map((c) => ({ label: `${a.name}: ${c.label}`, type: 'shell', command: c.cmd, options: { cwd: a.path ? '${workspaceFolder}/' + a.path : '${workspaceFolder}' }, problemMatcher: [] })));
      if (cmds.length && !exists(tf)) { fs.mkdirSync(path.dirname(tf), { recursive: true }); fs.writeFileSync(tf, JSON.stringify({ version: '2.0.0', tasks: cmds }, null, 2) + '\n'); }
    } catch {}
    return f;
  }
  async function openVSCode(pid, target) {
    const pr = project(pid); if (!pr) throw new Error('unknown project'); if (!exists(VSCODE)) throw new Error('Visual Studio Code is not installed (https://code.visualstudio.com/)');
    let what = pr.path; if (target && target !== 'folder') what = workspaceFile(pr); else what = pr.path;
    const r = await run('open', ['-a', VSCODE, what]); if (!r.ok) throw new Error('Could not open VS Code: ' + r.err.slice(0, 120)); return { opened: what };
  }

  /* ---------- Obsidian ---------- */
  const keyDocs = (dir) => { const out = []; let items = []; try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch {} for (const e of items) { if (e.name.startsWith('.') || SKIP_DIRS.includes(e.name)) continue; if (e.isFile() && /\.(md|markdown)$/i.test(e.name)) out.push(e.name); } return out.slice(0, 40); };
  const NOTE_DIRS = ['Docs', 'docs', 'Notes', 'Sources', 'Assignments', 'Outputs', 'Shared', 'Briefs'];
  function homeNote(pr) {
    const par = pr.parent && project(pr.parent); const kids = ctx.state.projects.filter((x) => x.parent === pr.id); const docs = keyDocs(pr.path);
    return `---\ntitle: ${pr.name}\ntype: project\ngenerated-by: Jarvis\n---\n# ${pr.name}\n\n${pr.description || ''}\n\n> Written by Jarvis. Edit freely: Jarvis only creates this file once and never overwrites it.\n\n## Start here\n${docs.map((d) => `- [[${d.replace(/\.(md|markdown)$/i, '')}]]`).join('\n') || '- (no notes yet)'}\n\n## Folders\n${NOTE_DIRS.filter((d) => exists(path.join(pr.path, d))).map((d) => `- ${d}/`).join('\n') || '- (none yet)'}\n${par ? `\n## Part of\n- ${par.name}\n` : ''}${kids.length ? `\n## Side projects\n${kids.map((k) => `- ${k.name}`).join('\n')}\n` : ''}${(pr.resources || []).length ? `\n## Links\n${pr.resources.map((r) => `- [${r.title}](${r.url})${r.note ? ' — ' + r.note : ''}`).join('\n')}\n` : ''}\n## Notes\n\n`;
  }
  function ensureVault(pr) {
    const obs = path.join(pr.path, '.obsidian'); fs.mkdirSync(obs, { recursive: true });
    const app = path.join(obs, 'app.json'); if (!exists(app)) fs.writeFileSync(app, JSON.stringify({ alwaysUpdateLinks: true, newFileLocation: 'folder', newFileFolderPath: exists(path.join(pr.path, 'Notes')) ? 'Notes' : '/', userIgnoreFilters: SKIP_DIRS.map((d) => d + '/') }, null, 2));
    const note = path.join(pr.path, '_' + safeName(pr.name) + ' (Jarvis).md'); if (!exists(note)) fs.writeFileSync(note, homeNote(pr)); return note;
  }
  async function openObsidian(pid, hub) {
    if (!obsApp()) throw new Error('Obsidian is not installed yet (https://obsidian.md/download)');
    let dir, note; if (hub) { await refreshHub(); dir = HUB; note = path.join(HUB, 'Home.md'); } else { const pr = project(pid); if (!pr) throw new Error('unknown project'); note = ensureVault(pr); dir = pr.path; }
    // Obsidian opens a note by its path; the first time it asks "Open folder as vault" and remembers the answer
    const r = await run('open', ['obsidian://open?path=' + encodeURIComponent(note)]); if (!r.ok) { const r2 = await run('open', ['-a', obsApp(), dir]); if (!r2.ok) throw new Error('Could not open Obsidian: ' + r2.err.slice(0, 120)); }
    return { vault: dir, note };
  }

  /* ---------- Jarvis Hub vault ---------- */
  async function hubData(pr) {
    const base = 'http://127.0.0.1:' + (process.env.JARVIS_PORT || 4777); const get = async (u) => { try { const r = await fetch(base + u, { signal: AbortSignal.timeout(20000) }); return r.ok ? r.json() : null; } catch { return null; } };
    const out = {}; if (pr.workspace && pr.workspace.social) out.live = await get('/api/social/live?project=' + pr.id); if ((pr.workspace && pr.workspace.apps || []).some((a) => a.bundleId)) out.apple = await get('/api/apple/status?project=' + pr.id); const sh = ((pr.workspace || {}).websites || []).some((s) => s.kind === 'shopify'); if (sh) out.shop = await get('/api/shop?project=' + pr.id); const t = await get('/api/team'); out.team = t; return out;
  }
  async function refreshHub() {
    fs.mkdirSync(path.join(HUB, 'Projects'), { recursive: true }); fs.mkdirSync(path.join(HUB, '.obsidian'), { recursive: true });
    const app = path.join(HUB, '.obsidian', 'app.json'); if (!exists(app)) fs.writeFileSync(app, JSON.stringify({ alwaysUpdateLinks: true, userIgnoreFilters: SKIP_DIRS.map((d) => d + '/') }, null, 2));
    const now = new Date(); const stamp = now.toLocaleString('en-GB'); const rows = []; let teamAll = null;
    for (const pr of ctx.state.projects) {
      const d = await hubData(pr); teamAll = teamAll || d.team; const L = []; const par = pr.parent && project(pr.parent);
      L.push(`---\ntitle: ${pr.name}\ntype: project\nupdated: ${now.toISOString()}\ngenerated-by: Jarvis\n---\n# ${pr.name}\n\n${pr.description || ''}\n\n*Rebuilt by Jarvis ${stamp}. Do not edit this file; write your own notes in other files.*\n\n- Folder: \`${pr.path}\`\n- Open in Jarvis: http://localhost:${process.env.JARVIS_PORT || 4777}/#/project/${pr.id}\n${par ? `- Side project of [[${safeName(par.name)}]]\n` : ''}`);
      const ag = d.team ? d.team.agents.filter((a) => a.project === pr.id) : []; if (ag.length) L.push(`\n## Agents\n${ag.map((a) => `- ${a.glyph} **${a.name}**: ${a.role} (${(a.status || {}).state || 'idle'})`).join('\n')}`);
      const ts = d.team ? d.team.tasks.filter((t) => ag.some((a) => a.id === t.agent)).slice(0, 12) : []; if (ts.length) L.push(`\n## Recent tasks\n${ts.map((t) => `- [${t.status}] ${t.title} (${t.agent})`).join('\n')}`);
      if (d.apple && d.apple.ok) L.push(`\n## Apple review\n${d.apple.apps.map((a) => `- ${a.name}: ${(a.versions[0] && a.versions[0].state.text) || 'no version'}${a.builds[0] ? ' · build ' + a.builds[0].build : ''}`).join('\n')}`);
      if (d.shop && d.shop.snapshot) { const s = d.shop.snapshot; L.push(`\n## Website sales (30 days)\n- ${s.sales.orders} orders, ${Math.round(s.sales.total)} ${s.shop.currency || ''}${s.traffic ? `, ${s.traffic.sessions} visits` : ''}`); }
      if (d.live) L.push(`\n## Social media\n- ${d.live.totals.published} posted, ${d.live.totals.scheduled} scheduled, queue ${d.live.runwayDays} days\n${d.live.platforms.filter((x) => x.followers != null).map((x) => `- ${x.platform}: ${x.followers} followers`).join('\n')}`);
      if ((pr.resources || []).length) L.push(`\n## Links\n${pr.resources.map((r) => `- [${r.title}](${r.url})${r.note ? ' — ' + r.note : ''}`).join('\n')}`);
      // links into the project's own notes (folders are linked, never copied)
      const linkDir = path.join(HUB, safeName(pr.name)); const links = []; fs.mkdirSync(linkDir, { recursive: true });
      for (const n of NOTE_DIRS) { const t = path.join(pr.path, n); if (exists(t)) { const l = path.join(linkDir, n); try { if (!exists(l)) fs.symlinkSync(t, l, 'dir'); links.push(n); } catch {} } }
      for (const f of keyDocs(pr.path).slice(0, 12)) { const l = path.join(linkDir, f); try { if (!exists(l)) fs.symlinkSync(path.join(pr.path, f), l, 'file'); links.push(f); } catch {} }
      if (links.length) L.push(`\n## Notes and folders\n${links.map((n) => `- [[${safeName(pr.name)}/${n.replace(/\.(md|markdown)$/i, '')}]]`).join('\n')}`);
      fs.writeFileSync(path.join(HUB, 'Projects', safeName(pr.name) + '.md'), L.join('\n') + '\n'); rows.push(`| [[Projects/${safeName(pr.name)}\\|${pr.name}]] | ${pr.parent ? 'side of ' + ((project(pr.parent) || {}).name || '') : 'main'} | ${ag.length} | ${ts.filter((t) => ['running', 'planning', 'awaiting_approval'].includes(t.status)).length} |`);
    }
    const open = teamAll ? teamAll.tasks.filter((t) => ['awaiting_approval', 'running', 'planning', 'queued'].includes(t.status)) : [];
    fs.writeFileSync(path.join(HUB, 'Home.md'), `---\ntitle: Jarvis Hub\ngenerated-by: Jarvis\nupdated: ${now.toISOString()}\n---\n# Jarvis Hub\n\nEverything in one vault. Rebuilt by Jarvis ${stamp}.\n\n## Projects\n| Project | Kind | Agents | Open tasks |\n|---|---|---|---|\n${rows.join('\n')}\n\n## Needs you\n${open.filter((t) => t.status === 'awaiting_approval').map((t) => `- [ ] ${t.title} (${t.agent}) — approve in Jarvis`).join('\n') || '- Nothing is waiting for you.'}\n\n## Running now\n${open.filter((t) => ['running', 'planning'].includes(t.status)).map((t) => `- ${t.title} (${t.agent})`).join('\n') || '- Nothing.'}\n\n## Your own notes\nCreate notes anywhere in this vault. Files named Home.md and everything under Projects/ are rewritten by Jarvis; the rest is yours.\n`);
    return { path: HUB, projects: ctx.state.projects.length };
  }
  setInterval(() => { try { if (exists(path.join(HUB, 'Home.md'))) refreshHub().catch(() => {}); } catch {} }, 6 * 3600e3).unref();

  return {
    detect, openVSCode, openObsidian, refreshHub, workspaceFile,
    async handle(req, res, url, p) {
      if (!p.startsWith('/api/dev/')) return false; const S = (c, b) => (ctx.send(res, c, b), true);
      try {
        if (p === '/api/dev/status') return S(200, await detect());
        const b = req.method === 'POST' ? await ctx.readBody(req) : {};
        if (p === '/api/dev/settings' && req.method === 'POST') { const PANES = { fulldisk: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles', automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation', energy: 'x-apple.systempreferences:com.apple.Energy-Saver-Settings.extension', users: 'x-apple.systempreferences:com.apple.Users-Groups-Settings.extension', security: 'x-apple.systempreferences:com.apple.preference.security' }; if (!PANES[b.pane]) return S(400, { error: 'unknown pane' }); await run('open', [PANES[b.pane]]); return S(200, { ok: true }); }
        if (p === '/api/dev/restart' && req.method === 'POST') { S(200, { ok: true }); setTimeout(() => execFile('/bin/launchctl', ['kickstart', '-k', 'gui/' + process.getuid() + '/com.jarvis.local'], () => {}), 400); return true; }
        if (p === '/api/dev/reveal-node' && req.method === 'POST') { await run('open', ['-R', process.execPath]); return S(200, { path: process.execPath }); }
        if (p === '/api/dev/open-app' && req.method === 'POST') { const APPS = { messages: '/System/Applications/Messages.app', tailscale: '/Applications/Tailscale.app', simulator: null }; const a = APPS[b.app]; if (!a) return S(400, { error: 'unknown app' }); await run('open', ['-a', a]); return S(200, { ok: true }); }
        if (p === '/api/dev/vscode' && req.method === 'POST') return S(200, await openVSCode(b.project, b.target));
        if (p === '/api/dev/obsidian' && req.method === 'POST') return S(200, await openObsidian(b.project, !!b.hub));
        if (p === '/api/dev/hub' && req.method === 'POST') return S(200, await refreshHub());
        if (p === '/api/dev/install' && req.method === 'POST') { // one-click install through Homebrew, only for these two apps
          const app = b.app === 'obsidian' ? 'obsidian' : b.app === 'vscode' ? 'visual-studio-code' : null; if (!app) return S(400, { error: 'unknown app' }); if (!exists('/opt/homebrew/bin/brew')) return S(400, { error: 'Homebrew is not installed. Download the app from its website instead.' });
          const r = await run('/opt/homebrew/bin/brew', ['install', '--cask', app], 600000); return r.ok ? S(200, { ok: true }) : S(400, { error: r.err.slice(0, 300) || 'Install failed' });
        }
      } catch (e) { return S(400, { error: String(e.message || e) }); }
      return false;
    },
  };
};
