#!/usr/bin/env node
'use strict';
// Claude Code status line bridge: Claude Code hands this script its session data on stdin, including (for Pro/Max subscribers)
// the 5-hour and 7-day rate-limit usage. We forward only those two percentages to the local Jarvis server, and print a short status line.
// Nothing else from the session (no prompts, no paths) is sent. If Jarvis is not running, it fails silently.
const chunks = []; process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', async () => {
  let d = {}; try { d = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {}
  const rl = d.rate_limits || {}; const win = [];
  const add = (key, id, label, minutes) => { const w = rl[key]; if (w && typeof w.used_percentage === 'number') win.push({ id, label, usedPercent: Math.max(0, Math.min(100, w.used_percentage)), windowMinutes: minutes, resetsAt: typeof w.resets_at === 'number' ? new Date(w.resets_at * 1000).toISOString() : null }); };
  add('five_hour', 'five-hour', '5-hour window', 300); add('seven_day', 'weekly', 'Weekly window', 10080);
  const model = (d.model && d.model.display_name) || 'Claude'; const ctx = d.context_window && typeof d.context_window.used_percentage === 'number' ? Math.round(d.context_window.used_percentage) + '% context' : '';
  const f = win.find((w) => w.id === 'five-hour'), w7 = win.find((w) => w.id === 'weekly');
  process.stdout.write([model, ctx, f ? `5h ${Math.round(f.usedPercent)}%` : '', w7 ? `week ${Math.round(w7.usedPercent)}%` : ''].filter(Boolean).join(' · '));
  if (win.length) { try { await fetch((process.env.JARVIS_URL || 'http://localhost:4777') + '/api/usage/snapshot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accounts: [{ id: 'claude', at: new Date().toISOString(), windows: win }] }), signal: AbortSignal.timeout(2500) }); } catch {} }
});
