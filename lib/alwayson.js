'use strict';
// "What must stay on": live checks of everything Jarvis needs on this Mac to work around the clock, each with plain steps to fix it.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');

const run = (cmd, args, ms = 10000) => new Promise((res) => execFile(cmd, args, { timeout: ms, encoding: 'utf8', maxBuffer: 5e6 }, (e, out, err) => res({ ok: !e, out: out || '', err: (err || (e && e.message) || '').trim() })));
const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };

module.exports = function makeAlwaysOn(ctx, deps) {
  const FILE = path.join(ctx.DATA, 'alwayson.json'); let st = { keepAwake: false };
  try { st = { ...st, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}
  const save = () => { try { fs.writeFileSync(FILE, JSON.stringify(st)); } catch {} };
  let cafe = null;
  function applyKeepAwake() {
    if (st.keepAwake && !cafe) { cafe = spawn('/usr/bin/caffeinate', ['-i', '-m', '-s', '-w', String(process.pid)], { stdio: 'ignore' }); cafe.on('exit', () => (cafe = null)); cafe.unref && cafe.unref(); }
    if (!st.keepAwake && cafe) { try { cafe.kill(); } catch {} cafe = null; }
  }
  applyKeepAwake();
  const uid = process.getuid ? process.getuid() : 501;

  async function checks() {
    const out = []; const add = (id, label, state, detail, steps, extra) => out.push({ id, label, state, detail, steps: steps || [], ...(extra || {}) });
    // 1 Jarvis itself
    const la = await run('/bin/launchctl', ['print', `gui/${uid}/com.jarvis.local`]); add('jarvis', 'Jarvis keeps itself running', la.ok ? 'ok' : 'warn', la.ok ? 'Jarvis is a login item (LaunchAgent) and restarts if it stops.' : 'Jarvis is not set up to start by itself.', la.ok ? [] : ['Ask Claude: "Make Jarvis auto-start at login".']);
    // 2 awake
    const pm = await run('/usr/bin/pmset', ['-g']); const prevented = /sleep prevented by[^\n]*(Amphetamine|caffeinate|Jarvis)/i.test(pm.out) || /\bsleep\s+0\b/.test(pm.out); const sleepMin = (pm.out.match(/\bsleep\s+(\d+)/) || [])[1];
    const amph = /Amphetamine/i.test(pm.out); const awakeOk = prevented || st.keepAwake;
    add('awake', 'The Mac never falls asleep', awakeOk ? 'ok' : 'bad', amph ? 'Amphetamine is keeping the Mac awake.' : st.keepAwake ? 'Jarvis is keeping the Mac awake.' : `The Mac can sleep after ${sleepMin || '?'} minutes. When it sleeps, Jarvis, iMessage and your phone access stop.`, awakeOk ? [] : ['Turn on "Keep this Mac awake" below (the quickest way).', 'Or: System Settings › Energy › turn on "Prevent automatic sleeping when the display is off".'], { toggle: 'keepAwake', on: !!st.keepAwake });
    // 3 power failure
    const ar = /\bautorestart\s+1\b/.test(pm.out); add('power', 'Starts again after a power cut', ar ? 'ok' : 'warn', ar ? 'The Mac restarts itself after a power failure.' : 'After a power cut the Mac stays off until you press the button.', ar ? [] : ['System Settings › Energy › turn on "Start up automatically after a power failure".']);
    // 4 login after restart
    const al = await run('/usr/bin/defaults', ['read', '/Library/Preferences/com.apple.loginwindow', 'autoLoginUser']); const fv = await run('/usr/bin/fdesetup', ['status']); const fvOn = /FileVault is On/i.test(fv.out);
    add('login', 'Logs in by itself after a restart', al.ok ? 'ok' : 'warn', al.ok ? 'Automatic login is on, so Jarvis starts after a restart.' : `Automatic login is off${fvOn ? ' (FileVault is on, which prevents it)' : ''}. After a restart Jarvis only starts once you log in.`, al.ok ? [] : fvOn ? ['After a power cut you must type your password once at the Mac. Everything starts after that.', 'Optional: turn FileVault off in System Settings › Privacy & Security, then enable automatic login in System Settings › Users & Groups. (Only do this if the Mac stays in a safe place.)'] : ['System Settings › Users & Groups › "Automatically log in as" › choose your user.']);
    // 5 drive
    add('drive', 'The "workspace folder" stays connected', exists(ctx.DRIVE) ? 'ok' : 'bad', exists(ctx.DRIVE) ? 'All your project folders are reachable.' : 'The drive is not connected. Jarvis cannot see your projects.', exists(ctx.DRIVE) ? ['Never eject it and avoid a loose cable. Plug it straight into the Mac.'] : ['Reconnect the drive and wait 10 seconds.']);
    // 6 tailscale
    const ifs = Object.values(os.networkInterfaces()).flat().filter((x) => x && x.family === 'IPv4' && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(x.address)); const tsOk = ifs.length > 0; const phone = true;
    add('tailscale', 'Tailscale is connected', tsOk ? 'ok' : 'bad', tsOk ? `Connected (${ifs[0].address}). Your iPhone can reach Jarvis from anywhere while it is connected too.` : 'Tailscale is off or logged out, so the phone app cannot reach Jarvis.', tsOk ? ['Keep Tailscale open in the menu bar and set it to start at login (Tailscale menu › Settings › Launch at login).'] : ['Open Tailscale from the menu bar and press Connect.', 'Turn on "Launch at login" in its settings.']);
    // 7 messages / iMessage bridge
    const im = deps.imessage ? await deps.imessage.status() : null; const msgRun = im && im.messagesRunning;
    if (im) add('messages', 'Messages is signed in and open (for iMessage control)', !im.enabled ? 'warn' : msgRun ? 'ok' : 'warn', !im.enabled ? 'iMessage control is not turned on yet.' : msgRun ? 'Messages is running.' : 'Messages is closed. Jarvis opens it to reply, but keep it open for speed.', im.enabled ? ['Open Messages once and leave it open (it can be in the background).', 'Settings › iMessage must show your Apple ID as signed in.'] : ['Set it up in Tools & integrations › iMessage control.']);
    // 8 CLIs
    const cl = ctx.which('claude'), cx = ctx.which('codex'); add('cli', 'Claude Code and Codex are installed and signed in', cl && cx ? 'ok' : 'warn', `${cl ? 'Claude Code found' : 'Claude Code missing'} · ${cx ? 'Codex found' : 'Codex missing'}`, cl && cx ? ['If an agent says it is not logged in, open Claude Code or Codex once in Terminal and log in again.'] : ['Install the missing one and log in once.']);
    // 9 disk
    const df = await run('/bin/df', ['-k', ctx.DRIVE]); const m = df.out.split('\n')[1] && df.out.split('\n')[1].trim().split(/\s+/); const free = m ? Math.round((+m[3] / 1048576)) : null;
    add('disk', 'Enough free disk space', free == null ? 'warn' : free > 30 ? 'ok' : free > 10 ? 'warn' : 'bad', free == null ? 'Could not read the free space.' : `${free} GB free on the drive.`, free != null && free <= 30 ? ['Remove old render folders and caches (dev-caches, DerivedData) from the project folders.'] : []);
    // a microphone for talking to Jarvis on this Mac
    const au = await run('/usr/sbin/system_profiler', ['SPAudioDataType'], 15000); const devs = au.out.split(/\n\s{8}(?=\S[^\n]*:\n)/); const realIn = devs.filter((b) => /Input Channels:/.test(b) && !/Transport:\s*Virtual/.test(b)).map((b) => b.split('\n')[0].replace(/[:\s]+$/, '').trim());
    add('mic', 'A microphone is connected (to talk to Jarvis on this Mac)', realIn.length ? 'ok' : 'warn', realIn.length ? `Input: ${realIn.join(', ')}` : 'This Mac has no microphone (a Mac mini has none built in), so voice input does not work here. The iPhone app still can.', realIn.length ? [] : ['Plug in a USB microphone, headset or webcam (or connect AirPods), then choose it in System Settings › Sound › Input.', 'Or talk to Jarvis from the iPhone app.']);
    // 10 Simulator (optional)
    const sim = await run('/usr/bin/xcrun', ['simctl', 'list', 'devices', 'booted']); const booted = /\(Booted\)/.test(sim.out); add('simulator', 'iPhone Simulator (only for the app preview tabs)', booted ? 'ok' : 'info', booted ? 'The Simulator is on.' : 'The Simulator is off. Jarvis starts it when you press "Open the app".', []);
    return out;
  }
  return {
    checks,
    async handle(req, res, url, p) {
      if (!p.startsWith('/api/alwayson')) return false; const S = (c, b) => (ctx.send(res, c, b), true);
      try {
        if (p === '/api/alwayson') { const c = await checks(); const bad = c.filter((x) => x.state === 'bad').length, warn = c.filter((x) => x.state === 'warn').length; return S(200, { checks: c, score: { ok: c.filter((x) => x.state === 'ok').length, total: c.filter((x) => x.state !== 'info').length, bad, warn } }); }
        if (p === '/api/alwayson/keepawake' && req.method === 'POST') { const b = await ctx.readBody(req); st.keepAwake = !!b.on; save(); applyKeepAwake(); return S(200, { keepAwake: st.keepAwake }); }
      } catch (e) { return S(400, { error: String(e.message || e) }); }
      return false;
    },
  };
};
