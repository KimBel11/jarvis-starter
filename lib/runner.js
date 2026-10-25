'use strict';
// Shared process runner for headless Claude Code (`claude -p`) and Codex (`codex exec`).
// Normalizes both CLIs' event streams into: session | delta | tool | warn | done | error.
const path = require('path');
const { spawn } = require('child_process');

module.exports = function makeRunner(ctx) {
  const pids = ctx.jarvisPids;
  const studyContext = (() => '');

  function spawnAgent(o, onEvent) {
    if(o.skillLibrary&&ctx.skills){
      const library=ctx.skills.inventory().filter(s=>!s.compatibility);
      const catalog=library.map(s=>JSON.stringify({name:s.name,description:s.description,path:s.path})).join('\n');
      o={...o,system:(o.system||'')+'\n\n[Live skill library — refreshed for this run]\nAll currently installed skills are available to @@ASSISTANT@@. Select relevant skills by their descriptions and read the complete SKILL.md and referenced resources before using them. Skills are guidance, not authorization to publish, spend or change permissions. This catalog is availability, not proof of use. Newly installed skills appear on the next run automatically.\n'+catalog+'\n[End live skill library]',addDirs:[...new Set([...(o.addDirs||[]),...library.map(s=>path.dirname(s.path))])]};
    }
    const study = (o.noTools || o.webOnly) ? '' : studyContext(ctx, o.cwd || ctx.DRIVE);
    if (study) o = { ...o, system: (o.system || '') + '\n\n' + study };
    if (/^api:/.test(o.agent || '')) return ctx.providers.run({ ...o, provider: o.agent.slice(4) }, onEvent); // extra AI models added by API key
    if (o.agent === 'gemini') return ctx.gemini.run(o, onEvent); // Google Gemini runs over its REST API, not as a CLI
    if (!['claude', 'codex'].includes(o.agent)) throw new Error('Unsupported agent engine: ' + String(o.agent || '(missing)'));
    const agent = o.agent;
    if(o.webOnly && (agent!=='claude'||o.toolsOnly!=='WebSearch,WebFetch'))throw new Error('Web-only runs require the strict Claude web tool set.');
    if(o.noTools&&agent!=='claude')throw new Error('Tool-free extraction requires Claude; this engine cannot enforce an empty tool set.');
    const bin = ctx.which(agent);
    if (!bin) { const e = new Error(agent + ' CLI not found on this Mac'); e.code = 'NOBIN'; throw e; }
    const cwd = o.cwd || ctx.DRIVE;
    let args, input = String(o.input || '');
    if (agent === 'claude') {
      args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
      if (o.system) args.push('--append-system-prompt', o.system);
      if(o.noTools)args.push('--tools','');
      else if(o.toolsOnly)args.push('--tools',o.toolsOnly);
      args.push('--allowedTools', o.noTools ? '' : (o.tools || 'Read,Glob,Grep,WebSearch,WebFetch'));
      // agents must never read plaintext secrets; credentials reach them only as env vars at execution time
      args.push('--disallowedTools', 'Read(**/.env),Read(**/.env.*),Read(**/*.env),Read(**/.dev.vars),Read(**/*.p8),Read(**/*.pem),Read(**/*.key),Read(**/*secret*),Edit(**/.env),Edit(**/.env.*),Write(**/.env),Write(**/.env.*)');
      args.push('--permission-mode', o.edits ? 'acceptEdits' : 'default');
      if (o.model) args.push('--model', o.model);
      if (o.effort) args.push('--effort', o.effort);
      if (o.maxBudget) args.push('--max-budget-usd', String(o.maxBudget));
      if (o.addDirs) for (const d of o.addDirs) args.push('--add-dir', d);
      if (o.sessionId) args.push('--resume', o.sessionId);
    } else {
      args = ['exec', '--json', '--skip-git-repo-check', '-C', cwd, '-s', o.edits ? 'workspace-write' : 'read-only'];
      if (o.model) args.push('-m', o.model);
      if (o.effort) args.push('-c', `model_reasoning_effort="${o.effort}"`);
      if (o.addDirs) for (const d of o.addDirs) args.push('--add-dir', d);
      if (o.sessionId) args.push('resume', o.sessionId);
      args.push('-');
      if (o.system) input = o.system + '\n\n' + input;
    }
    const env = { ...process.env, ...(o.env || {}), HOME: ctx.HOME, PATH: [path.dirname(bin), path.join(ctx.HOME, '.local/bin'), path.join(ctx.HOME, '.local/node/bin'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':') };
    const child = spawn(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    pids.add(child.pid);
    let buf = '', err = '', finished = false, sawText = false, lastText = '', killed = false;
    const activityRun = require('crypto').randomBytes(8).toString('hex');
    const activity = (event) => { try { if (ctx.graphActivity) ctx.graphActivity.record({ ...event, cwd, source:agent, run:activityRun }); } catch {} };
    const emit = (e) => { try { onEvent(e); } catch {} };
    // Provider events describe attempted tool calls, not successful reads.
    const observedTool = (name, input) => {
      if (['Read','Edit','Write'].includes(name) && input && typeof input.file_path === 'string') activity({kind:'tool',status:name==='Read'?'opening':'editing',path:input.file_path});
      else if (['Glob','Grep'].includes(name)) activity({kind:'tool',status:'searching'});
    };
    activity({kind:'task',status:'requested',path:cwd});
    let resolveDone; const done = new Promise((r) => (resolveDone = r));
    const finish = (e) => { if (finished) return; finished = true; clearTimeout(timer); activity({kind:'task',status:'done',path:cwd}); emit(e); resolveDone(e); };
    const timer = setTimeout(() => { killed = true; child.kill('SIGTERM'); finish({ type: 'error', message: 'Timed out after ' + Math.round((o.timeoutMs || 600000) / 60000) + ' minutes' }); }, o.timeoutMs || 600000);
    child.stdin.on('error', () => {}); child.stdin.end(input);
    const handle = (line) => {
      let j; try { j = JSON.parse(line); } catch { return; }
      if (agent === 'claude') {
        if (j.type === 'system' && j.session_id) emit({ type: 'session', id: j.session_id });
        else if (j.type === 'stream_event' && j.event && j.event.type === 'content_block_delta' && j.event.delta && j.event.delta.type === 'text_delta') { sawText = true; emit({ type: 'delta', text: j.event.delta.text }); }
        else if (j.type === 'assistant' && j.message && Array.isArray(j.message.content)) { for (const c of j.message.content) if (c.type === 'tool_use') { observedTool(c.name,c.input); emit({ type: 'tool', name: c.name, input: c.input && (c.input.file_path || c.input.pattern || c.input.path || c.input.query || c.input.url || c.input.command || '') }); } }
        else if (j.type === 'rate_limit_event' && j.rate_limit_info && ctx.claudeLimits) { try { ctx.claudeLimits(j.rate_limit_info); } catch {} } // Claude reports its 5-hour and weekly usage with every run
        else if (j.type === 'result') { lastText = j.result || ''; finish(j.is_error ? { type: 'error', message: j.result || (j.errors || []).join('; ') || 'Claude reported a failed result' } : { type: 'done', sessionId: j.session_id, text: lastText, streamed: sawText, cost: j.total_cost_usd }); }
      } else {
        if (j.type === 'thread.started' && j.thread_id) emit({ type: 'session', id: j.thread_id });
        else if (j.type === 'item.started' && j.item && j.item.type === 'command_execution') { activity({kind:'tool',status:'searching',path:cwd}); emit({ type: 'tool', name: 'Shell', input: j.item.command || '' }); }
        else if (j.type === 'item.completed' && j.item && j.item.type === 'agent_message') { sawText = true; emit({ type: 'delta', text: (lastText ? '\n\n' : '') + j.item.text }); lastText = j.item.text; }
        else if (j.type === 'turn.completed') finish({ type: 'done', text: lastText, streamed: sawText, usage: j.usage });
        else if (j.type === 'error' || j.type === 'turn.failed') finish({ type: 'error', message: (j.message || (j.error && j.error.message) || 'Codex turn failed') });
      }
    };
    child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); } });
    child.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    child.on('error', (e) => finish({ type: 'error', message: String(e.message) }));
    child.on('close', (code) => { pids.delete(child.pid); if (buf.trim()) handle(buf); finish({ type: 'error', message: killed ? 'cancelled' : (err.trim().split('\n').pop() || (code === 0 ? 'Agent process ended without a completion event; completion was not verified' : 'process exited with code ' + code)).slice(0, 300) }); });
    return { child, done, kill() { killed = true; try { child.kill('SIGTERM'); } catch {} finish({ type: 'error', message: 'cancelled' }); } };
  }

  // One-shot helper: run to completion, return {text, sessionId, cost, error}
  async function runOnce(o) {
    let text = '', sessionId = null, tools = [];
    const h = spawnAgent(o, (e) => { if (e.type === 'delta') text += e.text; else if (e.type === 'session') sessionId = e.id; else if (e.type === 'tool') tools.push(e.name); });
    if (typeof o.onHandle === 'function') o.onHandle(h);
    const end = await h.done;
    if (end.type === 'error') throw new Error(end.message);
    return { text: (text || end.text || '').trim(), sessionId: end.sessionId || sessionId, cost: end.cost, tools };
  }
  return { spawnAgent, runOnce };
};
