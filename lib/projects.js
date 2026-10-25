'use strict';
// Flexible project editing: details, parent/side projects, links, shared folders, credentials a project's agents may use, agent assignment.
// Everything an agent needs for a project (folders, links, credentials as environment variables during approved runs) is set here.
const fs = require('fs');
const path = require('path');

const COLOR_RE = /^#[0-9a-f]{6}$/i;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

module.exports = function makeProjects(ctx, deps) {
  const { agents, vault } = deps;
  const project = (id) => ctx.state.projects.find((p) => p.id === id);
  const str = (x, n) => String(x == null ? '' : x).trim().slice(0, n);
  const okDir = (d) => { try { return fs.statSync(d).isDirectory() && ctx.isAllowed(d); } catch { return false; } };
  const descendants = (id, seen = new Set()) => { for (const p of ctx.state.projects) if (p.parent === id && !seen.has(p.id)) { seen.add(p.id); descendants(p.id, seen); } return seen; };
  const SERVICE_IDS = () => vault.SERVICES.map((s) => s.id);

  function view(pr) {
    const entries = vault.list(); const services = pr.services || [];
    return {
      id: pr.id, name: pr.name, description: pr.description || '', color: pr.color, path: pr.path, parent: pr.parent || null, services, resources: pr.resources || [], sharedPaths: pr.sharedPaths || [],
      children: ctx.state.projects.filter((x) => x.parent === pr.id).map((x) => ({ id: x.id, name: x.name, color: x.color })),
      keys: services.map((id) => ({ service: id, entries: entries.filter((e) => e.service === id).map((e) => ({ id: e.id, name: e.name, vars: e.vars.map((v) => ({ k: v.k, hint: v.hint, empty: v.empty })), updatedAt: e.updatedAt })) })),
      agents: agents.roster().filter((a) => a.project === pr.id && a.id !== 'kim').map((a) => ({ id: a.id, name: a.name, glyph: a.glyph, color: a.color, role: a.role, services: a.services || [], engine: a.engine, custom: !!a.custom, approval: !!a.approval })),
    };
  }

  function update(b) {
    const pr = project(b.id); if (!pr) throw new Error('unknown project');
    if (typeof b.name === 'string' && b.name.trim()) { const n = str(b.name, 60).replace(/[\/\\:*?"<>|]/g, ''); if (n) { pr.name = n; pr.aliases = [...new Set([n, ...(pr.aliases || []).filter((a) => a !== n)])].slice(0, 6); } }
    if (typeof b.description === 'string') pr.description = str(b.description, 400);
    if (typeof b.color === 'string' && COLOR_RE.test(b.color)) pr.color = b.color;
    if (typeof b.path === 'string' && b.path.trim() && path.resolve(b.path) !== pr.path) { const np = path.resolve(b.path.trim()); if (!okDir(np)) throw new Error('That folder does not exist on this Mac (or is not allowed): ' + np); pr.path = np; }
    if (b.parent !== undefined) { const par = b.parent ? project(b.parent) : null; if (b.parent && !par) throw new Error('Unknown parent project'); if (par && (par.id === pr.id || descendants(pr.id).has(par.id))) throw new Error('A project cannot be inside itself'); pr.parent = par ? par.id : null; }
    if (Array.isArray(b.services)) pr.services = [...new Set(b.services.filter((s) => SERVICE_IDS().includes(s)))];
    if (Array.isArray(b.resources)) pr.resources = b.resources.filter((r) => r && /^https?:\/\//i.test(String(r.url || ''))).slice(0, 40).map((r) => ({ title: str(r.title || r.url, 80), url: str(r.url, 400), note: str(r.note, 200) }));
    if (Array.isArray(b.sharedPaths)) { const out = []; for (const d of b.sharedPaths) { const p = path.resolve(String(d)); if (!okDir(p)) throw new Error('Folder not found or not allowed: ' + p); out.push(p); } pr.sharedPaths = [...new Set(out)].slice(0, 20); }
    ctx.saveState(ctx.state); return view(pr);
  }

  function assign(pid, ids) {
    const pr = project(pid); if (!pr) throw new Error('unknown project'); const want = new Set((ids || []).filter((x) => x !== 'kim'));
    for (const a of agents.roster()) { if (a.id === 'kim') continue; if (want.has(a.id)) agents.setProject(a.id, pid); else if (a.project === pid) agents.setProject(a.id, null); }
    return view(pr);
  }

  /* ---- side projects: own folder inside the parent, sharing the parent's folders through links ---- */
  const EVEN_README = (name, parent) => `# ${name}\n\nAn app for **Even G2 smart glasses**, built as a side project of **${parent}**. The glasses show short, glanceable information (study cards, answers, timers, reminders) from the ${parent} project.\n\n## How Even G2 apps work\n- Even Hub apps are web apps (TypeScript + the Even Hub SDK). They run on the phone inside the Even Realities app and talk to the glasses through a JavaScript bridge.\n- A desktop **simulator** renders the glasses display, so you can build without hardware.\n- A finished app is packaged as one \`.ehpk\` file and submitted through the Even developer portal (or run as a PWA).\n- Docs: https://hub.evenrealities.com/ (installation and architecture pages)\n\n## Connected to ${parent}\nThis folder links to the same Sources, Notes, Assignments and Outputs folders as ${parent}, plus a shared folder named Shared. Anything saved there shows up in both projects.\n\n## Folders\n- app/: the glasses app\n- docs/: SDK notes, design decisions\n- Shared/ (and the linked ${parent} folders): common information\n`;
  const EVEN_PLAN = (name, parent) => `# Plan: ${name}\n\n1. Read https://hub.evenrealities.com/docs/getting-started/installation and the architecture page. Write the exact SDK package name, Node version and simulator command in docs/even-hub-notes.md.\n2. Create the app in app/ (Vite + TypeScript). Show one study card on the simulator.\n3. Read study material from Shared/ and Notes/ (same files as ${parent}) and turn them into short cards: question, answer, next.\n4. Add input handling (tap/scroll on the glasses or ring) to move between cards and mark "known" / "again".\n5. Save progress to Shared/even-progress.json so ${parent} and ${name} stay in sync.\n6. Test on the simulator, then on the glasses through the Even Realities phone app. Package as .ehpk.\n\nRules: ask @@NAME@@ before submitting anything to the Even portal; never put keys in the app code.\n`;

  async function createChild(b) {
    const par = project(b.parent); if (!par) throw new Error('unknown parent project'); const name = str(b.name, 60).replace(/[\/\\:*?"<>|]/g, ''); if (!name) throw new Error('Name required');
    const id = slug(name); if (project(id)) throw new Error('A project with that name already exists'); const dir = path.join(par.path, name); if (fs.existsSync(dir)) throw new Error('Folder already exists: ' + dir);
    const kind = ['even', 'app', 'study', 'blank'].includes(b.kind) ? b.kind : 'blank'; const subs = kind === 'even' ? ['app', 'docs'] : kind === 'app' ? ['app', 'docs'] : ['docs'];
    fs.mkdirSync(dir, { recursive: true }); for (const s of subs) fs.mkdirSync(path.join(dir, s), { recursive: true });
    // same folders as the parent: shared folder + links to the parent's study folders
    const shared = path.join(par.path, 'Shared'); fs.mkdirSync(shared, { recursive: true }); const links = [['Shared', shared]];
    for (const f of ['Sources', 'Notes', 'Assignments', 'Outputs']) { const t = path.join(par.path, f); if (fs.existsSync(t)) links.push([f, t]); }
    for (const [n, t] of links) { try { fs.symlinkSync(path.relative(dir, t), path.join(dir, n), 'dir'); } catch {} }
    const desc = str(b.description, 400) || (kind === 'even' ? `Even G2 smart-glasses app connected to ${par.name}` : '');
    const readme = kind === 'even' ? EVEN_README(name, par.name) : `# ${name}\n\n${desc || 'Describe the project here.'}\n\nSide project of ${par.name}. Folders ${links.map((l) => l[0]).join(', ')} are shared with ${par.name}.\n\n## Rules for AI agents\n- Keep every file for this project inside this folder.\n- Ask before deleting or publishing anything.\n`;
    fs.writeFileSync(path.join(dir, 'README.md'), readme); fs.writeFileSync(path.join(dir, 'CLAUDE.md'), readme); fs.writeFileSync(path.join(dir, 'AGENTS.md'), readme);
    if (kind === 'even') { fs.writeFileSync(path.join(dir, 'PLAN.md'), EVEN_PLAN(name, par.name)); fs.writeFileSync(path.join(dir, 'docs', 'even-hub-notes.md'), `# Even Hub notes\n\n- Developer hub: https://hub.evenrealities.com/\n- Installation: https://hub.evenrealities.com/docs/getting-started/installation\n- Architecture: https://hub.evenrealities.com/docs/getting-started/architecture\n- SDK reference: https://www.skills.sh/even-realities/everything-evenhub/sdk-reference\n\nFill in the exact package name, Node version and commands here after reading the docs.\n`); }
    const COLORS = ['#ff6a3d', '#35d49a', '#5b8cff', '#c77dff', '#ffc233', '#2dd4ee', '#ff4d8d']; const proj = { id, name, path: dir, color: b.color && COLOR_RE.test(b.color) ? b.color : COLORS[(ctx.state.projects.length + 3) % COLORS.length], description: desc, aliases: [name], rules: JSON.parse(JSON.stringify(par.rules || [])), created: new Date().toISOString(), parent: par.id, services: [...(par.services || [])], resources: kind === 'even' ? [{ title: 'Even Hub developer docs', url: 'https://hub.evenrealities.com/', note: 'SDK, simulator, packaging' }, { title: 'Even Hub installation', url: 'https://hub.evenrealities.com/docs/getting-started/installation', note: '' }, { title: 'Even Hub architecture', url: 'https://hub.evenrealities.com/docs/getting-started/architecture', note: 'How apps talk to the glasses' }, ...(par.resources || [])] : [...(par.resources || [])], sharedPaths: [] };
    proj.workspace = kind === 'even' ? { apps: [{ id: id + '-glasses', name: name + ' (Even G2 glasses app)', kind: 'app', platforms: 'Even G2 smart glasses (through the Even Realities phone app)', path: 'app', stack: 'Even Hub SDK · TypeScript · Vite', agent: id + '-engineer', notes: 'Runs on the phone inside the Even Realities app and draws on the glasses. Test in the Even Hub simulator first.', commands: [{ label: 'Install packages', cmd: 'npm install' }, { label: 'Start dev server', cmd: 'npm run dev' }] }] } : kind === 'app' ? { apps: [{ id: id + '-app', name, kind: 'app', platforms: '', path: 'app', stack: '', agent: id + '-engineer', notes: '', commands: [] }] } : kind === 'study' ? { study: { subject: '', goal: '', rules: '', model: '', sources: [] } } : undefined;
    if (!proj.workspace) delete proj.workspace;
    ctx.state.projects.push(proj); ctx.saveState(ctx.state);
    if (kind === 'even' || kind === 'app') agents.addCustom({ id: id + '-engineer', name: kind === 'even' ? 'Even G2 App Engineer' : name + ' App Engineer', role: kind === 'even' ? 'Builds the Even G2 glasses app' : 'Builds the ' + name + ' app', glyph: kind === 'even' ? '🥽' : '📱', color: proj.color, project: id, engine: 'both', primary: 'codex', models: { claude: 'claude-sonnet-5-5', codex: 'gpt-6.1-sol' }, effort: { claude: 'high', codex: 'high' }, tools: 'write', approval: true, search: true, enabled: true, maxBudget: 6,
      instructions: kind === 'even' ? `You are the Even G2 App Engineer. You build and improve the Even G2 smart-glasses app in this project's app/ folder. First read README.md, PLAN.md and docs/even-hub-notes.md, then read the Even Hub developer docs (https://hub.evenrealities.com/) with web fetch before writing code, and record exact package names, versions and commands in docs/even-hub-notes.md. The app is a web app (TypeScript + the Even Hub SDK) that runs on the phone and draws on the glasses; test it in the Even Hub simulator. This project is connected to ${par.name}: read study material from the linked Sources, Notes, Assignments, Outputs and Shared folders and save shared progress in Shared/. Keep glasses screens extremely short and glanceable. Never put keys in the app code. Never submit anything to the Even developer portal without @@NAME@@’s approval.` : `You are the ${name} App Engineer. Build and improve the app in this project's app/ folder. Read README.md first. Keep changes small, test them, and ask before anything irreversible.` });
    return proj;
  }

  return {
    view,
    async handle(req, res, url, p) {
      if (!p.startsWith('/api/proj/')) return false; const S = (c, b) => (ctx.send(res, c, b), true);
      try {
        if (p === '/api/proj/access') { const pr = project(url.searchParams.get('project') || ''); return pr ? S(200, { project: view(pr), services: vault.SERVICES.map(({ re, ...s }) => s), roster: agents.roster().filter((a) => a.id !== 'kim').map((a) => ({ id: a.id, name: a.name, glyph: a.glyph, color: a.color, project: a.project || null, role: a.role })) }) : S(404, { error: 'unknown project' }); }
        const b = req.method === 'POST' ? await ctx.readBody(req) : {};
        if (p === '/api/proj/update' && req.method === 'POST') return S(200, update(b));
        if (p === '/api/proj/agents' && req.method === 'POST') return S(200, assign(b.id, b.agents));
        if (p === '/api/proj/child' && req.method === 'POST') { const proj = await createChild(b); return S(200, view(proj)); }
      } catch (e) { return S(400, { error: String(e.message || e) }); }
      return false;
    },
  };
};
