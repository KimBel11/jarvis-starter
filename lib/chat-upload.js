'use strict';
// Files for the Jarvis chat: images, videos, audio, PDFs, documents and text. Saved under data/chat-uploads/<date>/ and handed to the agent as paths.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const OK = /\.(png|jpe?g|gif|webp|heic|heif|bmp|svg|mp4|mov|m4v|webm|mp3|m4a|wav|aac|ogg|pdf|txt|md|csv|tsv|json|html?|xml|ya?ml|docx?|xlsx?|pptx?|rtf|zip|log|srt|vtt|py|js|ts|css)$/i;
const KIND = (n) => (/\.(png|jpe?g|gif|webp|heic|heif|bmp|svg)$/i.test(n) ? 'image' : /\.(mp4|mov|m4v|webm)$/i.test(n) ? 'video' : /\.(mp3|m4a|wav|aac|ogg)$/i.test(n) ? 'audio' : /\.pdf$/i.test(n) ? 'pdf' : 'file');
const MAX = 250 * 1024 * 1024;

module.exports = function makeChatUpload(ctx) {
  const ROOT = path.join(ctx.DATA, 'chat-uploads');
  const safeName = (n) => { const base = path.basename(String(n || 'file')).replace(/[^\p{L}\p{N}._ ()-]/gu, '_').replace(/^\.+/, '').slice(-90) || 'file'; return base; };
  function prune() { try { const cutoff = Date.now() - 60 * 864e5; for (const d of fs.readdirSync(ROOT)) { const p = path.join(ROOT, d); if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { recursive: true, force: true }); } } catch {} }
  setTimeout(prune, 30000).unref();
  return {
    ROOT,
    isUpload: (p) => { try { const r = fs.realpathSync(p); return r.startsWith(fs.realpathSync(ROOT) + path.sep); } catch { return false; } },
    async handle(req, res, url, p) {
      if (p !== '/api/chat/upload' || req.method !== 'POST') return false;
      try {
        const name = safeName(decodeURIComponent(req.headers['x-filename'] || 'file')); if (!OK.test(name)) return ctx.send(res, 415, { error: 'That file type is not supported in chat. Zip it first, or use PDF, image, video, audio, text or Office files.' }), true;
        const body = await ctx.readRaw(req, MAX); if (!body.length) return ctx.send(res, 400, { error: 'The file is empty.' }), true;
        const day = new Date().toISOString().slice(0, 10); const dir = path.join(ROOT, day); fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const file = path.join(dir, crypto.randomBytes(4).toString('hex') + '-' + name); fs.writeFileSync(file, body, { mode: 0o600 });
        ctx.send(res, 200, { path: file, name, size: body.length, kind: KIND(name) });
      } catch (e) { ctx.send(res, e.status || 400, { error: String(e.message || e) }); }
      return true;
    },
  };
};
