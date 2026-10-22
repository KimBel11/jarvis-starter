'use strict';
// What will happen if @@NAME@@ approves this plan? Used by the home-page approval card to decide between one tap (local edits)
// and a second confirm step (publish, deploy, spend, delete). It only reads text; it never approves or changes anything.
// When in doubt it reports the risky kind, because an extra tap is cheaper than an unwanted post or bill.

const PUBLISH_SERVICES = new Set(['meta', 'tiktok', 'youtube', 'snapchat', 'pinterest', 'x', 'postiz', 'linkedin', 'facebook', 'instagram']);
const SPEND_SERVICES = new Set(['higgsfield', 'kie', 'arcads', 'elevenlabs']);

const PATTERNS = {
  publish: /\b(publish\w*|post(?:s|ing|ed)?\s+(?:it\s+|them\s+|the\s+\w+\s+)?(?:to|on)\b|schedul\w+\s+(?:the\s+|a\s+|\d+\s+)?(?:\w+\s+)?(?:posts?|videos?|reels?|shorts?)|go(?:es|ing)?\s+live|upload\w*\s+to\s+(?:youtube|tiktok|instagram|facebook|snapchat|pinterest|x\b)|send\w*\s+(?:the\s+|an?\s+)?(?:e-?mails?|messages?|repl(?:y|ies)|newsletter))/gi,
  deploy: /\b(deploy\w*|go(?:es|ing)?\s+to\s+production|push(?:es|ed)?\s+to\s+(?:prod|production|main|origin)|wrangler\s+(?:deploy|publish))\b/gi,
  spend: /(\bcredits?\b|[$€£]\s?(?!0+(?:[.,]0+)?(?![.,]?\d))\d|\b\d[\d.,]*\s?(?:usd|eur|sek|dollars?|euros?)\b|\bpaid\b|\bspend\w*|\bgenerat\w+\s+(?:the\s+|a\s+|\d+\s+)?(?:\w+\s+)?(?:videos?|images?|clips?|voice\w*))/gi,
  delete: /\b(delet\w+|erase\w*|wipe\w*|overwrit\w+|purg\w+|rm\s+-r\w*|drop\s+table)\b/gi,
};
const NEGATION = /\b(no|not|never|without|nothing|none|won'?t|don'?t|doesn'?t|isn'?t|aren'?t|avoid\w*|zero)\b|n't\b|\b0\s*(?:credits?|usd|eur|dollars?)/i;
const ORDER = ['delete', 'publish', 'deploy', 'spend'];
const LABEL = {
  publish: 'Publishes or sends content outside Jarvis',
  deploy: 'Deploys or pushes to a live system',
  spend: 'Spends credits or money',
  delete: 'Deletes or overwrites files',
};
const VERB = { publish: 'publish', deploy: 'deploy', spend: 'spend credits', delete: 'delete' };

// a match counts only when the same sentence does not negate it just before ("will not publish", "no credits", "never overwrite")
function affirmed(text, re) {
  re.lastIndex = 0; let m;
  while ((m = re.exec(text))) {
    const start = Math.max(text.lastIndexOf('.', m.index), text.lastIndexOf('\n', m.index), 0);
    if (!NEGATION.test(text.slice(Math.max(start, m.index - 45), m.index + m[0].length + 14))) return true;
  }
  return false;
}

function costOf(text) {
  const line = (/^\s*(?:[*#>\-\s]*)\**cost\**\s*[:\-–]\s*(.+)$/im.exec(text) || [])[1] || '';
  const scan = (s) => {
    const money = /([$€£])\s?(\d+(?:[.,]\d+)?)/.exec(s); if (money) return money[1] + money[2];
    const named = /(\d+(?:[.,]\d+)?)\s?(usd|eur|sek|dollars?|euros?)\b/i.exec(s); if (named) return named[1] + ' ' + named[2].toUpperCase();
    const cr = /(\d[\d.,]*)\s*(?:[a-z]+\s+)?credits?\b/i.exec(s); if (cr) return cr[1] + ' credits';
    return '';
  };
  const found = scan(line) || scan(text);
  return /^[$€£]?0+(?:[.,]0+)?(\s|$)/.test(found) ? '' : found;
}

function assessPlan({ title = '', plan = '', services = [], edits = true } = {}) {
  const text = String(title) + '\n' + String(plan);
  const kinds = new Set();
  for (const k of ORDER) if (affirmed(text, PATTERNS[k])) kinds.add(k);
  const svc = new Set(services || []);
  // an agent that holds publishing or paid-generation credentials is flagged when its plan talks about posting or generating
  if ([...svc].some((s) => PUBLISH_SERVICES.has(s)) && affirmed(text, /\b(post|publish|repl(?:y|ies)|schedule)\w*/gi)) kinds.add('publish');
  if ([...svc].some((s) => SPEND_SERVICES.has(s)) && affirmed(text, /\b(generat\w+|render\w*|synthes\w+|clone\w*)/gi)) kinds.add('spend');
  const cost = costOf(text);
  if (cost) kinds.add('spend');
  const list = ORDER.filter((k) => kinds.has(k));
  const labels = list.map((k) => LABEL[k]);
  labels.push(edits === false ? 'Reads only, changes nothing' : 'Edits files in the project folder on this Mac');
  return { level: list.length ? 'sensitive' : 'local', kinds: list, labels, verb: list.length ? VERB[list[0]] : '', cost };
}

module.exports = { assessPlan, costOf };
