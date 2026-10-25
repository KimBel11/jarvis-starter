'use strict';
// AI council: several models answer a question in parallel (different roles), one randomly chosen model writes a one-page brief
// plus a short audio summary. Read-only. It informs the decision; it never makes it. Runs only after an explicit confirmation (it costs money/quota).
const fs = require('fs');
const path = require('path');

const ROLE_DEFS = [
  { id: 'research', name: 'Research', brief: 'Gather the relevant facts and current information. Separate what is known from what is assumed. Cite where each fact comes from when you can.', prefer: 'gemini', web: true },
  { id: 'strategy', name: 'Strategy', brief: 'Lay out the realistic options with their trade-offs and say which way you lean and why.', prefer: 'claude', model: 'claude-opus-5-5', effort: 'high' },
  { id: 'builder', name: 'Builder', brief: 'Explain what it would take in practice: concrete steps, effort, dependencies and what could go wrong when doing it.', prefer: 'codex', model: 'gpt-6.1-sol', effort: 'high' },
  { id: 'skeptic', name: 'Skeptic', brief: 'Challenge the idea. Which assumptions are weak, what is the strongest argument against, and what would make this a mistake?', prefer: 'claude', model: 'claude-haiku-5-5', effort: 'low' },
];
const COST = { 'claude-fable-5-1': [0.5, 1.5], 'claude-opus-5-5': [0.2, 0.6], 'claude-sonnet-5-5': [0.05, 0.2], 'claude-haiku-5-5': [0.005, 0.03], claude: [0.05, 0.3] };

module.exports = function makeCouncil(ctx, deps) {
  const DIR = path.join(ctx.DATA, 'council'); fs.mkdirSync(DIR, { recursive: true });
  const read = (id) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, id + '.json'), 'utf8')); } catch { return null; } };
  const write = (c) => { try { fs.writeFileSync(path.join(DIR, c.id + '.json'), JSON.stringify(c, null, 2)); } catch {} };
  const have = (e) => (e === 'gemini' ? !!ctx.gemini.key() : !!ctx.which(e));

  function plan(roleIds) {
    return ROLE_DEFS.filter((r) => !roleIds || roleIds.includes(r.id)).map((r) => {
      let engine = r.prefer, model = r.model || '', effort = r.effort || '';
      if (!have(engine)) { engine = have('claude') ? 'claude' : have('codex') ? 'codex' : null; model = engine === 'claude' ? 'claude-sonnet-5-5' : ''; effort = 'medium'; }
      return engine ? { id: r.id, name: r.name, engine, model, effort, web: r.web && engine !== 'codex', brief: r.brief } : null;
    }).filter(Boolean);
  }
  function estimate(roles) {
    let lo = 0, hi = 0, codex = 0, gem = 0; for (const r of roles) { if (r.engine === 'claude') { const c = COST[r.model] || COST.claude; lo += c[0]; hi += c[1]; } else if (r.engine === 'codex') codex++; else gem++; }
    lo += 0.05; hi += 0.3; // the chair
    return { calls: roles.length + 1, claudeUsd: [+lo.toFixed(2), +hi.toFixed(2)], codexCalls: codex, geminiCalls: gem + 0, text: `${roles.length + 1} calls: about $${lo.toFixed(2)}–$${hi.toFixed(2)} on Claude${codex ? `, plus ${codex} Codex call${codex > 1 ? 's' : ''} (uses your Codex allowance)` : ''}${gem ? `, plus ${gem} Gemini call${gem > 1 ? 's' : ''} (your Gemini key)` : ''}.` };
  }
  async function ask(role, ctxText, question) {
    const system = `You are the "${role.name}" member of an advisory council helping @@NAME@@ decide. ${role.brief} Answer in at most 250 words, concrete and plain. Do NOT make the decision for @@NAME@@. If you lack information, say exactly what is missing.`;
    const input = `${ctxText ? 'CONTEXT:\n' + ctxText + '\n\n' : ''}QUESTION:\n${question}`;
    const r = await deps.runner.runOnce({ agent: role.engine, model: role.model, effort: role.effort, maxBudget: role.engine === 'claude' ? 1 : 0, cwd: ctx.DRIVE, input, system, tools: role.engine === 'claude' ? (role.web ? 'WebSearch,WebFetch,Read' : 'Read') : 'Read', search: !!role.web, timeoutMs: 300000 });
    return { text: r.text, cost: r.cost || 0 };
  }
  async function run(c) {
    try {
      const results = await Promise.all(c.roles.map(async (role) => { const rr = c.results.find((x) => x.id === role.id); try { const a = await ask(role, c.context, c.question); rr.text = a.text; rr.cost = a.cost; rr.status = 'done'; } catch (e) { rr.status = 'failed'; rr.error = String(e.message || e).slice(0, 200); } write(c); return rr; }));
      const ok = results.filter((r) => r.status === 'done'); if (!ok.length) throw new Error('No council member could answer. Check Claude, Codex and Gemini on the System check page.');
      const chair = ok[Math.floor(Math.random() * ok.length)]; const role = c.roles.find((r) => r.id === chair.id); c.chair = { id: chair.id, engine: role.engine, model: role.model }; write(c);
      const input = `QUESTION FOR THE COUNCIL:\n${c.question}\n\n${c.context ? 'CONTEXT:\n' + c.context + '\n\n' : ''}THE COUNCIL'S ANSWERS:\n${ok.map((r) => `### ${r.name} (${r.engine})\n${r.text}`).join('\n\n')}\n\nWrite @@NAME@@’s briefing. Reply with ONLY a JSON object: {"brief":"one page of markdown with sections: The question, Where the council agrees, Where it disagrees, The options (each with trade-offs), Main risks, What to check next","audio":"60 to 110 words of natural spoken language for @@NAME@@ to LISTEN to: the single most important point first, then the main options and the main risk, ending with one question to help her decide. No lists, no markdown, no symbols.","options":["short option 1","short option 2"]}. Do not make the decision. Present options.`;
      const r = await deps.runner.runOnce({ agent: role.engine, model: role.model, effort: role.effort, maxBudget: role.engine === 'claude' ? 1 : 0, cwd: ctx.DRIVE, input, system: 'You write clear, balanced one-page decision briefs. Never decide for the reader.', tools: 'Read', timeoutMs: 300000 });
      const m = r.text.match(/\{[\s\S]*\}/); let j = {}; try { j = JSON.parse(m ? m[0] : '{}'); } catch {}
      c.brief = j.brief || r.text; c.audio = j.audio || (j.brief || r.text).replace(/[#*_`>-]/g, '').slice(0, 600); c.options = Array.isArray(j.options) ? j.options.slice(0, 6) : []; c.cost = [...results, { cost: r.cost || 0 }].reduce((s, x) => s + (x.cost || 0), 0); c.status = 'done'; c.finishedAt = Date.now();
    } catch (e) { c.status = 'failed'; c.error = String(e.message || e).slice(0, 300); c.finishedAt = Date.now(); }
    write(c);
    ctx.notifications?.publish({id:'council:'+c.id+':'+c.status,title:c.status==='done'?'Council briefing ready':'Council needs attention',body:c.question,kind:'council',severity:c.status==='done'?'info':'warning',href:'#/council'});
  }
  return {
    ROLE_DEFS, plan, estimate,
    async handle(req, res, url, p) {
      const S = (c, b) => (ctx.send(res, c, b), true); if (!p.startsWith('/api/council')) return false;
      try {
        if (p === '/api/council/list') { let ids = []; try { ids = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')); } catch {} return S(200, { councils: ids.map((f) => read(f.replace('.json', ''))).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt).slice(0, 60).map((c) => ({ id: c.id, root: c.root || null, parent: c.parent || null, question: c.question, status: c.status, createdAt: c.createdAt, options: c.options || [], cost: c.cost })) }); }
        if (p === '/api/council/roles') return S(200, { roles: plan().map(({ brief, ...r }) => ({ ...r, brief })) });
        if (p === '/api/council') { const c = read(String(url.searchParams.get('id') || '').replace(/[^a-z0-9]/g, '')); return c ? S(200, c) : S(404, { error: 'not found' }); }
        const b = req.method === 'POST' ? await ctx.readBody(req) : {};
        if (p === '/api/council/delete' && req.method === 'POST') { const id = String(b.id || '').replace(/[^a-z0-9]/g, ''); try { fs.unlinkSync(path.join(DIR, id + '.json')); } catch {} return S(200, { ok: true }); }
        const question = String(b.question || '').trim().slice(0, 4000); if (!question) return S(400, { error: 'Write the question first' });
        let context = String(b.context || '').slice(0, 20000);
        const parent = b.parent ? read(String(b.parent).replace(/[^a-z0-9]/g, '')) : null;
        if (parent) context = `This is a follow-up. Earlier in this council:\nQUESTION: ${parent.question}\nBRIEF: ${String(parent.brief || '').slice(0, 6000)}\n\n` + context;
        if (b.contextPath) { const f = path.resolve(String(b.contextPath)); if (!ctx.isAllowed(f) || !fs.existsSync(f) || fs.statSync(f).size > 200000) return S(400, { error: 'Context file not allowed or too large' }); context += '\n\n' + fs.readFileSync(f, 'utf8').slice(0, 40000); }
        const roles = plan(Array.isArray(b.roles) && b.roles.length ? b.roles : null); if (!roles.length) return S(400, { error: 'No AI is available. Check the System check page.' });
        if (p === '/api/council/estimate' && req.method === 'POST') return S(200, { roles, ...estimate(roles) });
        if (p === '/api/council/run' && req.method === 'POST') {
          if (!b.confirm) return S(400, { error: 'Please confirm the cost first.' });
          const c = { id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), parent: parent ? parent.id : null, root: parent ? (parent.root || parent.id) : null, question, context: context.trim(), createdAt: Date.now(), status: 'running', roles, results: roles.map((r) => ({ id: r.id, name: r.name, engine: r.engine, model: r.model, status: 'running' })), estimate: estimate(roles) };
          write(c); run(c); return S(200, { id: c.id });
        }
      } catch (e) { return S(400, { error: String(e.message || e) }); }
      return false;
    },
  };
};
