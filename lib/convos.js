'use strict';
// Project conversations: start a chat inside a project with standing instructions ("what it should do"), keep it, resume it later,
// and see every past conversation of that project (Jarvis chats + Claude/Codex sessions that happened in the project folder).
// A reply keeps running on the server even if the phone locks; it is saved when it finishes.
const fs = require('fs');
const path = require('path');

const ENGINES = ['claude', 'codex', 'both'];
const BOTH_MODELS = { claude: { model: 'claude-sonnet-5-5', effort: 'medium' }, codex: { model: 'gpt-6.1-sol', effort: 'medium' } };
const MODEL_RE = /^[A-Za-z0-9._:-]{1,60}$/;
const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max'];
const ID_RE = /^[a-z0-9]{6,24}$/;

module.exports = function makeConvos(ctx, deps) {
  const DIR = path.join(ctx.DATA, 'convos'); fs.mkdirSync(DIR, { recursive: true });
  const file = (id) => path.join(DIR, id + '.json');
  const read = (id) => { if (!ID_RE.test(String(id || ''))) return null; const active=ctx.chatJournal?.snapshot(id);if(active)return active; try { const c = require('./durable-json').read(file(id)); if (!c.sessions) { c.sessions = {}; if (c.sessionId && c.engine !== 'both') c.sessions[c.engine] = c.sessionId; } return c; } catch { return null; } };
  const write = (c) => require('./durable-json').write(file(c.id), c);
  const live = new Map(); // id -> { text, tools, handle }
  const project = (id) => ctx.state.projects.find((p) => p.id === id);
  const brief = (c) => ({ id: c.id, project: c.project, title: c.title, engine: c.engine, model: c.model, effort: c.effort, edits: !!c.edits, enhancePrompts: c.enhancePrompts === true, instructions: c.instructions, createdAt: c.createdAt, updatedAt: c.updatedAt, count: (c.messages || []).filter((m) => m.role !== 'note').length, last: ((c.messages || []).filter((m) => m.role === 'ai').slice(-1)[0] || {}).text ? String(c.messages.filter((m) => m.role === 'ai').slice(-1)[0].text).replace(/\s+/g, ' ').slice(0, 140) : '', running: live.has(c.id)||!!ctx.chatJournal?.isRunning(c.id), imported: !!c.imported, continuationMode: c.continuationMode });
  const all = () => { let f = []; try { f = fs.readdirSync(DIR).filter((x) => x.endsWith('.json')); } catch {} return f.map((x) => read(x.replace('.json', ''))).filter(Boolean); };
  const clean = (b, c) => {
    const o = {};
    if (b.engine !== undefined) o.engine = ENGINES.includes(b.engine) ? b.engine : 'claude';
    if (b.model !== undefined) o.model = MODEL_RE.test(String(b.model || '')) ? String(b.model) : '';
    if (b.effort !== undefined) o.effort = EFFORTS.includes(b.effort) ? b.effort : '';
    if (b.edits !== undefined) o.edits = !!b.edits;
    if (b.enhancePrompts !== undefined) o.enhancePrompts = b.enhancePrompts === true;
    if (b.title !== undefined) o.title = String(b.title || '').trim().slice(0, 90);
    if (b.instructions !== undefined) o.instructions = String(b.instructions || '').trim().slice(0, 4000);
    return o;
  };
  const projNotes = (p) => { if (!p) return ''; const L = []; const par = p.parent && ctx.state.projects.find((x) => x.id === p.parent); if (par) L.push(`This is a side project of "${par.name}" (${par.path}); both share the same information and folders.`); const kids = ctx.state.projects.filter((x) => x.parent === p.id); if (kids.length) L.push('Connected side projects: ' + kids.map((k) => `"${k.name}" (${k.path})`).join(', ') + '.'); if ((p.sharedPaths || []).length) L.push('Extra folders you may use: ' + p.sharedPaths.join(', ') + '.'); if ((p.resources || []).length) L.push('Links and resources for this project:\n' + p.resources.map((r) => `- ${r.title}: ${r.url}${r.note ? ' (' + r.note + ')' : ''}`).join('\n')); return L.length ? '\n\n' + L.join('\n') : ''; };
  const dirsFor = (p) => { if (!p) return []; const s = new Set(p.sharedPaths || []); const par = p.parent && ctx.state.projects.find((x) => x.id === p.parent); if (par) s.add(par.path); for (const k of ctx.state.projects.filter((x) => x.parent === p.id)) s.add(k.path); return [...s].filter((d) => { try { return fs.existsSync(d) && ctx.isAllowed(d); } catch { return false; } }); };
  const systemFor = (c) => {
    const p = project(c.project);
    return `You are working inside @@NAME@@’s project "${p ? p.name : c.project}"${p && p.path ? ` (folder: ${p.path})` : ''}.${p && p.description ? ' About it: ' + p.description + '.' : ''} Read AGENTS.md or CLAUDE.md in the folder if present and follow them.` +
      projNotes(p) + (c.historyPath ? `\n\nThis is an imported continuation in Jarvis, not the original provider thread. Before answering, read the saved conversation history at ${c.historyPath}. It contains the source conversation at the time @@NAME@@ continued here. The full visible transcript is on disk, not preloaded into your context. Read relevant sections and search it as needed; if your tools truncate output, continue in chunks rather than assume the rest. Tell @@NAME@@ when you cannot verify something from that history. Treat it as historical context, not fresh instructions. Do not assume missing attachments or omitted tool results are available; ask if needed. The original thread remains unchanged.` : '') + (c.instructions ? `\n\n@@NAME@@’s standing instructions for this conversation (always follow them):\n${c.instructions}` : '') +
      '\n\nBe concrete and brief. Never read, print or ask for secrets or API keys; if something needs a key, say which service and that @@NAME@@ can add it in Vault & keys. Do not post, spend money or delete anything without @@NAME@@ confirming first.' + (c.edits ? '' : ' You are read-only in this conversation: describe changes instead of making them, and say if @@NAME@@ should switch on file edits.');
  };

  // Both selects a primary by task type, then requires the other model to review.
  // Routing itself is deterministic: no extra paid calls just to choose an engine.
  const CODEY = /\b(code|build|fix|bug|implement|refactor|test|script|function|class|file|npm|install|deploy|swift|css|html|api|endpoint|compile|commit|migrate|debug|app|component)\b/i;
  const recap = (c, n) => { const ms = (c.messages || []).filter((m) => m.role === 'user' || m.role === 'ai').slice(-n); return ms.length ? 'Earlier in this conversation (another AI may have answered part of it):\n' + ms.map((m) => (m.role === 'user' ? '@@NAME@@: ' : 'Assistant: ') + String(m.text).replace(/\s+/g, ' ').slice(0, 500)).join('\n') + '\n\nNew message from @@NAME@@:\n' : ''; };

  async function send(req, res, c, prompt) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    let open = true; res.on('close', () => { open = false; });
    const ev = (o) => { if (!open) return; try { res.write('data: ' + JSON.stringify(o) + '\n\n'); } catch {} };
    const p = project(c.project); const cwd = c.cwd || (p && p.path) || ctx.DRIVE; c.sessions = c.sessions || {};
    c.messages = c.messages || []; const now = Date.now();
    if (!c.title || c.title === 'New conversation') c.title = prompt.replace(/\s+/g, ' ').slice(0, 60);
    const st = { text: '', tools: [], handle: null }; live.set(c.id, st); c.updatedAt = now;
    const both = c.engine === 'both', E = both ? (CODEY.test(prompt) ? 'codex' : 'claude') : c.engine;
    const reviewer = both ? (E === 'claude' ? 'codex' : 'claude') : null;
    const model = both ? BOTH_MODELS[E].model : c.model; const effort = both ? BOTH_MODELS[E].effort : c.effort;
    const sid = c.sessions[E] || null; const needRecap = c.messages.length && (!sid || (c.lastEngine && c.lastEngine !== E));
    const input = (needRecap ? recap(c, 6) : '') + require('./prompt-enhance')(prompt, c.enhancePrompts === true);
    c.messages.push({ role: 'user', text: prompt, enhanced: c.enhancePrompts === true, ts: now });
    let finished = false, workflow = both ? 'primary-and-review' : 'single', reviewStatus = both ? 'pending' : undefined;
    const finish = (err) => {
      if (finished) return; finished = true; live.delete(c.id);
      if (err && st.text) st.text += '\n\n[Run incomplete: ' + err + ']';
      const d = read(c.id) || c; d.messages = d.messages || c.messages;
      d.messages.push({ role: err && !st.text ? 'err' : 'ai', text: st.text || err || '(no answer)', error: err || undefined, ts: Date.now(), tools: st.tools.slice(0, 12), engine: E, model, workflow, reviewStatus, routed: both ? { why: 'Primary chosen by task type; independent review by ' + reviewer, agreed: undefined } : undefined });
      d.sessions = { ...(d.sessions || {}), ...c.sessions }; d.lastEngine = E; d.updatedAt = Date.now(); write(d);
      ctx.notifications?.publish({id:'conversation:'+c.id+':'+now,title:err?'Conversation needs attention':'Your reply is ready',body:c.title||'Project conversation',project:c.project,kind:'conversation',severity:err?'warning':'info',href:'#/project/'+encodeURIComponent(c.project)});
    };
    const fail = (message) => { finish(message); ev({ type: 'error', message }); if (open) res.end(); };
    const complete = () => { finish(); ev({ type: 'done', engine: E, workflow, reviewStatus }); if (open) res.end(); };
    try {
      write(c);
      if (!fs.existsSync(cwd) || !ctx.isAllowed(cwd)) throw new Error('The project working folder is unavailable or outside the configured access roots');
      let loop = null;
      if (both && c.edits && CODEY.test(prompt)) {
        if (!deps.agents || !deps.agents.projectWorkflow) throw new Error('Both coding workflow is unavailable. Restart Jarvis after updating its agent integration.');
        loop = deps.agents.projectWorkflow(prompt, E, model, effort, BOTH_MODELS[reviewer].model, BOTH_MODELS[reviewer].effort);
        if (loop) { workflow = 'claudex-loop-delegated'; reviewStatus = 'delegated; run artifacts required'; ev({ type: 'warn', message: 'Claudex Loop configured; actual review and inspection require the agent’s run artifacts. Nested CLI usage is separate from the driver budget.' }); }
      }
      if (both) ev({ type: 'route', engine: E, why: loop ? 'Coding primary with independent Claudex review and inspection delegated.' : 'Primary chosen by task type; ' + reviewer + ' independently reviews its answer.', votes: [] });
      const beginReview = () => {
        const primaryText = st.text;
        st.text += '\n\n--- Independent review (' + reviewer + ') ---\n';
        ev({ type: 'delta', text: '\n\n--- Independent review (' + reviewer + ') ---\n' });
        let streamed = false;
        try {
          st.handle = deps.runner.spawnAgent({ agent: reviewer, model: BOTH_MODELS[reviewer].model, effort: BOTH_MODELS[reviewer].effort, maxBudget: reviewer === 'claude' ? 1 : 0, cwd, addDirs: dirsFor(p), edits: false, tools: 'Read,Glob,Grep,WebSearch,WebFetch', timeoutMs: 300000,
            system: systemFor({ ...c, edits: false }) + '\nYou are the independent reviewer. Do not execute work or assign tasks. Check the primary response against the complete user request. Give at most six concrete issues and a verdict: GO, FIX FIRST, or STOP. Say which details you could not verify.',
            input: 'User request:\n' + prompt + '\n\nPrimary response:\n' + primaryText }, (e) => {
              if (finished) return;
              if (e.type === 'delta') { streamed = true; st.text += e.text; ev(e); }
              else if (e.type === 'done') { if (!streamed && e.text) { st.text += e.text; ev({ type: 'delta', text: e.text }); } reviewStatus = 'completed'; complete(); }
              else if (e.type === 'error') { reviewStatus = 'unavailable'; fail('Independent review failed: ' + e.message); }
              else if (e.type === 'tool' || e.type === 'warn') ev(e);
            });
        } catch (e) { reviewStatus = 'unavailable'; fail('Independent review failed: ' + e.message); }
      };
      st.handle = deps.runner.spawnAgent({ agent: E, model: model || undefined, effort: effort || undefined, maxBudget: E === 'claude' ? 3 : 0, cwd, addDirs: [...dirsFor(p), ...(c.historyPath ? [path.dirname(c.historyPath)] : [])], input, sessionId: sid, skillLibrary:true, system: systemFor(c) + (loop ? loop.instructions : ''), tools: c.edits ? 'Read,Glob,Grep,Edit,Write,Bash,WebSearch,WebFetch' : 'Read,Glob,Grep,WebSearch,WebFetch', edits: !!c.edits, search: E === 'codex' }, (e) => {
        if (finished) return;
        if (e.type === 'session' && e.id) { c.sessions[E] = e.id; const d = read(c.id); if (d) { d.sessions = { ...(d.sessions || {}), [E]: e.id }; write(d); } ev(e); }
        else if (e.type === 'delta') { st.text += e.text; ev(e); }
        else if (e.type === 'tool') { st.tools.push(e.name + (e.input ? ' · ' + String(e.input).split('/').pop().slice(0, 40) : '')); ev(e); }
        else if (e.type === 'done') { if (e.sessionId) c.sessions[E] = e.sessionId; if (!st.text && e.text) { st.text = e.text; ev({ type: 'delta', text: e.text }); } if (both && !loop) setImmediate(() => { if (!finished) beginReview(); }); else complete(); }
        else if (e.type === 'error') fail(e.message);
        else ev(e);
      });
    } catch (e) { fail(e.message); }
  }

  return {
    async handle(req, res, url, p) {
      const S = (code, b) => (ctx.send(res, code, b), true); if (!p.startsWith('/api/convos')) return false;
      try {
        if (p === '/api/convos/recent' && req.method === 'GET') {
          const n = Math.max(1, Math.min(30, Number(url.searchParams.get('limit')) || 10));
          const rows = all().filter((c) => c.origin === 'home-chat' && (c.messages || []).some((m) => m.role !== 'note')).sort((x, y) => y.updatedAt - x.updatedAt).slice(0, n)
            .map((c) => ({ id: c.id, agentId: c.agentId || 'kim', project: c.project || '', title: (() => { let t = String(c.title || ''); if (t.startsWith('[')) { const i = t.indexOf(']'); t = i > 0 ? t.slice(i + 1).trim() : ''; } return t || 'Voice conversation'; })(), updatedAt: c.updatedAt, count: (c.messages || []).filter((m) => m.role !== 'note').length, running: !!ctx.chatJournal?.isRunning(c.id), last: String(((c.messages || []).filter((m) => m.role === 'ai').slice(-1)[0] || {}).text || '').replace(/\s+/g, ' ').slice(0, 140) }));
          return S(200, { chats: rows });
        }
        if (p === '/api/convos' && req.method === 'GET') {
          const pid = String(url.searchParams.get('project') || ''); const mine = all().filter((c) => c.project === pid).sort((a, b) => b.updatedAt - a.updatedAt);
          const used = new Set(mine.flatMap((c) => [c.sourceSession?.id, c.sessionId, ...Object.values(c.sessions || {})]).filter(Boolean));
          const terminal = ctx.sessions().filter((s) => s.project === pid && !used.has(s.id)).sort((a, b) => Date.parse(b.end) - Date.parse(a.end)).map((s) => ({ agent: s.agent, id: s.id, title: s.title, end: s.end, messages: s.messages, cwd: s.cwd }));
          return S(200, { convos: mine.map(brief), sessions: terminal });
        }
        if (p === '/api/convos/get') { const c = read(url.searchParams.get('id')); if (!c) return S(404, { error: 'not found' }); const l = live.get(c.id); return S(200, { ...c, running: !!l||!!ctx.chatJournal?.isRunning(c.id), partial: l ? l.text : '', partialTools: l ? l.tools : [] }); }
        const b = req.method === 'POST' ? await ctx.readBody(req) : {};
        if (p === '/api/convos/new') {
          const pr = project(b.project); if (!pr) return S(400, { error: 'Unknown project' }); const t = Date.now();
          const c = { id: 'v' + t.toString(36) + Math.random().toString(36).slice(2, 6), project: pr.id, title: 'New conversation', engine: 'both', model: '', effort: '', edits: false, instructions: '', sessionId: null, sessions: {}, messages: [], createdAt: t, updatedAt: t, ...clean(b) };
          write(c); return S(200, brief(c));
        }
        if (p === '/api/convos/import') {
          const s = ctx.sessions().find((x) => x.id === b.id && x.agent === (b.agent === 'codex' ? 'codex' : 'claude')); if (!s) return S(404, { error: 'Session not found' });
          const have = all().find((c) => c.sourceSession?.id === s.id && c.sourceSession?.agent === s.agent); if (have) return S(200, brief(have));
          const pr = project(s.project) || project(b.project) || project('jarvis'); const t = Date.now();
          if (!pr) return S(400, {error:'Choose a tracked project for this continuation first.'});
          const sourceFolderAvailable = !!s.cwd && fs.existsSync(s.cwd) && ctx.isAllowed(s.cwd);
          const cwd = sourceFolderAvailable ? s.cwd : pr.path;
          if (!fs.existsSync(cwd) || !ctx.isAllowed(cwd)) return S(400,{error:'The destination project folder is unavailable.'});
          const history = await require('./session-history').messages(s);
          const id = 'v' + t.toString(36) + Math.random().toString(36).slice(2, 6);
          const historyDir = path.join(DIR,'history'); fs.mkdirSync(historyDir,{recursive:true});
          const historyPath = path.join(historyDir,id+'.md');
          fs.writeFileSync(historyPath, '# Imported conversation history\n\nSource: '+s.agent+' '+s.id+'\nCaptured: '+new Date(t).toISOString()+'\nVisible messages only; tool results and binary attachments remain in the original provider transcript.\n\n'+history.map(m=>'## '+(m.role==='user'?'@@NAME@@':'Assistant')+'\n\n'+m.text).join('\n\n'), {mode:0o600});
          const c = { id, project: pr.id, title: String(s.title || 'Earlier session').slice(0, 90), engine: s.agent, model: '', effort: '', edits: false, instructions: '', sessionId: null, cwd, sessions: {}, sourceSession: {id:s.id,agent:s.agent,capturedAt:t,cwd:s.cwd}, continuationMode:'imported-copy', historyPath, imported:true, messages:[{role:'note',text:'Continued in Jarvis from a saved copy of your '+s.agent+' conversation. The original thread stays unchanged, including any run still in progress. Earlier visible messages are below; attachments and tool results remain in the original app. New replies are saved here. The complete visible text is saved as a history file for the model to consult; it is not all inserted into every prompt.'+(sourceFolderAvailable?'':' The original folder is not available through Jarvis access settings, so this continuation works in '+pr.name+'. Add the original folder as a project if you need its files.'),ts:t},...history],createdAt:t,updatedAt:t };
          write(c); return S(200, brief(c));
        }
        const c = read(b.id); if (!c) return S(404, { error: 'Conversation not found' });
        if (p === '/api/convos/update') { if (live.has(c.id)||ctx.chatJournal?.isRunning(c.id)) return S(409, { error: 'Wait until this reply finishes before changing its model or access settings.' }); Object.assign(c, clean(b, c)); c.updatedAt = Date.now(); write(c); return S(200, brief(c)); }
        if (p === '/api/convos/delete') { if (live.has(c.id)||ctx.chatJournal?.isRunning(c.id)) return S(400, { error: 'Stop it first' }); try { fs.unlinkSync(file(c.id)); } catch {} try { fs.unlinkSync(file(c.id) + '.bak'); } catch {} return S(200, { ok: true }); }
        if (p === '/api/convos/stop') { const l = live.get(c.id); if (l && l.handle) l.handle.kill();else ctx.chatJournal?.stop(c.id); return S(200, { ok: true }); }
        if (p === '/api/convos/send') {
          if (live.has(c.id)||ctx.chatJournal?.isRunning(c.id)) return S(409, { error: 'It is still answering. Wait or press Stop.' });
          const prompt = String(b.prompt || ''); if (prompt.length > 12000) return S(400, { error: 'Message exceeds 12,000 characters. Please split it; nothing was sent or shortened.' }); if (!prompt.trim()) return S(400, { error: 'Write something first' });
          if (b.edits !== undefined) c.edits = !!b.edits;
          send(req, res, c, prompt); return true;
        }
      } catch (e) { return S(400, { error: String(e.message || e) }); }
      return false;
    },
  };
};
