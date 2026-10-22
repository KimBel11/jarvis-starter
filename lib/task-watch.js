'use strict';
// Live, read-only view of every agent task (data/tasks.json) and every study-module work record, for the watcher windows on the home page.
// It only reads the in-memory task list and the study Work records. It never creates, changes, approves or cancels anything:
// approving or declining a plan goes through the existing /api/tasks/approve and /api/tasks/cancel routes, called by the page.
const path = require('path');

const RECENT = 6 * 3600e3;         // finished work stays visible for six hours
const MAX_FINISHED = 24;
const STUDY_EVERY = 2500;          // study records are read from disk, so they are scanned less often than the in-memory tasks
const FEED_KEEP = 300;
const ACTIVE = new Set(['queued', 'planning', 'running', 'awaiting_approval', 'waiting']);
const FILE_TOOL = /^(Write|Edit|MultiEdit|NotebookEdit)\b/;
// absolute paths in an agent's final text; spaces are allowed inside a path ("workspace folder"), the match ends at the first file extension that is followed by punctuation or whitespace
const PATH_RE = /(\/(?:Volumes|Users)\/[^\n"'`<>()\[\]|]{1,200}?\.[A-Za-z0-9]{1,8})(?=[\s.,;:)'"\]]|$)/g;

const clip = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const STUDY_STATUS = { queued: 'queued', drafting: 'running', reviewing: 'running', ready: 'done', needs_input: 'waiting', needs_revision: 'waiting', blocked: 'failed', failed: 'failed' };
const STATUS_TEXT = { queued: 'Queued', planning: 'Planning started', running: 'Working', awaiting_approval: 'Plan ready, waiting for your approval', waiting: 'Waiting for your input', done: 'Finished', failed: 'Failed', cancelled: 'Cancelled' };

module.exports = function makeTaskWatch(ctx, deps = {}) {
  const memo = new Map();                  // item id -> accumulated feed and what has already been announced
  const clients = new Set();
  let studyRows = [], studyAt = 0, timer = null, beat = 0;

  const slot = (id) => { let m = memo.get(id); if (!m) { m = { n: 0, feed: [], keys: new Set(), lastLog: null, status: null, files: [] }; memo.set(id, m); } return m; };
  const push = (m, kind, text, extra) => { m.feed.push({ n: ++m.n, k: kind, text: clip(text, kind === 'result' || kind === 'plan' ? 9000 : 1200), at: Date.now(), ...extra }); if (m.feed.length > FEED_KEEP) m.feed.shift(); };
  const once = (m, key, kind, text, extra) => { if (m.keys.has(key)) return; m.keys.add(key); push(m, kind, text, extra); };

  // The task log is a sliding window of the last 40 actions. Find how much of it is new since the last look.
  function newTail(old, now) {
    if (!old || !old.length) return now;
    for (let k = 0; k <= old.length; k++) { const keep = old.length - k; if (keep > now.length) continue; let same = true; for (let i = 0; i < keep; i++) if (old[k + i] !== now[i]) { same = false; break; } if (same) return now.slice(keep); }
    return now;
  }
  function logLine(m, s) {
    s = String(s);
    if (s.startsWith('⚠')) return push(m, 'warn', s.replace(/^⚠\s*/, ''));
    if (FILE_TOOL.test(s)) { const where = s.split(' · ').slice(1).join(' · ').trim(); if (where && !m.files.includes(where)) m.files.push(where); return push(m, 'file', s); }
    push(m, 'step', s);
  }
  const outputsFrom = (...texts) => { const seen = new Set(); for (const t of texts) for (const x of String(t || '').matchAll(PATH_RE)) seen.add(x[1].replace(/[.,;:]+$/, '')); return [...seen].slice(0, 12).map((p) => ({ path: p, name: path.basename(p) })); };
  const changed = (m) => m.files.slice(-30).map((p) => ({ path: p, name: path.basename(p) }));

  function agentMeta(id, fallbackName, fallbackColor) {
    const a = deps.agents && deps.agents.agentById(id);
    return { id, name: (a && a.name) || fallbackName || id, color: (a && a.color) || fallbackColor || '', glyph: (a && a.glyph) || '' };
  }

  function fromTask(t) {
    const id = 'task:' + t.id, m = slot(id), a = deps.agents.agentById(t.agent);
    if (m.lastLog === null) { push(m, 'user', t.prompt || t.title); for (const s of t.log || []) logLine(m, s); }
    else for (const s of newTail(m.lastLog, t.log || [])) logLine(m, s);
    m.lastLog = (t.log || []).slice();
    if (m.status !== t.status) { m.status = t.status; push(m, 'status', STATUS_TEXT[t.status] || t.status, { s: t.status }); }
    if (t.plan) once(m, 'plan:' + t.plan.length + ':' + (t.approvedAt || 0), 'plan', t.plan);
    if (t.approvedAt) once(m, 'approved:' + t.approvedAt, 'status', 'Approved' + (t.approveNote ? ': ' + clip(t.approveNote, 200) : ''));
    if (t.status === 'done' && t.output) once(m, 'result:' + (t.finishedAt || 0), 'result', t.output);
    if (t.status === 'failed' && t.error) once(m, 'error:' + (t.finishedAt || 0), 'error', t.error);
    const r = t.routing || {};
    return {
      id, source: 'task', taskId: t.id, agent: agentMeta(t.agent, t.agent, a && a.color), title: t.title || t.prompt, project: t.project || '',
      engine: r.engine || t.runEngine || t.engine || (a && a.engine) || '', model: r.model || '', effort: r.effort || '',
      status: t.status, phase: t.phase, stage: t.status === 'planning' ? 'Planning' : t.status === 'running' ? 'Executing' : '',
      createdAt: t.createdAt || 0, startedAt: t.startedAt || 0, finishedAt: t.finishedAt || 0, cost: t.cost || 0,
      approval: t.status === 'awaiting_approval', live: ['planning', 'running'].includes(t.status) && t.partial ? String(t.partial).slice(-1500) : '',
      files: changed(m), outputs: t.status === 'done' ? outputsFrom(t.output) : [], error: t.status === 'failed' ? clip(t.error, 400) : '', href: '#/team', m,
    };
  }

  function fromStudy(row) {
    const w = row.work, c = row.course, id = 'study:' + row.project + ':' + c.id + ':' + w.id, m = slot(id);
    const status = row.live === false && ['queued', 'drafting', 'reviewing'].includes(w.status) ? 'waiting' : (STUDY_STATUS[w.status] || 'waiting');
    const agentId = 'study-' + c.id + '-' + w.kind, a = deps.agents && deps.agents.agentById(agentId);
    const runs = Array.isArray(w.runs) ? w.runs : [], last = runs[runs.length - 1] || {};
    if (!m.n) push(m, 'user', w.prompt || w.title);
    if (m.status !== status) { m.status = status; push(m, 'status', STATUS_TEXT[status] || status, { s: status }); }
    if (w.stage) once(m, 'stage:' + w.stage, 'step', { sources: 'Reading the mapped course sources', draft: 'Drafting', council: 'Council review' }[w.stage] || 'Stage: ' + w.stage);
    runs.forEach((r, i) => { const role = String(r.role || ''), label = role.startsWith('council-') ? 'Council: ' + role.slice(8) : 'Draft by ' + (role || 'agent'); once(m, 'run:' + i + ':start', 'step', label + ' started'); if (r.status === 'done') once(m, 'run:' + i + ':done', 'step', label + ' finished'); if (r.status === 'failed') once(m, 'run:' + i + ':fail', 'warn', label + ' failed: ' + clip(r.error, 300)); });
    (w.reviews || []).forEach((r, i) => once(m, 'review:' + i + ':' + r.role, 'review', r.role + ': ' + r.verdict + (r.issues && r.issues.length ? ' · ' + r.issues.slice(0, 2).map((x) => clip(typeof x === 'string' ? x : JSON.stringify(x), 160)).join('; ') : '')));
    if (status === 'waiting') (w.questions || []).slice(0, 6).forEach((q, i) => once(m, 'q:' + w.finishedAt + ':' + i, 'warn', q));
    if (w.status === 'ready') once(m, 'ready', 'result', 'Reviewed by the full council and saved as ready.' + (w.wordCount ? ' ' + w.wordCount + ' words.' : ''));
    const cost = runs.reduce((n, r) => n + (typeof r.cost === 'number' ? r.cost : 0), 0), outs = w.outputPath ? [{ path: w.outputPath, name: path.basename(w.outputPath) }] : [];
    return {
      id, source: 'study', taskId: w.id, agent: agentMeta(agentId, c.name + ' · ' + (w.kind || 'study'), a && a.color), title: w.title, project: row.project, course: c.name,
      engine: last.engine || (a && a.engine) || 'claude', model: last.model || (a && a.models && a.models[last.engine || a.engine]) || '', effort: last.effort || '',
      status, stage: { sources: 'Reading sources', draft: 'Drafting', council: 'Council review' }[w.stage] || '', createdAt: w.createdAt || 0, startedAt: w.createdAt || 0, finishedAt: w.finishedAt || 0, cost,
      approval: false, live: '', files: [], outputs: outs, error: status === 'failed' ? clip((w.questions || [])[0] || 'The study run failed', 400) : '', href: '#/project/' + encodeURIComponent(row.project), m,
    };
  }

  function collect() {
    const out = [], now = Date.now();
    const list = deps.agents ? deps.agents.tasks() : [];
    for (const t of list) { try { const done = !ACTIVE.has(t.status) && !['planning', 'running'].includes(t.status); const at = t.finishedAt || t.startedAt || t.createdAt || 0; if (done && now - at > RECENT) continue; out.push(fromTask(t)); } catch {} }
    if (deps.study && deps.study.watchWorks) {
      if (now - studyAt > STUDY_EVERY) { studyAt = now; try { studyRows = deps.study.watchWorks(); } catch { studyRows = []; } }
      for (const r of studyRows) { try { out.push(fromStudy(r)); } catch {} }
    }
    const act = out.filter((i) => ACTIVE.has(i.status) || ['planning', 'running'].includes(i.status));
    const fin = out.filter((i) => !act.includes(i)).sort((a, b) => (b.finishedAt || b.createdAt) - (a.finishedAt || a.createdAt)).slice(0, MAX_FINISHED);
    const keep = new Set([...act, ...fin].map((i) => i.id)); for (const k of memo.keys()) if (!keep.has(k)) memo.delete(k);
    return [...act, ...fin];
  }

  const meta = (i) => { const { m, ...rest } = i; return rest; };
  const full = (i) => ({ ...meta(i), feed: i.m.feed, n: i.m.n });

  function tick() {
    if (!clients.size) return;
    const items = collect(), ids = new Set(items.map((i) => i.id));
    for (const c of clients) {
      for (const i of items) {
        const mt = meta(i), sig = JSON.stringify(mt), sent = c.sent.get(i.id);
        if (!sent) { c.sent.set(i.id, { n: i.m.n, sig }); c.write({ type: 'item', item: full(i), full: true }); continue; }
        if (sent.sig !== sig || sent.n !== i.m.n) { const add = i.m.feed.filter((e) => e.n > sent.n); c.sent.set(i.id, { n: i.m.n, sig }); c.write({ type: 'item', item: { ...mt, n: i.m.n }, feed: add }); }
      }
      for (const id of [...c.sent.keys()]) if (!ids.has(id)) { c.sent.delete(id); c.write({ type: 'remove', id }); }
    }
    if (++beat % 15 === 0) for (const c of clients) c.raw(': keep-alive\n\n');
  }
  const start = () => { if (!timer) timer = setInterval(tick, 1000); };
  const stop = () => { if (timer && !clients.size) { clearInterval(timer); timer = null; } };

  function stream(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const c = { sent: new Map(), raw: (s) => { try { res.write(s); } catch {} }, write: (o) => { try { res.write('data: ' + JSON.stringify(o) + '\n\n'); } catch {} } };
    c.raw('retry: 3000\n\n'); clients.add(c); studyAt = 0;
    c.write({ type: 'ready', at: Date.now() }); tick(); c.write({ type: 'synced' }); start();
    const gone = () => { clients.delete(c); stop(); }; req.on('close', gone); res.on('error', gone);
  }

  return {
    snapshot: () => collect().map(full),
    async handle(req, res, url, p) {
      if (req.method !== 'GET') return false;
      if (p === '/api/watch/events') { stream(req, res); return true; }
      if (p === '/api/watch') { studyAt = 0; ctx.send(res, 200, { items: collect().map(full), at: Date.now() }); return true; }
      return false;
    },
  };
};
