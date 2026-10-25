'use strict';
// Video Intel tooling: upload inbox, ffprobe/ffmpeg extraction (frames + audio), optional Scribe transcript.
// Extraction is run by Jarvis itself (deterministic); the Video Intel agent then reads the results.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile, spawn } = require('child_process');
const dns = require('dns').promises;
const net = require('net');

const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi|mp3|wav|m4a)$/i;
const slug = (s) => String(s).toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'video';

module.exports = function makeVideo(ctx, voice) {
  const INBOX = path.join(ctx.DATA, 'inbox');
  const EXTRACTS = path.join(ctx.DATA, 'extracts');
  for (const d of [INBOX, EXTRACTS]) fs.mkdirSync(d, { recursive: true });
  const ff = (bin, args, timeout = 600000) => new Promise((res, rej) => execFile(ctx.which(bin) || '/opt/homebrew/bin/' + bin, args, { timeout, maxBuffer: 20e6 }, (e, so, se) => (e ? rej(new Error((se || e.message).toString().split('\n').slice(-3).join(' '))) : res(so))));
  const roots = () => [INBOX, ...ctx.state.projects.map((p) => p.path), ...['Downloads', 'Desktop', 'Movies', 'Documents'].map((d) => path.join(ctx.HOME, d))];
  const okPath = (p) => { const r = path.resolve(p); return VIDEO_EXT.test(r) && roots().some((x) => ctx.inside(r, x)) && fs.existsSync(r); };


  /* ---------- video from a link (any site yt-dlp knows, or a direct media file) ---------- */
  const URL_RE = /https?:\/\/[^\s"'<>)\]]+/i;
  const URL_DIR = path.join(INBOX, 'url'); fs.mkdirSync(URL_DIR, { recursive: true });
  const privateIp = (ip) => /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80)/i.test(ip) || ip === '::';
  async function safeUrl(u) { // links must point at the public internet, never at this Mac or the home network
    let x; try { x = new URL(u); } catch { throw new Error('That is not a valid link.'); } if (!/^https?:$/.test(x.protocol)) throw new Error('Only http and https links work.');
    const host = x.hostname.replace(/^\[|\]$/g, ''); if (/^localhost$|\.local$|\.internal$/i.test(host)) throw new Error('That link points to this computer, not to a video on the internet.');
    const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((a) => a.address); if (!ips.length) throw new Error('I could not find that website.'); if (ips.some(privateIp)) throw new Error('That link points to a private address, not to a video on the internet.');
    return x.toString();
  }
  const ytBin = () => ['/opt/homebrew/bin/yt-dlp', '/usr/local/bin/yt-dlp', path.join(ctx.HOME, '.local/bin/yt-dlp')].find((p) => fs.existsSync(p)) || ctx.which('yt-dlp');
  function friendly(err) {
    const e = String(err || '');
    if (/Unsupported URL/i.test(e)) return 'That page has no video I can download. Open the video itself and copy its address, or upload the file.';
    if (/login|log in|sign in|private|members|age|confirm your age|cookies/i.test(e)) return 'This video needs a login (private, members-only or age-restricted). Download the file yourself and upload it instead.';
    if (/geo|not available in your country|blocked/i.test(e)) return 'This video is blocked in your country.';
    if (/HTTP Error 404|not found|removed|deleted|unavailable/i.test(e)) return 'The video is gone or the link is wrong (404).';
    if (/larger than|max-filesize|File is larger/i.test(e)) return 'The video is too large (limit 1.5 GB).';
    if (/duration/i.test(e)) return 'The video is longer than 2 hours.';
    return 'The video could not be downloaded: ' + e.split('\n').filter(Boolean).slice(-1)[0].slice(0, 200);
  }
  async function direct(u, say) { // a plain link to a video or audio file
    const head = await fetch(u, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(12000), headers: { 'User-Agent': 'Mozilla/5.0 JarvisVideo' } }).catch(() => null);
    const ct = (head && head.headers.get('content-type')) || ''; const ext = (new URL(u).pathname.match(VIDEO_EXT) || [])[0];
    if (!(/^(video|audio)\//i.test(ct) || ext)) return null;
    const r = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(20 * 60e3), headers: { 'User-Agent': 'Mozilla/5.0 JarvisVideo' } }); if (!r.ok) throw new Error('The file answered ' + r.status);
    const total = +r.headers.get('content-length') || 0; if (total > 1.5e9) throw new Error('The video is too large (limit 1.5 GB).');
    const name = slug(path.basename(new URL(u).pathname)) + '-' + Date.now().toString(36) + (ext || '.mp4'); const file = path.join(URL_DIR, name); const out = fs.createWriteStream(file); let got = 0, last = 0;
    for await (const chunk of r.body) { got += chunk.length; if (got > 1.5e9) { out.destroy(); throw new Error('The video is too large (limit 1.5 GB).'); } out.write(chunk); if (total && got / total - last > 0.1) { last = got / total; say(`Downloading ${Math.round(last * 100)}%`); } }
    await new Promise((res) => out.end(res)); return file;
  }
  async function fetchUrl(url, onStatus) {
    const say = (s) => { try { onStatus && onStatus(s); } catch {} }; const u = await safeUrl(url); say('Looking at the link…');
    const d = await direct(u, say).catch((e) => { if (/too large|answered/.test(e.message)) throw e; return null; }); if (d) return d;
    const bin = ytBin(); if (!bin) throw new Error('The video downloader (yt-dlp) is not installed. In Terminal run: brew install yt-dlp');
    return new Promise((resolve, reject) => {
      const args = ['--no-playlist', '--no-warnings', '--newline', '--no-colors', '-f', 'bv*[height<=1080]+ba/b[height<=1080]/b', '--merge-output-format', 'mp4', '--max-filesize', '1500M', '--socket-timeout', '30', '-o', path.join(URL_DIR, '%(title).70B [%(id)s].%(ext)s'), '--print', 'after_move:filepath', u];
      const p = spawn(bin, args, { env: { ...process.env, HOME: ctx.HOME, PATH: ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':') } }); let outp = '', errp = '', file = null, lastPct = -10;
      const timer = setTimeout(() => { p.kill('SIGTERM'); reject(new Error('The download took too long (20 minutes).')); }, 20 * 60e3);
      const feed = (buf) => { for (const line of buf.toString().split('\n')) { const m = line.match(/\[download\]\s+([\d.]+)%/); if (m) { const pc = Math.floor(+m[1]); if (pc - lastPct >= 10) { lastPct = pc; say(`Downloading ${pc}%`); } } else if (line.startsWith('/') && fs.existsSync(line.trim())) file = line.trim(); else if (/\[Merger\]|\[ExtractAudio\]/.test(line)) say('Putting the video together…'); else if (/^\[(youtube|tiktok|instagram|twitter|facebook|vimeo|generic)/i.test(line)) say(line.replace(/^\[[^\]]+\]\s*/, '').slice(0, 80)); } };
      p.stdout.on('data', (b) => { outp += b; feed(b); }); p.stderr.on('data', (b) => { errp += b; });
      p.on('close', (code) => { clearTimeout(timer); if (file && fs.existsSync(file)) return resolve(file); reject(new Error(friendly(errp || outp))); });
      p.on('error', (e) => { clearTimeout(timer); reject(new Error('Could not start the video downloader: ' + e.message)); });
    });
  }

  async function extract(file, onStatus) {
    const src = path.resolve(file); if (!okPath(src)) throw new Error('Video not found or outside allowed folders: ' + file);
    const id = slug(path.basename(src)) + '-' + Date.now().toString(36); const dir = path.join(EXTRACTS, id); const fdir = path.join(dir, 'frames');
    await fsp.mkdir(fdir, { recursive: true }); const say = (s) => { try { onStatus && onStatus(s); } catch {} };
    say('Reading video info…');
    let probe = {}; try { probe = JSON.parse(await ff('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', src], 60000)); } catch {}
    const vs = (probe.streams || []).find((s) => s.codec_type === 'video'); const as = (probe.streams || []).find((s) => s.codec_type === 'audio');
    const duration = Number((probe.format && probe.format.duration) || (vs && vs.duration) || 0);
    const meta = { id, source: src, name: path.basename(src), createdAt: new Date().toISOString(), duration, size: Number((probe.format && probe.format.size) || fs.statSync(src).size), width: vs && vs.width, height: vs && vs.height, fps: vs && vs.r_frame_rate, videoCodec: vs && vs.codec_name, audioCodec: as && as.codec_name, hasVideo: !!vs, hasAudio: !!as, frames: [], transcript: null, language: null, notes: [] };
    if (vs && duration > 0) {
      say('Extracting key frames…');
      const n = Math.min(16, Math.max(6, Math.round(duration / 5))); const fps = n / Math.max(duration, 1);
      try { await ff('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', `fps=${fps.toFixed(5)},scale=800:-2`, '-frames:v', String(n), '-q:v', '4', path.join(fdir, 'f%02d.jpg')]); } catch (e) { meta.notes.push('Frame extraction failed: ' + e.message); }
      meta.frames = (await fsp.readdir(fdir)).filter((f) => f.endsWith('.jpg')).sort().map((f, i) => ({ file: 'frames/' + f, t: Math.round(((i + 0.5) / n) * duration * 10) / 10 }));
      try { await ff('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', `fps=${(8 / Math.max(duration, 1)).toFixed(5)},scale=360:-2,tile=4x2`, '-frames:v', '1', '-q:v', '5', path.join(dir, 'sheet.jpg')]); } catch {}
    }
    if (as) {
      say('Extracting audio…'); const mp3 = path.join(dir, 'audio.mp3');
      try { await ff('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', mp3]); } catch (e) { meta.notes.push('Audio extraction failed: ' + e.message); }
      if (fs.existsSync(mp3)) {
        if (voice.key()) {
          say('Transcribing speech…');
          try { const r = await voice.stt(await fsp.readFile(mp3), 'audio/mpeg'); meta.transcript = r.text; meta.language = r.language; await fsp.writeFile(path.join(dir, 'transcript.txt'), r.text); }
          catch (e) { meta.notes.push('Transcription failed: ' + e.message); }
        } else meta.notes.push('No ElevenLabs key in the vault, so speech was not transcribed.');
      }
    } else meta.notes.push('This file has no audio track.');
    await fsp.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
    ctx.notifications?.publish({id:'video:'+id,title:meta.notes.length?'Video extraction finished with notes':'Video extraction ready',body:meta.name,kind:'video',severity:meta.notes.length?'warning':'info',href:'#/video'});
    return { dir, meta };
  }
  const readMeta = (id) => { try { return JSON.parse(fs.readFileSync(path.join(EXTRACTS, id, 'meta.json'), 'utf8')); } catch { return null; } };
  function list() {
    let ids = []; try { ids = fs.readdirSync(EXTRACTS); } catch {}
    return ids.map((id) => { const m = readMeta(id); if (!m) return null; const d = path.join(EXTRACTS, id); return { id, name: m.name, source: m.source, createdAt: m.createdAt, duration: m.duration, hasTranscript: !!m.transcript, hasReport: fs.existsSync(path.join(d, 'report.md')), frames: m.frames.length, language: m.language }; }).filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const safeFile = (id, f) => { if (!/^[a-z0-9-]+$/.test(id)) return null; const p = path.resolve(EXTRACTS, id, f); return ctx.inside(p, path.join(EXTRACTS, id)) && /\.(jpg|md|txt|json|mp3)$/.test(p) ? p : null; };

  return {
    INBOX, EXTRACTS, extract, list, readMeta, okPath, VIDEO_EXT,
    findUrl(text) { const m = String(text).match(URL_RE); if (!m) return null; try { const h = new URL(m[0]).hostname; return /^(localhost|127\.)/.test(h) ? null : m[0].replace(/[.,;]+$/, ''); } catch { return null; } },
    fetchUrl,
    findVideoPath(text) { const m = String(text).match(/(\/[^\n"'<>|]+?\.(?:mp4|mov|m4v|webm|mkv|avi|mp3|wav|m4a))/i); return m ? m[1] : null; },
    async handle(req, res, url, p) {
      if (p === '/api/video/fetch' && req.method === 'POST') { try { const b = await ctx.readBody(req); const f = await fetchUrl(String(b.url || '').trim(), () => {}); return ctx.send(res, 200, { path: f, name: path.basename(f) }), true; } catch (e) { return ctx.send(res, 400, { error: String(e.message || e) }), true; } }
      if (p === '/api/upload' && req.method === 'POST') {
        const name = (url.searchParams.get('name') || 'upload').replace(/[^\w.\- ]+/g, '_').slice(0, 100); if (!VIDEO_EXT.test(name)) return ctx.send(res, 400, { error: 'Only video/audio files (mp4, mov, m4v, webm, mkv, avi, mp3, wav, m4a)' }), true;
        const dest = path.join(INBOX, Date.now().toString(36) + '-' + name.replace(/\s+/g, '_')); let size = 0; const max = 4 * 1024 ** 3;
        await new Promise((resolve, reject) => { const ws = fs.createWriteStream(dest); req.on('data', (c) => { size += c.length; if (size > max) { req.destroy(); ws.destroy(); reject(new Error('File larger than 4 GB')); } }); req.pipe(ws); ws.on('finish', resolve); ws.on('error', reject); req.on('error', reject); }).catch((e) => { try { fs.unlinkSync(dest); } catch {} throw e; });
        return ctx.send(res, 200, { path: dest, size }), true;
      }
      if (p === '/api/extracts') return ctx.send(res, 200, { extracts: list() }), true;
      if (p === '/api/extract') {
        const id = url.searchParams.get('id') || ''; const m = /^[a-z0-9-]+$/.test(id) && readMeta(id); if (!m) return ctx.send(res, 404, { error: 'not found' }), true;
        const rp = path.join(EXTRACTS, id, 'report.md'); return ctx.send(res, 200, { meta: m, report: fs.existsSync(rp) ? fs.readFileSync(rp, 'utf8') : null }), true;
      }
      if (p === '/api/extract-file') { const f = safeFile(url.searchParams.get('id') || '', url.searchParams.get('f') || ''); if (!f || !fs.existsSync(f)) return ctx.send(res, 404, { error: 'not found' }), true; const t = /\.jpg$/.test(f) ? 'image/jpeg' : /\.mp3$/.test(f) ? 'audio/mpeg' : /\.json$/.test(f) ? 'application/json' : 'text/plain; charset=utf-8'; const h = { 'Content-Type': t, 'Cache-Control': 'private, max-age=60' }; if (url.searchParams.get('dl')) h['Content-Disposition'] = `attachment; filename="${path.basename(f)}"`; res.writeHead(200, h); fs.createReadStream(f).pipe(res); return true; }
      return false;
    },
  };
};
