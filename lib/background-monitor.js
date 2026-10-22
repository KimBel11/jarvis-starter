'use strict';
// Read-only background checks. No model generation, service startup or code upgrades.
const fs = require('fs');
const path = require('path');
const net = require('net');

module.exports = function makeBackgroundMonitor(ctx, deps = {}) {
  const file = path.join(ctx.DATA, 'background-monitor.json');
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  let settings = { enabled: true, intervalMinutes: 10, ...(saved.settings || {}) };
  settings.enabled = settings.enabled !== false;
  settings.intervalMinutes = Math.min(120, Math.max(2, Number(settings.intervalMinutes) || 10));
  let services = Array.isArray(saved.services) ? saved.services : [];
  let history = Array.isArray(saved.history) ? saved.history.slice(-100) : [];
  let lastCheckedAt = saved.lastCheckedAt || null;
  let lastError = saved.lastError || null;
  let failures = 0, running = false, timer = null, nextCheckAt = null, stopped = false;
  const now = () => deps.now ? deps.now() : Date.now();
  const counts = () => services.reduce((a, s) => { a[s.status] = (a[s.status] || 0) + 1; return a; }, { ok: 0, warn: 0, fail: 0, unknown: 0 });
  function persist() {
    fs.mkdirSync(ctx.DATA, { recursive: true });
    const temp = file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify({ version: 1, settings, services, history, lastCheckedAt, lastError }), { mode: 0o600 });
    fs.renameSync(temp, file);
  }
  function status() {
    let social = null;
    try { social = deps.social && deps.social.autoState ? deps.social.autoState() : null; } catch {}
    return { settings: { ...settings }, running, lastCheckedAt, nextCheckAt, counts: counts(), services, history: history.slice(-30), social, lastError, stale: !!lastError || !!(lastCheckedAt && now() - lastCheckedAt > settings.intervalMinutes * 120000), policy: 'Read-only checks; no paid model tests, automatic server launches, software upgrades or page reloads.' };
  }
  function schedule(delay) {
    if (timer) clearTimeout(timer);
    timer = null; nextCheckAt = null;
    if (!settings.enabled || stopped) return;
    nextCheckAt = now() + delay;
    timer = setTimeout(() => { timer = null; run().catch(() => {}); }, delay);
    if (timer.unref) timer.unref();
  }
  function configuredServers() {
    if (deps.configuredServers) return deps.configuredServers();
    const out = [];
    try {
      const data = JSON.parse(fs.readFileSync(path.join(ctx.HOME, '.claude.json'), 'utf8'));
      for (const [name, server] of Object.entries(data.mcpServers || {})) out.push({ provider: 'Claude', name, url: server.url || null, transport: server.type || (server.command ? 'stdio' : 'unknown') });
    } catch {}
    try {
      const config = fs.readFileSync(path.join(ctx.HOME, '.codex', 'config.toml'), 'utf8');
      const pattern = /^\[mcp_servers\.([^\]\n]+)\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/gm;
      for (const m of config.matchAll(pattern)) {
        const url = m[2].match(/^url\s*=\s*["']([^"']+)["']/m);
        out.push({ provider: 'Codex', name: m[1].replace(/^["']|["']$/g, ''), url: url ? url[1] : null, transport: url ? 'http' : 'stdio', disabled: /^enabled\s*=\s*false\s*$/m.test(m[2]) });
      }
    } catch {}
    return out.slice(0, 80);
  }
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  const probe = deps.probe || ((host, port) => new Promise((resolve) => {
    const socket = net.createConnection({ host, port }); let done = false;
    const finish = (ok) => { if (done) return; done = true; socket.destroy(); resolve(ok); };
    socket.setTimeout(1800, () => finish(false)); socket.on('connect', () => finish(true)); socket.on('error', () => finish(false));
  }));
  async function checkServers() {
    const results = [];
    // Bound concurrency and never execute a configured command or use credentials.
    const configs = configuredServers();
    for (let i = 0; i < configs.length; i += 4) {
      const batch = await Promise.all(configs.slice(i, i + 4).map(async (server) => {
        const base = { group: 'MCP connections', id: 'mcp-' + server.provider + '-' + server.name, label: server.provider + ' · ' + server.name };
        if (server.disabled) return { ...base, status: 'unknown', detail: 'Disabled in its configuration.', fix: 'Enable this connection in its provider when needed.' };
        if (!server.url) return { ...base, status: 'unknown', detail: 'On-demand stdio connection; checked by its AI client when used.', fix: 'Open the provider connection settings if a task reports a connection error.' };
        let url;
        try { url = new URL(server.url); } catch { return { ...base, status: 'warn', detail: 'Connection URL is invalid.', fix: 'Correct the server URL in the provider configuration.' }; }
        if (!['http:', 'https:'].includes(url.protocol) || !localHosts.has(url.hostname)) return { ...base, status: 'unknown', detail: 'Remote connection; authentication is verified by its provider when used.', fix: 'Use the provider connection settings to reconnect if requested.' };
        const host = url.hostname.replace(/^\[|\]$/g, ''); const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
        let up = false; try { up = await probe(host, port); } catch {}
        return { ...base, status: up ? 'ok' : 'fail', detail: up ? 'Local server accepts connections on port ' + port + '; authentication and tools are checked when used.' : 'Local server is not accepting connections on port ' + port + '.', fix: up ? '' : 'Open the app or start this configured server, then check again.', needsStart: !up };
      }));
      results.push(...batch);
    }
    return results;
  }
  async function run() {
    if (running) return status();
    if (timer) clearTimeout(timer); timer = null; nextCheckAt = null; running = true;
    try {
      const rows = typeof deps.check === 'function' ? await deps.check() : [];
      if (!Array.isArray(rows)) throw new Error('The health checker returned an invalid result.');
      const mcp = await checkServers(); const at = now();
      // Existing legacy agent checks do not understand Both/API engines. Their actual
      // execution adapters validate those engines; avoid falsely calling a CLI missing.
      services = [...rows.map((row) => {
        if (row.group === 'Agents' && /\b(?:both|gemini|api|openai-compatible) CLI missing\b/i.test(row.detail || '')) return { ...row, status: 'unknown', detail: 'Model routing uses its configured execution adapter.', fix: 'Check the agent provider and access settings.' };
        return row;
      }), ...mcp].map((row) => ({ ...row, checkedAt: at }));
      for (const service of services) ctx.notifications?.condition('connection:'+(service.id||service.group+':'+service.label),service.status==='fail',{title:'Connection needs attention',body:service.label||service.id||'A Jarvis connection is unavailable',kind:'connection',severity:'error',href:'#/settings'});
      lastCheckedAt = at; lastError = null; failures = 0;
      history.push({ at, counts: counts() }); history = history.slice(-100); persist();
    } catch (e) {
      failures++; lastError = { at: now(), message: 'Background check could not finish. Last successful results have been retained.' };
      try { persist(); } catch {}
    } finally {
      running = false;
      schedule(Math.min(120 * 60000, settings.intervalMinutes * 60000 * Math.pow(2, Math.min(failures, 3))));
    }
    return status();
  }
  function update(input) {
    if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw Object.assign(new Error('enabled must be true or false'), { status: 400 });
    if (input.intervalMinutes !== undefined && (!Number.isFinite(input.intervalMinutes) || input.intervalMinutes < 2 || input.intervalMinutes > 120)) throw Object.assign(new Error('intervalMinutes must be between 2 and 120'), { status: 400 });
    settings = { enabled: input.enabled === undefined ? settings.enabled : input.enabled, intervalMinutes: input.intervalMinutes === undefined ? settings.intervalMinutes : input.intervalMinutes };
    persist(); if (!running) schedule(settings.intervalMinutes * 60000); return status();
  }
  if (deps.autoStart !== false) schedule(12000);
  return {
    status, run, update,
    stop() { stopped = true; if (timer) clearTimeout(timer); timer = null; nextCheckAt = null; },
    async handle(req, res, url, route) {
      if (!route.startsWith('/api/background/')) return false;
      const send = (code, body) => (ctx.send(res, code, body), true);
      try {
        if (route === '/api/background/status' && req.method === 'GET') return send(200, status());
        if (route === '/api/background/settings' && req.method === 'POST') return send(200, update(await ctx.readBody(req)));
        if (route === '/api/background/run' && req.method === 'POST') { void run(); return send(202, status()); }
        return send(404, { error: 'Unknown background monitor action' });
      } catch (e) { return send(e.status || 500, { error: e.status ? e.message : 'Background monitor could not save its settings.' }); }
    },
  };
};
