#!/usr/bin/env node
// Jarvis — local command center for @@NAME@@’s projects, Claude Code and Codex.
// Zero dependencies. Binds to 127.0.0.1 only.
'use strict';
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const readline = require('readline');
const { execFile } = require('child_process');

const PORT = Number(process.env.JARVIS_PORT || 4777);
const ROOT = __dirname;
const DRIVE = path.dirname(ROOT);
const HOME = os.homedir();
const CLAUDE = path.join(HOME, '.claude');
const CODEX = path.join(HOME, '.codex');
const DATA = process.env.JARVIS_DATA || path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA, 'state.json');
const CACHE_FILE = path.join(DATA, 'usage-cache.json');

const SKIP_DIRS = new Set(['node_modules', '.git', 'Pods', 'build', 'DerivedData', 'dev-caches', '.gradle', '.next', 'dist', '.expo', '__pycache__', '.venv', 'venv', '.cache', 'Library', '.Trash', '.DocumentRevisions-V100', '.Spotlight-V100', '.fseventsd', '.TemporaryItems', '.Trashes']);
const MEDIA = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.svg'],
  video: ['.mp4', '.mov', '.m4v', '.webm'],
  audio: ['.mp3', '.wav', '.m4a'],
  doc: ['.pdf', '.md', '.txt', '.docx', '.pptx', '.xlsx', '.csv', '.json'],
  model: ['.glb', '.gltf', '.usdz'],
};
const KIND_OF = {};
for (const [k, exts] of Object.entries(MEDIA)) for (const e of exts) KIND_OF[e] = k;
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.pdf': 'application/pdf', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/plain; charset=utf-8', '.json': 'application/json', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.usdz': 'model/vnd.usdz+zip' };
const SOCIAL_RE = /social|content|reel|short|campaign|final|ads?\b|video|tiktok|instagram|snap|youtube/i;
const COLORS = ['#ff6a3d', '#35d49a', '#5b8cff', '#c77dff', '#ffc233', '#2dd4ee'];

// ---------- state ----------
function loadState() {
  return require('./lib/durable-json').read(STATE_FILE);
}
function saveState(s) {
  require('./lib/durable-json').write(STATE_FILE, s);
}
function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
function seedState() {
  const projects = [];
  let i = 0;
  try {
    for (const d of fs.readdirSync(DRIVE, { withFileTypes: true })) {
      if (d.isDirectory() && / Project$/.test(d.name)) {
        const name = d.name.replace(/ Project$/, '');
        projects.push({ id: slug(name), name, path: path.join(DRIVE, d.name), color: COLORS[i++ % COLORS.length], description: '', aliases: [name], created: new Date().toISOString() });
      }
    }
  } catch {}
  const s = { projects, pins: [] };
  saveState(s);
  return s;
}
let state = loadState() || seedState();
const DEFAULT_RULES = [
  { id: 'social', label: 'Social media content', pattern: 'social|reel|short|campaign|tiktok|instagram|snap|youtube', kinds: ['video', 'image'] },
  { id: 'final', label: 'Final deliverables', pattern: 'final|export|release|deliver', kinds: ['video', 'image', 'doc'] },
  { id: 'briefs', label: 'Briefs & agent rules', pattern: '(^|/)(CLAUDE|AGENTS|README|BRIEF|PLAN)[^/]*\\.md$', kinds: ['doc'] },
];
for (const p of state.projects) { if (!Array.isArray(p.rules)) p.rules = JSON.parse(JSON.stringify(DEFAULT_RULES)); }
saveState(state);
const SENSITIVE = /\.(p8|pem|key|env|keystore|jks|mobileprovision|p12)$|secret|credential|password|\.env/i;

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function inside(p, root) { const r = path.relative(root, p); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); }
function allowedRoots() { return [...state.projects.flatMap((p) => [p.path, ...(Array.isArray(p.sharedPaths) ? p.sharedPaths : [])]), ROOT]; } // sharedPaths: folders the owner chose to share with a project (e.g. the iCloud Studys folder)
function isAllowed(p) {
  try {
    const real = fs.realpathSync(p);
    return allowedRoots().some((r) => { try { return inside(real, fs.realpathSync(r)); } catch { return false; } });
  } catch { return false; }
}
function projectFor(cwd) {
  if (!cwd) return null;
  let best = null;
  for (const p of state.projects) if (inside(cwd, p.path) && (!best || p.path.length > best.path.length)) best = p;
  if (best) return best.id;
  for (const p of state.projects) if ((p.aliases || [p.name]).some((a) => a && cwd.toLowerCase().includes(a.toLowerCase()))) return p.id;
  return null;
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const it = items[i++]; try { await fn(it); } catch {} } }));
}

// ---------- project scan ----------
const scanCache = new Map(); // id -> {at, data, running}
async function scanProject(p) {
  const t0 = Date.now();
  const exists = fs.existsSync(p.path);
  const out = { id: p.id, exists, files: 0, bytes: 0, kinds: {}, folders: [], recent: [], media: [], truncated: false, scannedAt: Date.now(), ms: 0 };
  if (!exists) return out;
  const topStats = new Map(); // folder -> {files,bytes,last}
  const all = [];
  const queue = [{ dir: p.path, depth: 0, top: null }];
  const CAP = 40000, BUDGET = 25000;
  while (queue.length) {
    if (Date.now() - t0 > BUDGET || out.files > CAP) { out.truncated = true; break; }
    const batch = queue.splice(0, 16);
    await Promise.all(batch.map(async ({ dir, depth, top }) => {
      let ents; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (e.name.startsWith('.') && e.name !== '.claude') continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name) || depth >= 7) continue;
          queue.push({ dir: full, depth: depth + 1, top: top || e.name });
        } else if (e.isFile()) {
          out.files++;
          all.push({ full, top: top || '(root)' });
        }
      }
    }));
  }
  // stat in parallel (cap for speed)
  const STAT_CAP = 12000;
  const toStat = all.length > STAT_CAP ? all.slice(0, STAT_CAP) : all;
  const stats = [];
  await pool(toStat, 48, async (f) => {
    const st = await fsp.stat(f.full);
    stats.push({ ...f, size: st.size, mtime: st.mtimeMs });
  });
  for (const f of stats) {
    out.bytes += f.size;
    const ext = path.extname(f.full).toLowerCase();
    const kind = KIND_OF[ext] || (['.js', '.ts', '.tsx', '.jsx', '.py', '.swift', '.liquid', '.css', '.html', '.kt'].includes(ext) ? 'code' : 'other');
    out.kinds[kind] = (out.kinds[kind] || 0) + 1;
    const t = topStats.get(f.top) || { name: f.top, files: 0, bytes: 0, last: 0 };
    t.files++; t.bytes += f.size; t.last = Math.max(t.last, f.mtime); topStats.set(f.top, t);
  }
  out.folders = [...topStats.values()].sort((a, b) => b.last - a.last);
  const rel = (f) => path.relative(p.path, f);
  out.all = stats.filter((f) => !SENSITIVE.test(f.full)).map((f) => ({ path: f.full, rel: rel(f.full), size: f.size, mtime: f.mtime, kind: KIND_OF[path.extname(f.full).toLowerCase()] || 'other' }));
  const important = stats.filter((f) => !/\.(map|lock|log|DS_Store)$/.test(f.full) && !/node_modules|\.p8$/.test(f.full));
  out.recent = important.sort((a, b) => b.mtime - a.mtime).slice(0, 40).map((f) => ({ path: f.full, rel: rel(f.full), size: f.size, mtime: f.mtime, kind: KIND_OF[path.extname(f.full).toLowerCase()] || 'other' }));
  out.media = stats
    .filter((f) => KIND_OF[path.extname(f.full).toLowerCase()] && ['image', 'video', 'audio', 'doc'].includes(KIND_OF[path.extname(f.full).toLowerCase()]) && SOCIAL_RE.test(rel(f.full)))
    .sort((a, b) => b.mtime - a.mtime).slice(0, 600)
    .map((f) => ({ path: f.full, rel: rel(f.full), size: f.size, mtime: f.mtime, kind: KIND_OF[path.extname(f.full).toLowerCase()], folder: path.dirname(rel(f.full)) }));
  out.ms = Date.now() - t0;
  return out;
}
function getScan(p, force) {
  const c = scanCache.get(p.id);
  const fresh = c && c.data && Date.now() - c.at < 5 * 60 * 1000;
  if (!c || (!fresh && !c.running) || (force && !c.running)) {
    const entry = c || { at: 0, data: null, running: false };
    entry.running = true; scanCache.set(p.id, entry);
    scanProject(p).then((d) => { entry.data = d; entry.at = Date.now(); }).catch((e) => { entry.error = String(e); }).finally(() => { entry.running = false; });
  }
  return scanCache.get(p.id);
}

// ---------- Claude usage index ----------
let usageCache = {};
try { usageCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch {}
const index = { claude: new Map(), codex: new Map(), ready: false, progress: 0, total: 0, startedAt: 0, error: null };

async function walk(dir, pred, out = []) {
  let ents; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) await walk(f, pred, out);
    else if (pred(e.name)) out.push(f);
  }
  return out;
}
async function parseClaudeFile(f) {
  const msgs = new Map(); const toolSeen = new Set();
  const r = { cwd: null, title: null, first: null, last: null, skills: {}, agents: {}, tools: {}, mcp: {}, msgsCount: 0, days: {} };
  const rl = readline.createInterface({ input: fs.createReadStream(f, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    const hasUsage = line.includes('"usage"');
    const isUser = !r.title && line.includes('"type":"user"');
    if (!hasUsage && !isUser && !line.includes('"tool_use"')) {
      if (!r.cwd && line.includes('"cwd"')) { const m = line.match(/"cwd":"([^"]+)"/); if (m) r.cwd = m[1]; }
      continue;
    }
    let o; try { o = JSON.parse(line); } catch { continue; }
    if (o.timestamp) { if (!r.first) r.first = o.timestamp; r.last = o.timestamp; }
    if (!r.cwd && o.cwd) r.cwd = o.cwd;
    if (o.isSidechain && o.type === 'user') continue;
    if (!r.title && o.type === 'user' && !o.isSidechain && o.message) {
      let c = o.message.content;
      if (Array.isArray(c)) c = (c.find((x) => x.type === 'text') || {}).text;
      if (typeof c === 'string' && c.trim() && !c.startsWith('<') && !c.startsWith('Caveat')) r.title = c.trim().replace(/\s+/g, ' ').slice(0, 140);
    }
    const m = o.message;
    if (o.type === 'assistant' && m && Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b.type !== 'tool_use' || toolSeen.has(b.id)) continue;
        toolSeen.add(b.id);
        r.tools[b.name] = (r.tools[b.name] || 0) + 1;
        if (b.name === 'Skill' && b.input && b.input.skill) r.skills[b.input.skill] = (r.skills[b.input.skill] || 0) + 1;
        if ((b.name === 'Agent' || b.name === 'Task') && b.input) { const t = b.input.subagent_type || 'general-purpose'; r.agents[t] = (r.agents[t] || 0) + 1; }
        if (b.name.startsWith('mcp__')) { const s = b.name.split('__')[1]; r.mcp[s] = (r.mcp[s] || 0) + 1; }
      }
    }
    if (o.type === 'assistant' && m && m.usage && m.id) {
      msgs.set(m.id, { day: (o.timestamp || '').slice(0, 10), model: m.model || 'unknown', u: m.usage });
    }
  }
  for (const v of msgs.values()) {
    if (!v.day || v.model === '<synthetic>') continue;
    const d = (r.days[v.day] = r.days[v.day] || {});
    const x = (d[v.model] = d[v.model] || { i: 0, o: 0, cr: 0, cc: 0, n: 0 });
    x.i += v.u.input_tokens || 0; x.o += v.u.output_tokens || 0; x.cr += v.u.cache_read_input_tokens || 0; x.cc += v.u.cache_creation_input_tokens || 0; x.n++;
    r.msgsCount++;
  }
  return r;
}
async function readHead(f, n) { const fh = await fsp.open(f, 'r'); try { const b = Buffer.alloc(n); const { bytesRead } = await fh.read(b, 0, n, 0); return b.toString('utf8', 0, bytesRead); } finally { await fh.close(); } }
async function readTail(f, n, size) { const fh = await fsp.open(f, 'r'); try { const len = Math.min(n, size); const b = Buffer.alloc(len); await fh.read(b, 0, len, size - len); return b.toString('utf8'); } finally { await fh.close(); } }
let codexTitles = null;
function loadCodexTitles() {
  codexTitles = new Map();
  try {
    for (const l of fs.readFileSync(path.join(CODEX, 'session_index.jsonl'), 'utf8').split('\n')) {
      if (!l.trim()) continue; try { const o = JSON.parse(l); if (o.id && o.thread_name) codexTitles.set(o.id, { name: o.thread_name, at: o.updated_at }); } catch {}
    }
  } catch {}
}
async function parseCodexFile(f, st) {
  const r = { cwd: null, title: null, id: null, first: null, last: null, day: null, total: null, limits: null, model: null };
  const head = await readHead(f, 200000);
  const first = head.split('\n')[0];
  try {
    const o = JSON.parse(first); const p = o.payload || {};
    r.cwd = p.cwd || null; r.id = p.session_id || p.id || null; r.first = o.timestamp || p.timestamp || null;
    r.model = p.model || p.model_slug || null;
    r.parent = p.parent_thread_id || null;
  } catch {
    const m = first.match(/"cwd":"([^"]+)"/); if (m) r.cwd = m[1];
  }
  const um = head.match(/"type":"user_message","message":"((?:[^"\\]|\\.){1,300})"/) || head.match(/"role":"user".{0,200}?"text":"((?:[^"\\]|\\.){3,300})"/);
  if (um) { try { r.title = JSON.parse('"' + um[1] + '"').replace(/\s+/g, ' ').slice(0, 140); } catch {} }
  const tail = await readTail(f, 600000, st.size);
  const lines = tail.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.includes('"token_count"') && l.includes('total_token_usage')) {
      try { const o = JSON.parse(l); const info = o.payload.info; r.total = info.total_token_usage; r.limits = o.payload.rate_limits || null; r.last = o.timestamp; } catch {}
      break;
    }
  }
  if (!r.last) r.last = new Date(st.mtimeMs).toISOString();
  const dm = path.basename(f).match(/rollout-(\d{4}-\d{2}-\d{2})/);
  r.last = new Date(st.mtimeMs).toISOString();
  r.day = dm ? dm[1] : (r.first || r.last).slice(0, 10);
  return r;
}
let indexBuilding = false;
async function buildIndex() {
  if (indexBuilding) return; indexBuilding = true; index.error = null;
  index.startedAt = Date.now(); index.ready = false; index.progress = 0;
  try {
    loadCodexTitles();
    const cFiles = await walk(path.join(CLAUDE, 'projects'), (n) => n.endsWith('.jsonl'));
    const xFiles = [...await walk(path.join(CODEX, 'sessions'), (n) => n.endsWith('.jsonl')), ...await walk(path.join(CODEX, 'archived_sessions'), (n) => n.endsWith('.jsonl'))];
    index.total = cFiles.length + xFiles.length;
    const next = { claude: {}, codex: {} };
    await pool(xFiles, 8, async (f) => {
      const st = await fsp.stat(f); const key = f; const c = usageCache.codex && usageCache.codex[key];
      if (c && c.sig === st.mtimeMs + ':' + st.size) next.codex[key] = c; else next.codex[key] = { sig: st.mtimeMs + ':' + st.size, data: await parseCodexFile(f, st) };
      index.codex.set(key, next.codex[key].data); index.progress++;
    });
    const todo = [];
    for (const f of cFiles) {
      const st = await fsp.stat(f); const c = usageCache.claude && usageCache.claude[f]; const sig = st.mtimeMs + ':' + st.size;
      if (c && c.sig === sig) { next.claude[f] = c; index.claude.set(f, c.data); index.progress++; } else todo.push({ f, sig });
    }
    todo.sort((a, b) => fs.statSync(b.f).mtimeMs - fs.statSync(a.f).mtimeMs);
    await pool(todo, 3, async ({ f, sig }) => {
      try { const data = await parseClaudeFile(f); data.last = new Date(fs.statSync(f).mtimeMs).toISOString(); next.claude[f] = { sig, data }; index.claude.set(f, data); } catch {}
      index.progress++;
    });
    for (const f of index.claude.keys()) if (!next.claude[f]) index.claude.delete(f);
    for (const f of index.codex.keys()) if (!next.codex[f]) index.codex.delete(f);
    usageCache = next;
    fs.writeFileSync(CACHE_FILE, JSON.stringify(next));
    index.ready = true;
  } catch (e) { index.error = String(e && e.stack || e); index.ready = true; } finally { indexBuilding = false; }
}

// ---------- aggregation ----------
const fixId = (s) => (s || '').toLowerCase();
function modelFamily(m) { const x = fixId(m); if (x.includes('opus')) return 'Opus'; if (x.includes('sonnet')) return 'Sonnet'; if (x.includes('haiku')) return 'Haiku'; if (x.includes('fable')) return 'Fable'; return m.replace(/^claude-/, ''); }
function sessions() {
  const out = [];
  for (const [f, d] of index.claude) {
    let tot = 0, out_ = 0; for (const day of Object.values(d.days)) for (const m of Object.values(day)) { tot += m.i + m.o + m.cr + m.cc; out_ += m.o; }
    if (!d.cwd && !d.title) continue;
    out.push({ agent: 'claude', id: path.basename(f, '.jsonl'), title: d.title || '(untitled session)', cwd: d.cwd, project: projectFor(d.cwd), start: d.first, end: d.last, tokens: tot, output: out_, messages: d.msgsCount, file: f });
  }
  for (const [f, d] of index.codex) {
    if (!d.id) continue;
    const t = codexTitles && (codexTitles.get(d.id) || codexTitles.get(d.parent));
    out.push({ agent: 'codex', id: d.id || path.basename(f), title: (t && t.name) || d.title || '(codex session)', cwd: d.cwd, project: projectFor(d.cwd), start: d.first, end: d.last, tokens: d.total?.total_tokens || 0, output: d.total?.output_tokens || 0, messages: 0, file: f });
  }
  return out.sort((a, b) => (b.end || '').localeCompare(a.end || ''));
}
function usage() {
  const days = {}, models = {}, byProject = {}, tokenTypes = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const bump = (day, agent, project, n) => { const d = (days[day] = days[day] || { claude: 0, codex: 0 }); d[agent] += n; const p = (byProject[project || 'other'] = byProject[project || 'other'] || { claude: 0, codex: 0, sessions: 0 }); p[agent] += n; };
  for (const [, d] of index.claude) {
    const proj = projectFor(d.cwd); let had = false;
    for (const [day, ms] of Object.entries(d.days)) for (const [model, u] of Object.entries(ms)) {
      const n = u.i + u.o + u.cr + u.cc; bump(day, 'claude', proj, n); had = true;
      const fam = modelFamily(model); const mm = (models[fam] = models[fam] || { agent: 'claude', tokens: 0, output: 0, calls: 0 }); mm.tokens += n; mm.output += u.o; mm.calls += u.n;
      tokenTypes.input += u.i; tokenTypes.output += u.o; tokenTypes.cacheRead += u.cr; tokenTypes.cacheWrite += u.cc;
    }
    if (had) (byProject[proj || 'other'] = byProject[proj || 'other'] || { claude: 0, codex: 0, sessions: 0 }).sessions++;
  }
  let limits = null, limitsAt = '';
  for (const [, d] of index.codex) {
    if (!d.total) continue; const proj = projectFor(d.cwd);
    bump(d.day, 'codex', proj, d.total.total_tokens || 0);
    (byProject[proj || 'other'] = byProject[proj || 'other'] || { claude: 0, codex: 0, sessions: 0 }).sessions++;
    const mm = (models['Codex'] = models['Codex'] || { agent: 'codex', tokens: 0, output: 0, calls: 0 }); mm.tokens += d.total.total_tokens || 0; mm.output += d.total.output_tokens || 0; mm.calls++;
    if (d.limits && (d.last || '') > limitsAt) { limits = d.limits; limitsAt = d.last; }
  }
  return { days, models, byProject, tokenTypes, codexLimits: limits ? { ...limits, at: limitsAt } : null };
}
function toolStats() {
  const skills = {}, agents = {}, tools = {}, mcp = {};
  const add = (a, b) => { for (const [k, v] of Object.entries(b || {})) a[k] = (a[k] || 0) + v; };
  for (const [, d] of index.claude) { add(skills, d.skills); add(agents, d.agents); add(tools, d.tools); add(mcp, d.mcp); }
  return { skills, agents, tools, mcp };
}

// ---------- skills ----------
function parseFrontmatter(txt) {
  const m = txt.match(/^---\n([\s\S]*?)\n---/); const o = {};
  if (m) for (const l of m[1].split('\n')) { const k = l.match(/^([A-Za-z_-]+):\s*(.*)$/); if (k) o[k[1]] = k[2].replace(/^["']|["']$/g, ''); }
  return o;
}
function listSkills(dir, source) {
  const out = [];
  let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (!(e.isDirectory() || e.isSymbolicLink()) || e.name.startsWith('.')) continue;
    const f = path.join(dir, e.name, 'SKILL.md');
    try { const fm = parseFrontmatter(fs.readFileSync(f, 'utf8')); out.push({ name: fm.name || e.name, dir: e.name, description: fm.description || '', source, path: f }); } catch {}
  }
  return out;
}
function agentsInfo() {
  const claudeSkills = listSkills(path.join(CLAUDE, 'skills'), 'user');
  let plugins = [];
  try {
    const ip = JSON.parse(fs.readFileSync(path.join(CLAUDE, 'plugins', 'installed_plugins.json'), 'utf8')).plugins || {};
    for (const [k, v] of Object.entries(ip)) {
      const e = v[0]; plugins.push({ name: k.split('@')[0], key: k, version: e.version, installed: e.installedAt });
      for (const s of listSkills(path.join(e.installPath, 'skills'), 'plugin:' + k.split('@')[0])) claudeSkills.push(s);
    }
  } catch {}
  const codexSkills = listSkills(path.join(CODEX, 'skills'), 'user');
  let codexPlugins = [];
  try {
    const cfg = fs.readFileSync(path.join(CODEX, 'config.toml'), 'utf8');
    for (const m of cfg.matchAll(/\[plugins\."([^"]+)"\]\s*\nenabled\s*=\s*(true|false)/g)) codexPlugins.push({ name: m[1].split('@')[0], key: m[1], enabled: m[2] === 'true' });
  } catch {}
  let claudeMcp = [];
  try { const s = JSON.parse(fs.readFileSync(path.join(HOME, '.claude.json'), 'utf8')); claudeMcp = Object.keys(s.mcpServers || {}); } catch {}
  return { claude: { skills: claudeSkills, plugins, mcp: claudeMcp }, codex: { skills: codexSkills, plugins: codexPlugins } };
}
function which(bin) {
  const dirs = (process.env.PATH || '').split(':').concat([path.join(HOME, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin', path.join(HOME, '.local/node/bin')]);
  for (const d of dirs) { const p = path.join(d, bin); try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {} }
  if (bin === 'codex') {
    const candidates = ['/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex', '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex', '/Applications/Codex.app/Contents/Resources/codex'];
    for (const p of candidates) { try { fs.accessSync(p, fs.constants.X_OK); return p; } catch {} }
  }
  return null;
}
function health() {
  const codexApp = ['/Applications/Codex.app', path.join(HOME, 'Applications/Codex.app')].find((p) => fs.existsSync(p)) || null;
  return {
    drive: fs.existsSync(DRIVE), driveRoot: DRIVE, home: HOME,
    claude: { cli: which('claude'), data: fs.existsSync(path.join(CLAUDE, 'projects')), app: fs.existsSync('/Applications/Claude.app') },
    codex: { cli: which('codex'), data: fs.existsSync(path.join(CODEX, 'sessions')), app: codexApp },
    index: { ready: index.ready, progress: index.progress, total: index.total, error: index.error, files: { claude: index.claude.size, codex: index.codex.size } },
    node: process.version,
  };
}

// ---------- actions ----------
const sh = (s) => "'" + s.replace(/'/g, "'\\''") + "'";
const as = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
function run(cmd, args) { return new Promise((res, rej) => execFile(cmd, args, { timeout: 15000 }, (e, so, se) => (e ? rej(new Error(se || e.message)) : res(so)))); }
async function launch(project, agent, sub) {
  let cwd = project.path;
  if (sub) { const c = path.resolve(String(sub)); if (isAllowed(c) && fs.existsSync(c) && fs.statSync(c).isDirectory()) cwd = c; }
  let cmd;
  if (agent === 'claude') { const b = which('claude'); if (!b) throw new Error('Claude Code CLI not found'); cmd = `cd ${sh(cwd)} && ${sh(b)}`; }
  else if (agent === 'codex') {
    const b = which('codex');
    if (b) cmd = `cd ${sh(cwd)} && ${sh(b)}`;
    else if (fs.existsSync('/Applications/Codex.app')) { await run('open', ['-a', 'Codex', cwd]); return { ok: true, note: 'Opened in Codex app' }; }
    else throw new Error('Codex CLI/app not found on this Mac. Install it, then this button will work.');
  } else cmd = `cd ${sh(cwd)}`;
  await run('osascript', ['-e', 'tell application "Terminal" to activate', '-e', `tell application "Terminal" to do script "${as(cmd)}"`]);
  return { ok: true };
}
async function createProject({ name, description, template }) {
  name = String(name || '').trim().replace(/[\/\\:*?"<>|]/g, '').slice(0, 60);
  if (!name) throw new Error('Name required');
  const id = slug(name);
  if (state.projects.some((p) => p.id === id)) throw new Error('A project with that name already exists');
  const dir = path.join(DRIVE, name + ' Project');
  if (fs.existsSync(dir)) throw new Error('Folder already exists: ' + dir);
  const subs = { general: ['Docs', 'Assets', 'Content - social medias'], app: ['App', 'Docs', 'Assets', 'Content - social medias'], shop: ['Store', 'Docs', 'Assets', 'Content - social medias'], content: ['Raw material', 'Final videos', 'Content - social medias', 'Assets'], study: ['Sources', 'Notes', 'Assignments', 'Outputs'] }[template] || ['Docs', 'Assets'];
  await fsp.mkdir(dir, { recursive: true });
  for (const s of subs) await fsp.mkdir(path.join(dir, s), { recursive: true });
  const brief = `# ${name}\n\n${description || 'Describe the project here.'}\n\n## Rules for AI agents\n- Keep every file for this project inside this folder.\n- Ask before deleting or publishing anything.\n\n## Structure\n${subs.map((s) => `- ${s}/`).join('\n')}\n`;
  await fsp.writeFile(path.join(dir, 'CLAUDE.md'), brief);
  await fsp.writeFile(path.join(dir, 'AGENTS.md'), brief);
  const proj = { id, name, path: dir, color: COLORS[state.projects.length % COLORS.length], description: description || '', aliases: [name], rules: JSON.parse(JSON.stringify(DEFAULT_RULES)), created: new Date().toISOString() };
  if (template === 'study') proj.workspace = { study: { subject: '', goal: '', rules: '', model: '', sources: [] } };
  state.projects.push(proj); saveState(state);
  return proj;
}

// ---------- live agents ----------
const jarvisPids = new Set();
function execP(cmd, args, opt = {}) { return new Promise((res) => execFile(cmd, args, { timeout: 8000, maxBuffer: 4e6, ...opt }, (e, so) => res(e ? '' : String(so)))); }
async function running() {
  const out = await execP('ps', ['-axo', 'pid=,ppid=,etime=,comm=']);
  const procs = [];
  for (const l of out.split('\n')) {
    const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/); if (!m) continue;
    const base = path.basename(m[4]);
    if (!/^(claude|codex)$/.test(base) || /Helper|disclaimer/i.test(m[4])) continue;
    procs.push({ pid: +m[1], ppid: +m[2], etime: m[3], agent: base, exe: m[4] });
  }
  await pool(procs, 6, async (p) => {
    const cwd = (await execP('lsof', ['-a', '-p', String(p.pid), '-d', 'cwd', '-Fn'])).split('\n').find((x) => x.startsWith('n'));
    p.cwd = cwd ? cwd.slice(1) : null; p.project = projectFor(p.cwd);
    const args = (await execP('ps', ['-o', 'command=', '-p', String(p.pid)])).trim();
    p.via = jarvisPids.has(p.pid) ? 'Jarvis' : /--output-format stream-json|app-server|Application Support\/Claude/.test(args) ? 'Desktop app' : 'Terminal';
    p.sessionId = (args.match(/--resume[= ]([0-9a-f-]{36})/) || [])[1] || null;
  });
  const sec = (e) => { const [d, r] = e.includes('-') ? e.split('-') : [0, e]; const t = r.split(':').map(Number).reverse(); return +d * 86400 + (t[2] || 0) * 3600 + (t[1] || 0) * 60 + (t[0] || 0); };
  return procs.map((p) => ({ ...p, seconds: sec(p.etime) })).sort((a, b) => a.seconds - b.seconds);
}
const UUID = /^[0-9a-fA-F-]{36}$/;
async function resumeSession(agent, id) {
  if (!UUID.test(id || '')) throw new Error('bad session id');
  const s = sessions().find((x) => x.id === id && x.agent === agent) ; if (!s || !s.cwd) throw new Error('session or its folder not found');
  if (!fs.existsSync(s.cwd)) throw new Error('Folder no longer exists: ' + s.cwd);
  const bin = which(agent); if (!bin) throw new Error(agent + ' CLI not found');
  const cmd = `cd ${sh(s.cwd)} && ${sh(bin)} ${agent === 'claude' ? '--resume' : 'resume'} ${id}`;
  await run('osascript', ['-e', 'tell application "Terminal" to activate', '-e', `tell application "Terminal" to do script "${as(cmd)}"`]);
  return { ok: true };
}
function personaPrompt(voice, timeZone) {
  const ps = state.projects.map((p) => `${p.name} (${p.path})${p.description ? ': ' + p.description : ''}`).join('; ');
  return `You are Jarvis, @@NAME@@’s personal command-center assistant inside the Jarvis dashboard. @@NAME@@’s projects: ${ps}. Be direct and useful; you can read files in the project folder to answer. Never reveal secrets or key files.` +
    require('./lib/conversation-style')(timeZone) +
    (voice ? ' This is a spoken conversation: answer in one to three short natural sentences, no markdown, no lists, no code blocks, no emojis, and reply in the language @@NAME@@ spoke.' : '');
}
async function ask(req,res,b){
 const agent=b.agent==='codex'?'codex':'claude',original=String(b.prompt||'');
 if(!original.trim()||original.length>8000)return send(res,400,{error:original.length>8000?'Message exceeds 8,000 characters. Split it; nothing was shortened.':'empty prompt'});
 if(!which(agent))return send(res,400,{error:agent+' CLI not found on this Mac'});
 const pr=state.projects.find(p=>p.id===b.project),cwd=pr?pr.path:DRIVE,sid=b.sessionId&&UUID.test(b.sessionId)?b.sessionId:null;
 res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store',Connection:'keep-alive','X-Accel-Buffering':'no'});
 const journal=ctx.chatJournal.start({agentId:'raw-'+agent,project:pr?.id||'jarvis',prompt:original,engine:agent,sessionId:sid});let ended=false;
 const emit=e=>{journal.event(e);try{res.write('data: '+JSON.stringify(e)+'\n\n');}catch{}};
 emit({type:'journal',id:journal.id});
 try{const h=runner.spawnAgent({agent,cwd,sessionId:sid,input:require('./lib/prompt-enhance')(original,b.enhancePrompts===true),system:personaPrompt(b.voice, b.timeZone),skillLibrary:true,edits:!!b.allowEdits,tools:b.allowEdits?'Read,Glob,Grep,Edit,Write,Bash,WebSearch,WebFetch':'Read,Glob,Grep,WebSearch,WebFetch',search:agent==='codex',timeoutMs:600000},e=>{if(ended)return;if(e.type==='done'&&e.text&&!e.streamed)emit({type:'delta',text:e.text});emit(e);if(e.type==='done'||e.type==='error'){ended=true;journal.finish(e.type==='done'?'completed':'failed');res.end();}});journal.setHandle(h);}catch(e){emit({type:'error',message:e.message});journal.finish('failed');res.end();}
}

// ---------- http ----------
function send(res, code, body, type = 'application/json') {
  const buf = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(buf);
}
function readRaw(req, max) { return new Promise((res, rej) => { const chunks = []; let n = 0; req.on('data', (c) => { n += c.length; if (n > max) { rej(Object.assign(new Error('Upload too large'), { status: 413 })); req.destroy(); } else chunks.push(c); }); req.on('end', () => res(Buffer.concat(chunks))); req.on('error', rej); }); }
function readBody(req) { return new Promise((res, rej) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e6) req.destroy(); }); req.on('end', () => { try { res(b ? JSON.parse(b) : {}); } catch (e) { rej(e); } }); }); }
function serveFile(req, res, f) {
  let st; try { st = fs.statSync(f); } catch { return send(res, 404, { error: 'not found' }); }
  const ext = path.extname(f).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const range = req.headers.range;
  const hdr = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff' };
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/); let s = m[1] ? +m[1] : 0, e = m[2] ? +m[2] : st.size - 1;
    if (!m[1] && m[2]) { s = Math.max(0, st.size - +m[2]); e = st.size - 1; }
    e = Math.min(e, st.size - 1);
    if (s > e) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { ...hdr, 'Content-Range': `bytes ${s}-${e}/${st.size}`, 'Content-Length': e - s + 1 });
    fs.createReadStream(f, { start: s, end: e }).pipe(res);
  } else { res.writeHead(200, { ...hdr, 'Content-Length': st.size }); fs.createReadStream(f).pipe(res); }
}
const NOISE = /(^|\/)(arcads-claude-code|\.claude|brag-output|[^/]*-bak[^/]*|restore-report[^/]*|vendor|Pods)\//i;
function important(p) {
  const sc = getScan(p); const d = sc && sc.data;
  const rules = (p.rules || []).map((r) => {
    let re = null; try { re = new RegExp(r.pattern, 'i'); } catch {}
    const hits = d && re ? d.all.filter((f) => !NOISE.test(f.rel) && (!r.kinds || !r.kinds.length || r.kinds.includes(f.kind)) && re.test(f.rel)) : [];
    hits.sort((a, b) => b.mtime - a.mtime);
    return { ...r, valid: !!re, count: hits.length, files: hits.slice(0, 24) };
  });
  return { scanning: !!(sc && sc.running) || !d, rules };
}
function cleanRules(rules) {
  if (!Array.isArray(rules)) throw new Error('rules must be a list');
  return rules.slice(0, 12).map((r, i) => {
    const pattern = String(r.pattern || '').slice(0, 200); new RegExp(pattern, 'i');
    return { id: String(r.id || 'r' + Date.now() + i).slice(0, 40), label: String(r.label || 'Rule').slice(0, 60), pattern, kinds: (Array.isArray(r.kinds) ? r.kinds : []).filter((k) => ['video', 'image', 'audio', 'doc', 'code', 'other'].includes(k)) };
  });
}
const projectsView = () => state.projects.map((p) => {
  const sc = getScan(p); const d = sc && sc.data;
  return { ...p, exists: fs.existsSync(p.path), scanning: !!(sc && sc.running), scan: d ? { files: d.files, bytes: d.bytes, kinds: d.kinds, folders: d.folders.slice(0, 30), recent: d.recent, truncated: d.truncated, scannedAt: d.scannedAt, ms: d.ms } : null };
});

// ---------- modules ----------
const ctx = { ROOT, DATA, DRIVE, HOME, state, jarvisPids, which, send, readBody, readRaw, inside, projectFor, getScan, sessions, usage, indexReady: () => index.ready };
fs.mkdirSync(DATA, { recursive: true });
const notifications = require('./lib/notifications')(ctx); ctx.notifications = notifications;
const vault = require('./lib/vault')(ctx);
const graphActivity = require('./lib/graph-activity')(ctx); ctx.graphActivity = graphActivity;
const desktopWorkspace = require('./lib/desktop-workspace')(ctx);
const runner = require('./lib/runner')(ctx);
const voice = require('./lib/voice')(ctx, vault);
const video = require('./lib/video')(ctx, voice);
const videoSkills = require('./lib/video-skills')(ctx, runner, video);
ctx.chatJournal = require('./lib/chat-journal')(ctx);
const agents = require('./lib/agents')(ctx, runner, video, vault);
ctx.saveState = saveState;
const workspace = require('./lib/workspace')(ctx);
const remote = require('./lib/remote')(ctx);
const system = require('./lib/system')(ctx, { vault, voice, runner, agents, listSkills, health });
const blender = require('./lib/blender')(ctx); ctx.blender = blender;
const gemini = require('./lib/gemini')(ctx, vault); ctx.gemini = gemini;
const providers = require('./lib/providers')(ctx, vault); ctx.providers = providers;
ctx.isAllowed = isAllowed; ctx.saveState = saveState; ctx.remoteHost = () => (typeof remote !== 'undefined' && remote.firstHost ? remote.firstHost() : null); ctx.skillUsage = () => toolStats().skills;
const models = require('./lib/models')(ctx, { gemini }); ctx.models = models;
const skills = require('./lib/skills')(ctx, {}); ctx.skills = skills; try { skills.installOwn(true); } catch (e) { console.error('skill install failed:', e.message); }
const council = require('./lib/council')(ctx, { runner }); if (agents.applyRecommended) agents.applyRecommended(false);
const convos = require('./lib/convos')(ctx, { runner, agents });
const apple = require('./lib/apple')(ctx, { vault });
const simadmin = require('./lib/simadmin')(ctx);
const webcheck = require('./lib/webcheck')(ctx);
const shop = require('./lib/shop')(ctx, { runner, vault });
const projectsMod = require('./lib/projects')(ctx, { agents, vault });
const obsidian = require('./lib/obsidian')(ctx);
const devtools = require('./lib/devtools')(ctx);
const voicenotes = require('./lib/voicenotes')(ctx);
const share = require('./lib/share')(ctx);
const imDeps = { voicenotes, share };
const imessage = require('./lib/imessage')(ctx, imDeps);
const reports = require('./lib/reports')(ctx, { agents, runner, imessage, voicenotes }); imDeps.reportsContext = reports.context;
const alwayson = require('./lib/alwayson')(ctx, { imessage });
const avatar = require('./lib/avatar')(ctx, { imessage });
ctx.usage = usage;
const usageOverview = require('./lib/usage-overview')(ctx, { vault, providers, models, gemini, claudeProbe: () => ctx.claudeProbe() });
ctx.claudeLimits = (info) => {
  const u = (info && info.unifiedWindows) || {}; const win = []; const add = (k, id, label, minutes) => { const w = u[k]; if (w && typeof w.utilization === 'number') win.push({ id, label, usedPercent: Math.max(0, Math.min(100, w.utilization * 100)), windowMinutes: minutes, resetsAt: typeof w.resetsAt === 'number' ? new Date(w.resetsAt * 1000).toISOString() : null }); };
  add('five_hour', 'five-hour', '5-hour window', 300); add('seven_day', 'weekly', 'Weekly window', 10080); if (win.length) usageOverview.setSnapshot({ accounts: [{ id: 'claude', at: new Date().toISOString(), windows: win }] });
};
// a tiny Claude call (Haiku, one word) so the limits stay fresh when nothing else is running
ctx.claudeProbe = () => new Promise((resolve) => { const bin = ctx.which('claude'); if (!bin) return resolve(false); const { spawn } = require('child_process'); const ch = spawn(bin, ['-p', 'Reply with exactly: ok', '--output-format', 'stream-json', '--verbose', '--model', 'claude-haiku-5-5'], { stdio: ['ignore', 'pipe', 'ignore'], cwd: DATA }); let buf = ''; const kill = setTimeout(() => { try { ch.kill(); } catch {} }, 60000);
  ch.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { const j = JSON.parse(line); if (j.type === 'rate_limit_event') ctx.claudeLimits(j.rate_limit_info); } catch {} } }); ch.on('close', () => { clearTimeout(kill); resolve(true); }); ch.on('error', () => resolve(false)); });
const background = require('./lib/background-monitor')(ctx, { check: async () => { await usageOverview.refresh(); return system.check ? system.check() : []; } });
const obsidianGraph = require('./lib/obsidian-graph')(ctx);
ctx.ROOT = ctx.ROOT || ROOT;
const keyCheck = require('./lib/keycheck')(ctx, vault);
const chatUpload = require('./lib/chat-upload')(ctx); ctx.chatUpload = chatUpload;
const taskWatch = require('./lib/task-watch')(ctx, { agents });
const MODULES = [sharedAppearance, chatUpload, avatar, keyCheck, taskWatch, notifications, desktopWorkspace, graphActivity, obsidianGraph, usageOverview, background, vault, voice, video, videoSkills, agents, workspace, system, blender, gemini, providers, models, skills, council, convos, apple, simadmin, webcheck, shop, projectsMod, obsidian, devtools, imessage, alwayson, reports, voicenotes, share, remote];
// Jarvis is a project too: the platform itself, with an engineer agent, so new management functions can be built from inside Jarvis.
(function seedJarvis() {
  try {
    state.seeded = state.seeded || {}; if (state.seeded.jarvis) return;
    let pr = state.projects.find((p) => p.id === 'jarvis');
    if (!pr) pr = registerProject({ name: 'Jarvis', path: ROOT, description: 'The Jarvis platform itself: the command center, the iPhone app, the iMessage bridge and every integration. Build new management functions here.', source: 'jarvis' });
    pr.workspace = pr.workspace || {}; if (!pr.workspace.apps) pr.workspace.apps = [{ id: 'jarvis-platform', name: 'Jarvis platform', kind: 'app', platforms: 'Browser · iPhone app (SwiftUI shell) · iMessage', path: '.', stack: 'Node.js · vanilla JS · SwiftUI', agent: 'jarvis-engineer', notes: 'Server code lives in lib/, pages in public/, the iPhone app in ios-app/. Restart after changing lib/ or server.js.', commands: [{ label: 'Restart Jarvis', cmd: 'launchctl kickstart -k gui/$(id -u)/com.jarvis.local' }, { label: 'Open the log', cmd: 'tail -n 60 data/server.log' }, { label: 'Install the app on the iPhone', cmd: 'cd ios-app && ./upload-testflight.sh' }] }];
    pr.resources = pr.resources || [{ title: 'Obsidian help', url: 'https://help.obsidian.md/', note: 'Vaults, links, plugins' }, { title: 'VS Code docs', url: 'https://code.visualstudio.com/docs', note: 'Workspaces and tasks' }];
    agents.addCustom({ id: 'jarvis-engineer', name: 'Jarvis Engineer', role: 'Builds new management functions for Jarvis', glyph: '🛠', color: '#2dd4ee', project: 'jarvis', engine: 'both', primary: 'codex', models: { claude: 'claude-sonnet-5-5', codex: 'gpt-6.1-sol' }, effort: { claude: 'high', codex: 'high' }, tools: 'write', approval: true, search: true, enabled: true, maxBudget: 8, instructions: "You are the Jarvis Engineer. You extend @@NAME@@’s Jarvis platform (this folder): server modules in lib/, pages in public/, the iPhone shell in ios-app/. Read CLAUDE.md or AGENTS.md and the memory notes in the repo first. Follow the existing style (zero-dependency Node, vanilla JS, flat UI without shadows, iPhone friendly). Always plan first, change small pieces, test on a scratch port with JARVIS_PORT and JARVIS_DATA before touching the live server, never read or print secrets, never delete user data, and tell @@NAME@@ when a restart is needed." });
    state.seeded.jarvis = true; saveState(state);
  } catch (e) { console.error('seed Jarvis failed:', e.message); }
})();
function registerProject(b) {
  const name = String(b.name || '').trim().slice(0, 60); const dir = path.resolve(String(b.path || ''));
  if (!name) throw new Error('name required');
  let st; try { st = fs.statSync(dir); } catch { throw new Error('folder does not exist'); }
  if (!st.isDirectory()) throw new Error('path is not a folder');
  if (dir === HOME || dir === DRIVE || dir === '/') throw new Error('That is your whole home folder or drive. Choose the specific project folder instead.');
  const relHome = path.relative(HOME, dir);
  if (!(inside(dir, DRIVE) || (inside(dir, HOME) && !relHome.startsWith('.') && !relHome.startsWith('Library')))) throw new Error('folder must be on the Jarvis drive or inside your home folder (not hidden or Library)');
  let pr = state.projects.find((x) => x.path === dir);
  if (!pr) { const id = slug(name) + (state.projects.some((x) => x.id === slug(name)) ? '-' + Date.now().toString(36).slice(-3) : ''); pr = { id, name, path: dir, color: COLORS[state.projects.length % COLORS.length], description: String(b.description || '').slice(0, 400), aliases: [name], rules: JSON.parse(JSON.stringify(DEFAULT_RULES)), created: new Date().toISOString(), source: String(b.source || 'api').slice(0, 20) }; state.projects.push(pr); }
  else { if (b.description) pr.description = String(b.description).slice(0, 400); }
  saveState(state); getScan(pr, true); return pr;
}

const server = http.createServer(async (req, res) => {
  const host = (req.headers.host || '').split(':')[0].toLowerCase();
  const isLocal = host === 'localhost' || host === '127.0.0.1';
  if (!isLocal && !remote.hostOk(host)) return send(res, 403, { error: 'forbidden host' });
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (!isLocal && (await remote.gate(req, res, url, p))) return;
    if (req.method === 'POST') {
      const origin = req.headers.origin;
      if (origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) && origin !== 'https://' + host) return send(res, 403, { error: 'bad origin' });
      const ct = req.headers['content-type'] || '';
      if (!/^(application\/json|application\/octet-stream|audio\/|video\/)/.test(ct)) return send(res, 415, { error: 'json or binary only' });
    }
    for (const m of MODULES) if (await m.handle(req, res, url, p)) return;
    if (p === '/api/register' && req.method === 'POST') { const b = await readBody(req); return send(res, 200, registerProject(b)); }
    if (p === '/api/handshake') { try { return send(res, 200, fs.readFileSync(path.join(ROOT, 'CODEX-HANDSHAKE.md'), 'utf8'), 'text/markdown; charset=utf-8'); } catch { return send(res, 404, { error: 'missing' }); } }
    if (p === '/api/health') return send(res, 200, health());
    if (p === '/api/version') { try { const pub = path.join(ROOT, 'public'); let m = 0; for (const f of fs.readdirSync(pub)) { if (/\.(js|css|html|webmanifest)$/.test(f)) m = Math.max(m, fs.statSync(path.join(pub, f)).mtimeMs); } return send(res, 200, { v: Math.round(m) }); } catch { return send(res, 200, { v: 0 }); } }
    if (p === '/api/projects' && req.method === 'GET') return send(res, 200, { projects: projectsView(), pins: state.pins });
    if (p === '/api/projects' && req.method === 'POST') { const proj = await createProject(await readBody(req)); return send(res, 200, proj); }
    if (p === '/api/important') { const pr = state.projects.find((x) => x.id === url.searchParams.get('project')); return pr ? send(res, 200, important(pr)) : send(res, 404, { error: 'unknown project' }); }
    if (p === '/api/project-update' && req.method === 'POST') {
      const b = await readBody(req); const pr = state.projects.find((x) => x.id === b.id);
      if (!pr) return send(res, 404, { error: 'unknown project' });
      if (typeof b.description === 'string') pr.description = b.description.slice(0, 400);
      if (typeof b.color === 'string' && /^#[0-9a-f]{6}$/i.test(b.color)) pr.color = b.color;
      if (b.rules !== undefined) pr.rules = cleanRules(b.rules);
      saveState(state); return send(res, 200, pr);
    }
    if (p === '/api/rescan' && req.method === 'POST') { for (const pr of state.projects) getScan(pr, true); return send(res, 200, { ok: true }); }
    if (p === '/api/media') {
      const out = [];
      for (const pr of state.projects) { const sc = getScan(pr); if (sc && sc.data) for (const m of sc.data.media) out.push({ ...m, project: pr.id }); }
      out.sort((a, b) => b.mtime - a.mtime);
      return send(res, 200, { media: out, scanning: state.projects.some((pr) => (scanCache.get(pr.id) || {}).running) });
    }
    if (p === '/api/pins' && req.method === 'POST') {
      const b = await readBody(req); const fp = path.resolve(String(b.path || ''));
      if (!isAllowed(fp) || !fs.existsSync(fp)) return send(res, 400, { error: 'path not allowed' });
      const i = state.pins.findIndex((x) => x.path === fp);
      if (b.pinned === false || (b.pinned === undefined && i >= 0)) { if (i >= 0) state.pins.splice(i, 1); }
      else if (i < 0) state.pins.push({ path: fp, project: projectFor(fp), note: String(b.note || '').slice(0, 200), at: Date.now() });
      saveState(state); return send(res, 200, { pins: state.pins });
    }
    if (p === '/api/usage') return send(res, 200, { ...usage(), tools: toolStats(), index: health().index });
    if (p === '/api/sessions') return send(res, 200, { sessions: sessions(), index: health().index, scope: 'Local Claude Code and Codex sessions, including archived Codex sessions. Cloud-only chats require an export.' });
    if (p === '/api/sessions/history') { const s = sessions().find(x => x.id === url.searchParams.get('id') && x.agent === url.searchParams.get('agent')); if (!s) return send(res, 404, {error:'Session not found'}); return send(res, 200, await require('./lib/session-history').page(s, url.searchParams)); }
    if (p === '/api/agents') return send(res, 200, { ...agentsInfo(), usage: toolStats(), health: health() });
    if (p === '/api/reindex' && req.method === 'POST') { if (index.ready) buildIndex(); return send(res, 200, { ok: true }); }
    if (p === '/api/running') return send(res, 200, { running: await running() });
    if (p === '/api/resume' && req.method === 'POST') { const b = await readBody(req); return send(res, 200, await resumeSession(b.agent === 'codex' ? 'codex' : 'claude', b.id)); }
    if (p === '/api/ask' && req.method === 'POST') return ask(req, res, await readBody(req));
    if (p === '/api/launch' && req.method === 'POST') {
      const b = await readBody(req); const pr = state.projects.find((x) => x.id === b.project);
      if (!pr) return send(res, 404, { error: 'unknown project' });
      return send(res, 200, await launch(pr, b.agent, b.path));
    }
    if (p === '/api/reveal' && req.method === 'POST') {
      const b = await readBody(req); const fp = path.resolve(String(b.path || ''));
      if (!isAllowed(fp) || !fs.existsSync(fp)) return send(res, 400, { error: 'path not allowed' });
      if (b.app === 'Blender' && /\.blend$/i.test(fp)) await run('open', ['-a', 'Blender', fp]); else await run('open', b.open ? [fp] : ['-R', fp]);
      return send(res, 200, { ok: true });
    }
    if (p === '/api/file') {
      const fp = path.resolve(url.searchParams.get('p') || '');
      const ext = path.extname(fp).toLowerCase();
      if (!isAllowed(fp) || SENSITIVE.test(fp) || SENSITIVE.test(fs.realpathSync(fp)) || /(?:^|[\\/])(?:vault\.enc|remote\.json|auth\.json|connectors\.json|agents\.json|state\.json|tasks\.json)(?:$)/i.test(fp) || !KIND_OF[ext] || !MIME[ext]) return send(res, 403, { error: 'file type/path not allowed' });
      return serveFile(req, res, fp);
    }
    // static
    let rel = p === '/' ? '/index.html' : p;
    const f = path.join(ROOT, 'public', path.normalize(rel).replace(/^(\.\.[\/\\])+/, ''));
    if (!inside(f, path.join(ROOT, 'public'))) return send(res, 403, 'forbidden', 'text/plain');
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, 'not found', 'text/plain');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  } catch (e) { send(res, 500, { error: String(e.message || e) }); }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Jarvis running → http://localhost:${PORT}`);
  for (const pr of state.projects) getScan(pr);
  buildIndex();
  setInterval(() => { if (index.ready) buildIndex(); }, 30 * 1000).unref();
});
server.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} busy — Jarvis may already be running.` : e); process.exit(1); });
