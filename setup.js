#!/usr/bin/env node
'use strict';
// Jarvis first-time setup. Asks three questions, personalises the app, checks your AI tools, and starts Jarvis.
//   node setup.js            (or just double-click start.command the first time)
// Options: --name "Sam" --assistant "Nova" --yes   (skip the questions)
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { execFileSync, spawn } = require('child_process');

const ROOT = __dirname;
const WORKSPACE = path.dirname(ROOT);
const arg = (n) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : null; };
const yes = process.argv.includes('--yes'), noAuto = process.argv.includes('--no-autostart'), noStart = process.argv.includes('--no-start');
const TEXT = /\.(js|css|html|md|json|swift|plist|pbxproj|sh|command|py|webmanifest|entitlements|txt|yml|yaml|strings|svg)$/i;
const SKIP = new Set(['node_modules', 'data', '.git', 'build', 'DerivedData']);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q, d) => new Promise((res) => { if (yes) return res(d); rl.question(`${q}${d ? ` [${d}]` : ''}: `, (a) => res((a || '').trim() || d)); });
const has = (cmd) => { try { return execFileSync('/bin/sh', ['-lc', `command -v ${cmd}`], { env: { ...process.env, PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin:${os.homedir()}/.local/bin:${os.homedir()}/.local/node/bin` } }).toString().trim(); } catch { return ''; } };

function walk(d, fn) { for (const n of fs.readdirSync(d)) { if (SKIP.has(n)) continue; const p = path.join(d, n); const st = fs.statSync(p); if (st.isDirectory()) walk(p, fn); else fn(p); } }

(async () => {
  console.log('\n  ✦  Jarvis setup  ✦\n');
  if (Number(process.versions.node.split('.')[0]) < 18) { console.log('Jarvis needs Node.js 18 or newer. Install the LTS version from https://nodejs.org and run this again.'); process.exit(1); }
  const tokensLeft = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8').includes('@@') || fs.readdirSync(path.join(ROOT, 'public')).some((f) => f.endsWith('.js') && fs.readFileSync(path.join(ROOT, 'public', f), 'utf8').includes('@@NAME@@'));
  if (tokensLeft) {
    const clean = (v, d) => { const c = String(v || '').replace(/[^\p{L}\p{N} .-]/gu, '').trim().slice(0, 30); return c || d; };
    const name = clean(arg('name') || await ask('What should Jarvis call you? (your first name)', os.userInfo().username.replace(/^\w/, (c) => c.toUpperCase())), 'Friend');
    const assistant = clean(arg('assistant') || await ask('What do you want to call your main assistant?', 'Jarvis'), 'Jarvis');
    const map = { '@@NAME@@': name, '@@ASSISTANT@@': assistant, '@@WORKSPACE@@': WORKSPACE, '@@HOME@@': os.homedir() };
    let n = 0;
    walk(ROOT, (p) => { if (!TEXT.test(p) || p === __filename) return; let s; try { s = fs.readFileSync(p, 'utf8'); } catch { return; } if (!s.includes('@@')) return; for (const [k, v] of Object.entries(map)) s = s.split(k).join(v); fs.writeFileSync(p, s); n++; });
    console.log(`\n✓ Personalised ${n} files for ${name} (assistant: ${assistant}).`);
  }
  fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true }); fs.writeFileSync(path.join(ROOT, 'data', '.setup-done'), new Date().toISOString());
  for (const d of ['My First Project']) { const p = path.join(WORKSPACE, `${d}`.replace(/ Project$/, '') + ' Project'); if (!fs.existsSync(p) && !fs.readdirSync(WORKSPACE).some((x) => / Project$/.test(x))) { fs.mkdirSync(p); fs.writeFileSync(path.join(p, 'CLAUDE.md'), '# My First Project\n\nDescribe what this project is, who it is for and the rules your agents must follow.\n'); fs.writeFileSync(path.join(p, 'AGENTS.md'), fs.readFileSync(path.join(p, 'CLAUDE.md'))); console.log('✓ Created a first project folder:', p); } }

  console.log('\nYour AI tools (Jarvis works with whichever you have):');
  const tools = [['claude', 'Claude Code', 'https://claude.com/product/claude-code'], ['codex', 'Codex CLI', 'https://developers.openai.com/codex/cli'], ['gemini', 'Gemini CLI', 'https://github.com/google-gemini/gemini-cli']];
  let any = false;
  for (const [cmd, label, url] of tools) { const f = has(cmd); any = any || !!f; console.log(`  ${f ? '✓' : '·'} ${label}${f ? '' : '  (not installed: ' + url + ')'}`); }
  console.log(any ? '\nGood. Sign in to each tool once in Terminal (run its command, e.g. "claude") if you have not already.' : '\nInstall at least one of them (see docs/START-HERE.md, step 2) or add an API key later in Jarvis → Vault & keys.');

  if (noStart) { rl.close(); console.log('\n✓ Personalised. (not starting: --no-start)'); return; }
  const doAuto = noAuto ? 'n' : await ask('\nStart Jarvis automatically when you log in to this Mac? (y/n)', 'y');
  if (/^y/i.test(doAuto) && process.platform === 'darwin') {
    const label = 'com.jarvis.local', plist = path.join(os.homedir(), 'Library/LaunchAgents', label + '.plist');
    fs.mkdirSync(path.dirname(plist), { recursive: true });
    fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${process.execPath}</string><string>${path.join(ROOT, 'server.js')}</string></array><key>WorkingDirectory</key><string>${ROOT}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>EnvironmentVariables</key><dict><key>PATH</key><string>${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin:${os.homedir()}/.local/bin</string></dict><key>StandardOutPath</key><string>${os.homedir()}/Library/Logs/jarvis.log</string><key>StandardErrorPath</key><string>${os.homedir()}/Library/Logs/jarvis.log</string></dict></plist>`);
    try { execFileSync('launchctl', ['bootout', `gui/${process.getuid()}/${label}`], { stdio: 'ignore' }); } catch {}
    try { execFileSync('launchctl', ['bootstrap', `gui/${process.getuid()}`, plist]); console.log('✓ Jarvis will start by itself at login.'); } catch (e) { console.log('Could not register the auto-start (not needed). Start it with start.command instead.'); }
    rl.close();
    await new Promise((r) => setTimeout(r, 2500));
  } else {
    rl.close();
    spawn(process.execPath, [path.join(ROOT, 'server.js')], { stdio: 'inherit', detached: false });
  }
  if (process.platform === 'darwin') setTimeout(() => { try { execFileSync('open', ['http://localhost:4777']); } catch {} }, 3000);
  console.log('\n✓ Done. Jarvis is at http://localhost:4777 — now follow docs/START-HERE.md from step 3.\n');
})();
