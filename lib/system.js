'use strict';
// System check: verifies every moving part and explains how to fix what is broken. Plus "connectors" (platforms connected via Claude/Codex plugins).
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

module.exports = function makeSystem(ctx, deps) {
  const { vault, voice, runner, agents, listSkills, health } = deps;
  const HOME = ctx.HOME;
  const CONN_FILE = path.join(ctx.DATA, 'connectors.json');
  let connectors = { higgsfield: 'Claude connector', shopify: 'Claude connector (my project store)' };
  try { connectors = { ...connectors, ...JSON.parse(fs.readFileSync(CONN_FILE, 'utf8')) }; } catch {}
  const run = (cmd, args, t = 8000) => new Promise((res) => execFile(cmd, args, { timeout: t }, (e, so, se) => res({ ok: !e, out: String(so || '').trim(), err: String(se || e && e.message || '').trim() })));
  const row = (group, id, label, status, detail, fix) => ({ group, id, label, status, detail: detail || '', fix: fix || '' });
  const ex = (p) => fs.existsSync(p);

  function checkSkills(dir, who) {
    const out = { n: 0, bad: [] };
    try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { if (!(e.isDirectory() || e.isSymbolicLink()) || e.name.startsWith('.')) continue; const f = path.join(dir, e.name, 'SKILL.md'); if (!ex(f)) continue; out.n++; const t = fs.readFileSync(f, 'utf8'); const m = t.match(/^---\n([\s\S]*?)\n---/); if (!m || !/description:/.test(m[1])) out.bad.push(e.name + ' (missing description)'); } } catch {}
    return out;
  }

  async function quick() {
    const R = [];
    // --- system
    R.push(row('System', 'drive', 'workspace folder', ex(ctx.DRIVE) ? 'ok' : 'fail', ctx.DRIVE, 'Plug in the drive and reopen Jarvis.'));
    R.push(row('System', 'node', 'Node.js', 'ok', process.version));
    for (const b of ['ffmpeg', 'ffprobe']) { const p = ctx.which(b) || (ex('/opt/homebrew/bin/' + b) ? '/opt/homebrew/bin/' + b : null); R.push(row('System', b, b, p ? 'ok' : 'warn', p || 'not found', 'Video editing and Video Intel need it: brew install ffmpeg')); }
    const lc = await run('launchctl', ['print', `gui/${os.userInfo().uid}/com.jarvis.local`]); R.push(row('System', 'launchd', 'Auto-start at login', lc.ok ? 'ok' : 'warn', lc.ok ? 'LaunchAgent loaded' : 'not loaded', 'Run: launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jarvis.local.plist'));
    // --- claude
    const cb = ctx.which('claude'); const cv = cb ? await run(cb, ['--version']) : null;
    R.push(row('Claude Code', 'cli', 'Claude Code CLI', cb ? 'ok' : 'fail', cb ? `${cb} · ${cv && cv.out}` : 'not found', 'Install Claude Code, then restart Jarvis.'));
    R.push(row('Claude Code', 'data', 'Session history', ex(path.join(HOME, '.claude', 'projects')) ? 'ok' : 'warn', '~/.claude/projects'));
    const cs = checkSkills(path.join(HOME, '.claude', 'skills'), 'claude'); R.push(row('Claude Code', 'skills', 'Skills', cs.bad.length ? 'warn' : 'ok', `${cs.n} valid${cs.bad.length ? ' · problems: ' + cs.bad.join(', ') : ''}`, 'Each skill folder needs a SKILL.md with name and description.'));
    try { const ip = JSON.parse(fs.readFileSync(path.join(HOME, '.claude', 'plugins', 'installed_plugins.json'), 'utf8')).plugins || {}; const bad = Object.entries(ip).filter(([, v]) => !ex(v[0].installPath)).map(([k]) => k); R.push(row('Claude Code', 'plugins', 'Plugins', bad.length ? 'fail' : 'ok', `${Object.keys(ip).length} installed${bad.length ? ' · missing files: ' + bad.join(', ') : ''}`, 'Reinstall the broken plugin from Claude Code (/plugin).')); } catch { R.push(row('Claude Code', 'plugins', 'Plugins', 'warn', 'could not read installed_plugins.json')); }
    try { const names = Object.keys(JSON.parse(fs.readFileSync(path.join(HOME, '.claude.json'), 'utf8')).mcpServers || {}); R.push(row('Claude Code', 'mcp', 'MCP servers (local)', 'ok', names.length ? names.join(', ') : 'none configured here (account connectors like Shopify, Higgsfield, Gmail work inside Claude chats)')); } catch { R.push(row('Claude Code', 'mcp', 'MCP servers (local)', 'ok', 'none configured here')); }
    // --- codex
    const xb = ctx.which('codex'); const xv = xb ? await run(xb, ['--version']) : null;
    R.push(row('Codex', 'cli', 'Codex CLI', xb ? 'ok' : 'fail', xb ? `${xb} · ${xv && xv.out}` : 'not found', 'Install the ChatGPT desktop app (it bundles Codex).'));
    R.push(row('Codex', 'data', 'Session history', ex(path.join(HOME, '.codex', 'sessions')) ? 'ok' : 'warn', '~/.codex/sessions'));
    const xs = checkSkills(path.join(HOME, '.codex', 'skills'), 'codex'); R.push(row('Codex', 'skills', 'Skills', xs.bad.length ? 'warn' : 'ok', `${xs.n} valid${xs.bad.length ? ' · problems: ' + xs.bad.join(', ') : ''}`));
    try { const cfg = fs.readFileSync(path.join(HOME, '.codex', 'config.toml'), 'utf8'); const en = [...cfg.matchAll(/\[plugins\."([^"]+)"\]\s*\nenabled\s*=\s*true/g)].length; R.push(row('Codex', 'plugins', 'Plugins', 'ok', `${en} enabled`)); } catch { R.push(row('Codex', 'plugins', 'Plugins', 'warn', 'config.toml not readable')); }
    R.push(row('Codex', 'agents', 'Jarvis handshake file', ex(path.join(HOME, '.codex', 'AGENTS.md')) ? 'ok' : 'warn', '~/.codex/AGENTS.md', 'Lets Codex register projects with Jarvis ("add this to Jarvis").'));
    if (ctx.gemini) R.push(row('Studys', 'gemini', 'Google Gemini', ctx.gemini.key() ? 'ok' : 'warn', ctx.gemini.key() ? 'key found in the vault' : 'no key yet', 'Get a key at aistudio.google.com/apikey and add it in Vault & keys (or on Studys → Study setup).'));
    // --- blender
    if (ctx.blender) {
      const bs = await ctx.blender.status();
      R.push(row('Blender', 'app', 'Blender app', bs.installed ? 'ok' : 'fail', bs.installed ? `${bs.version} · ${bs.bin}` : 'not installed', 'Install Blender from blender.org into /Applications.'));
      R.push(row('Blender', 'skill', 'Blender skill', bs.skills.claude && bs.skills.codex ? 'ok' : 'warn', `Claude: ${bs.skills.claude ? 'installed' : 'missing'} · Codex: ${bs.skills.codex ? 'installed' : 'missing'}`, 'Copy Jarvis/tools/blender skill to ~/.claude/skills/blender-3d and ~/.codex/skills/blender-3d.'));
      R.push(row('Blender', 'scripts', 'Helper scripts', bs.scripts.length >= 3 ? 'ok' : 'warn', bs.scripts.join(', ') || 'none'));
    }
    // --- browsers
    const chromeRoot = path.join(HOME, 'Library', 'Application Support', 'Google', 'Chrome'); const found = [];
    try {
      for (const prof of fs.readdirSync(chromeRoot).filter((d) => d === 'Default' || /^Profile \d+$/.test(d))) {
        const extDir = path.join(chromeRoot, prof, 'Extensions'); if (!ex(extDir)) continue;
        for (const id of fs.readdirSync(extDir)) { try { const ver = fs.readdirSync(path.join(extDir, id)).sort().pop(); const mdir = path.join(extDir, id, ver); const m = JSON.parse(fs.readFileSync(path.join(mdir, 'manifest.json'), 'utf8')); let name = m.name || ''; const k = name.match(/^__MSG_(.+)__$/); if (k) { try { const msgs = JSON.parse(fs.readFileSync(path.join(mdir, '_locales', m.default_locale || 'en', 'messages.json'), 'utf8')); const key = Object.keys(msgs).find((x) => x.toLowerCase() === k[1].toLowerCase()); name = key ? msgs[key].message : name; } catch {} } if (/claude/i.test(name)) found.push(`${name} ${m.version} (${prof})`); } catch {} }
      }
    } catch {}
    R.push(row('Browsers', 'chrome', 'Claude in Chrome (extension)', found.length ? 'ok' : 'warn', found.length ? found.join(', ') : 'Claude extension not detected in your Chrome profiles', 'Install "Claude" from the Chrome Web Store, sign in, then run /chrome in Claude Code.'));
    R.push(row('Browsers', 'builtin', 'Built-in browser (Claude desktop app)', ex('/Applications/Claude.app') ? 'ok' : 'warn', ex('/Applications/Claude.app') ? 'part of the Claude app' : 'Claude.app not found'));
    const codexHost = ex(path.join(HOME, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts', 'com.openai.codexextension.json')); R.push(row('Browsers', 'codexchrome', 'Codex browser bridge', codexHost && ex(path.join(HOME, '.codex', 'chrome-native-hosts-v2.json')) ? 'ok' : 'warn', codexHost ? 'native host registered in Chrome' : 'native host not registered', 'Enable the Codex browser plugin in the Codex app.'));
    R.push(row('Browsers', 'chromeapp', 'Google Chrome', ex('/Applications/Google Chrome.app') ? 'ok' : 'warn', ex('/Applications/Google Chrome.app') ? 'installed' : 'not installed', 'Needed for voice input in the browser fallback and Claude in Chrome.'));
    // --- jarvis
    const vs = vault.status(); R.push(row('Jarvis', 'vault', 'Encrypted vault', vs.ok ? 'ok' : 'fail', vs.ok ? `${vs.count} items · ${vs.alg} · key in ${vs.store}` : vs.error, 'If the Keychain item was deleted, the vault cannot be opened.'));
    const vst = voice.status(); R.push(row('Jarvis', 'voice', 'ElevenLabs voice', vst.configured ? 'ok' : 'warn', vst.configured ? `model ${vst.model} · en: ${(vst.voices.en || {}).name || '—'}` : 'no key in vault', 'Vault & keys → Scan & import → then Voice studio.'));
    const h = health(); R.push(row('Jarvis', 'index', 'Usage index', h.index.ready ? 'ok' : 'warn', `${h.index.files.claude} Claude + ${h.index.files.codex} Codex sessions${h.index.error ? ' · ' + h.index.error : ''}`));
    for (const a of agents.roster()) {
      const pr = a.project ? ctx.state.projects.find((p) => p.id === a.project) : null; const cwd = a.cwdRel && pr ? path.join(pr.path, a.cwdRel) : pr ? pr.path : ctx.DRIVE;
      if(a.enabled===false && a.mergedInto && agents.roster().some(other=>other.id===a.mergedInto && other.enabled!==false)){ R.push({...row('Agents','agent-'+a.id,`${a.glyph} ${a.name}`,'unknown','Delegated to '+a.mergedInto,'Manage the replacement on the Agent team page.'),expectedDisabled:true}); continue; }
      const problems = []; if (a.project && !pr) problems.push('project missing'); if (!ex(cwd)) problems.push('folder missing: ' + cwd); const engines = a.engine === 'both' ? ['claude', 'codex'] : [a.engine]; for (const engine of engines) { if (['claude','codex'].includes(engine) && !ctx.which(engine)) problems.push(engine + ' CLI missing'); else if (engine === 'gemini' && !(ctx.gemini && ctx.gemini.key())) problems.push('Gemini key not configured'); else if (/^api:/.test(engine) && !(ctx.providers && ctx.providers.list().some(p => p.id === engine.slice(4) && p.hasKey))) problems.push('API provider key not configured'); } if (a.enabled === false) problems.push('switched off');
      const noKeys = (a.services || []).filter((s) => !vault.hasService(s)); const st = problems.length ? (problems[0] === 'switched off' ? 'warn' : 'fail') : 'ok';
      R.push(row('Agents', 'agent-' + a.id, `${a.glyph} ${a.name}`, st, problems.length ? problems.join(' · ') : `${a.engine} · ${a.approval ? 'plan-then-approve' : 'direct'}${noKeys.length ? ' · no key yet for ' + noKeys.join(', ') : ''}`, 'Fix the folder/CLI, or edit the agent on the Agent team page.'));
    }
    // --- platforms / websites
    for (const p of ctx.state.projects) for (const s of ((p.workspace && p.workspace.websites) || [])) if (s.kind === 'shopify') R.push(row('Platforms', 'shopify-' + s.id, `Shopify · ${s.name}`, 'unknown', s.connection === 'claude-connector' ? `${s.store} · connected through the Claude Shopify connector` : `${s.store} · uses the Shopify CLI login (cannot be checked automatically)`, 'If a push says "no access": npx @shopify/cli@latest auth logout, then log in with the store owner account yourself.'));
    return R;
  }

  async function live(target) {
    const t0 = Date.now();
    try {
      if (target === 'claude' || target === 'codex') { const r = await runner.runOnce({ agent: target, cwd: ctx.DRIVE, input: 'Reply with exactly the single word: OK', system: 'You are a connectivity test. Do not use tools.', tools: 'Read', timeoutMs: 120000 }); return { ok: /ok/i.test(r.text), detail: `answered "${r.text.slice(0, 40)}" in ${((Date.now() - t0) / 1000).toFixed(1)}s${r.cost ? ' · ' + Math.round(r.cost * 100) / 100 + ' USD' : ''}` }; }
      if (target === 'voice') { const v = await voice.listVoices(true); return { ok: v.length > 0, detail: `${v.length} voices available in ${((Date.now() - t0) / 1000).toFixed(1)}s` }; }
    } catch (e) { return { ok: false, detail: String(e.message || e).slice(0, 300) }; }
    return { ok: false, detail: 'unknown target' };
  }

  return {
    check: quick,
    connectors: () => connectors,
    async handle(req, res, url, p) {
      const S = (c, b) => (ctx.send(res, c, b), true);
      try {
        if (p === '/api/selftest') { const rows = await quick(); const c = { ok: 0, warn: 0, fail: 0 }; for (const r of rows) c[r.status]++; return S(200, { rows, counts: c, at: Date.now() }); }
        if (p === '/api/selftest/live' && req.method === 'POST') { const b = await ctx.readBody(req); return S(200, await live(b.target)); }
        if (p === '/api/connectors' && req.method === 'GET') return S(200, { connectors });
        if (p === '/api/connectors' && req.method === 'POST') { const b = await ctx.readBody(req); const id = String(b.service || '').replace(/[^a-z0-9-]/g, '').slice(0, 30); if (!id) return S(400, { error: 'service required' }); if (b.via) connectors[id] = String(b.via).slice(0, 80); else delete connectors[id]; fs.writeFileSync(CONN_FILE, JSON.stringify(connectors, null, 2)); return S(200, { connectors }); }
      } catch (e) { return S(500, { error: String(e.message || e) }); }
      return false;
    },
  };
};
