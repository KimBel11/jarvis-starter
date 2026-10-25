'use strict';
// Model catalog + routing guide. Which AI, which model, which reasoning level, for which kind of work.
// Routing principles are adapted (in our own words) from Ruflo's model-routing rules (MIT) and the AI Council method:
//   cheap + fast model for simple work, strongest model for hard reasoning, Claude for architecture/review/analysis,
//   Codex for implementation, Gemini for long documents and web research, a second opinion on anything that costs money.
const fs = require('fs');
const path = require('path');
const os = require('os');

const CLAUDE_MODELS = [
  { id: '', name: 'Account default', tier: 'default', desc: 'Whatever your Claude account uses by default.' },
  { id: 'claude-fable-5-1', name: 'Fable 5.1', tier: 'max', desc: 'Most capable. Hardest reasoning and long careful work. Slowest and priciest.' },
  { id: 'claude-opus-5-5', name: 'Opus 5.5', tier: 'high', desc: 'Deep reasoning: planning, architecture, security, analysis, review.' },
  { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', tier: 'balanced', desc: 'Best all-rounder. Fast, strong, good value. Default for most agents.' },
  { id: 'claude-haiku-5-5', name: 'Haiku 5.5', tier: 'fast', desc: 'Very fast and cheap (a fraction of a cent). Simple, well-defined tasks.' },
];
const CLAUDE_EFFORT = ['', 'low', 'medium', 'high', 'xhigh', 'max'];

// Routing rules: the reasoning behind every recommendation (shown to @@NAME@@ and in the UI).
const RULES = [
  { key: 'quick', label: 'Quick & simple', when: 'Lookups, formatting, classifying, short summaries, anything you could explain in one sentence.', claude: ['claude-haiku-5-5', 'low'], codex: ['gpt-6-luna', 'low'], gemini: 'flash', why: 'Simple work does not need a big model. A small fast model is about 20x cheaper and answers in a second.' },
  { key: 'everyday', label: 'Everyday work', when: 'Normal tasks: writing captions, editing with ffmpeg, summarising, routine planning.', claude: ['claude-sonnet-5-5', 'medium'], codex: ['gpt-6.1-sol', 'medium'], gemini: 'flash', why: 'The balanced workhorse: strong enough for most things, fast, reasonable cost.' },
  { key: 'deep', label: 'Deep thinking', when: 'Architecture, security, complex plans, analysis with many moving parts, anything where a mistake is expensive.', claude: ['claude-opus-5-5', 'high'], codex: ['gpt-6-astra', 'high'], gemini: 'pro', why: 'Use the strongest model where being right matters more than speed.' },
  { key: 'code', label: 'Writing & changing code', when: 'Implementing features, refactoring, optimising, scripts, fixing bugs in apps and websites.', claude: ['claude-sonnet-5-5', 'high'], codex: ['gpt-6.1-sol', 'high'], gemini: 'pro', why: 'Codex implements and optimises well; Claude reviews architecture and edge cases. Pair them for anything that ships.' },
  { key: 'research', label: 'Research & long documents', when: 'Reading long PDFs or many sources, comparing options, current information from the web.', claude: ['claude-sonnet-5-5', 'medium'], codex: ['gpt-6.1-sol', 'medium'], gemini: 'pro', why: 'Gemini handles very long inputs and Google Search well; use it as the research engine.' },
  { key: 'creative', label: 'Creative planning', when: 'Video concepts, hooks, scripts, campaign ideas.', claude: ['claude-opus-5-5', 'medium'], codex: ['gpt-6.1-sol', 'medium'], gemini: 'pro', why: 'Creative quality benefits from the strongest writing model, then a second opinion.' },
];
// Which kind of work each agent does + the engine setup that suits it.
const AGENT_PLAN = {
  kim: { rule: 'deep', mode: 'both', note: 'Jarvis / @@ASSISTANT@@ always pairs Opus 5.5 with Astra at medium effort. Choose the lead in Jarvis; both participate.' },
  'myproject-video': { rule: 'creative', mode: 'both', primary: 'claude', note: 'Plans spend credits: Claude plans, Codex double-checks the plan before you approve.' },
  'myproject-poster': { rule: 'everyday', mode: 'both', primary: 'claude', note: 'Posts are public: a second opinion before you approve.' },
  'myproject-analyst': { rule: 'deep', mode: 'claude', note: 'Analysis with many moving parts needs deep reasoning.' },
  'myproject-editor': { rule: 'everyday', mode: 'claude', note: 'ffmpeg editing is routine.' },
  'myproject-app': { rule: 'code', mode: 'both', primary: 'codex', note: 'Codex writes the code, Claude reviews it.' },
  'myproject-web': { rule: 'code', mode: 'both', primary: 'codex', note: 'Codex writes the change, Claude reviews it before anything is published.' },
  'myproject-editor': { rule: 'everyday', mode: 'claude', note: 'ffmpeg editing is routine.' },
  'myproject-poster': { rule: 'everyday', mode: 'both', primary: 'claude', note: 'Posts are public: a second opinion before you approve.' },
  'myproject-video': { rule: 'creative', mode: 'both', primary: 'claude', note: 'Plans spend credits: a second opinion first.' },
  'myproject-analyst': { rule: 'deep', mode: 'claude', note: 'Analysis needs deep reasoning.' },
  'myproject-app': { rule: 'code', mode: 'both', primary: 'codex', note: 'Codex writes the code, Claude reviews it.' },
  'myproject-web': { rule: 'code', mode: 'both', primary: 'codex', note: 'Codex writes the change, Claude reviews it before deploying.' },
  'video-intel': { rule: 'everyday', mode: 'claude', note: 'Reads frames and a transcript: Sonnet is enough.' },
  'blender-3d': { rule: 'code', mode: 'claude', note: 'Blender scripting; Claude plans safely and edits copies only.' },
};

module.exports = function makeModels(ctx, deps) {
  const codexList = () => {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.codex', 'models_cache.json'), 'utf8'));
      const list = (j.models || []).filter((m) => m.visibility === 'list').sort((a, b) => (a.priority || 99) - (b.priority || 99)).map((m) => ({ id: m.slug, name: m.display_name || m.slug, desc: m.description || '', efforts: (m.supported_reasoning_levels || []).map((x) => x.effort), defaultEffort: m.default_reasoning_level || '' }));
      return [{ id: '', name: 'Codex default', desc: 'The model set in your Codex app.', efforts: [], defaultEffort: '' }, ...list];
    } catch { return [{ id: '', name: 'Codex default', desc: '', efforts: [], defaultEffort: '' }]; }
  };
  async function catalog() {
    let gm = []; let gk = false; try { gk = !!deps.gemini.key(); if (gk) gm = await deps.gemini.listModels(); } catch {}
    return { claude: { models: CLAUDE_MODELS, efforts: CLAUDE_EFFORT }, codex: { models: codexList(), efforts: ['', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] }, gemini: { configured: gk, models: [{ id: '', name: 'Automatic (best available)', desc: '' }, ...gm.map((m) => ({ id: m.id, name: m.id, desc: m.desc }))] }, rules: RULES, plan: AGENT_PLAN };
  }
  // Recommended settings for one agent, using the routing rule it belongs to
  function recommend(agentId) {
    if(agentId==='kim')return {engine:'both',models:{claude:'claude-opus-5-5',codex:'gpt-6-astra',gemini:''},effort:{claude:'medium',codex:'medium'},rule:'deep',label:'Jarvis paired models',why:'Both models participate; the saved lead chooses who answers first.',note:AGENT_PLAN.kim.note};
    const p = AGENT_PLAN[agentId]; if (!p) return null; const r = RULES.find((x) => x.key === p.rule);
    return { engine: p.mode === 'both' ? 'both' : p.mode, primary: p.primary || 'claude', models: { claude: r.claude[0], codex: r.codex[0], gemini: '' }, effort: { claude: r.claude[1], codex: r.codex[1] }, rule: r.key, label: r.label, why: r.why, note: p.note };
  }
  return {
    RULES, AGENT_PLAN, catalog, recommend,
    routingText() { return RULES.map((r) => `- ${r.label} (${r.key}): ${r.when} → Claude ${r.claude[0].replace('claude-', '')} (${r.claude[1]}), Codex ${r.codex[0]} (${r.codex[1]}), Gemini ${r.gemini}. ${r.why}`).join('\n'); },
    async handle(req, res, url, p) {
      if (p === '/api/models') { ctx.send(res, 200, await catalog()); return true; }
      return false;
    },
  };
};
