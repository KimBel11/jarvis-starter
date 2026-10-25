'use strict';
// Website sales and traffic overview per project (read-only).
// Source 1: a Shopify Admin API token in the vault (service "shopify", entry named after the project) when there is one.
// Source 2: the Claude Shopify connector, read through a short headless Claude call (cheap model), only for the store the connector is linked to.
// Snapshots are cached on disk so the page opens instantly; "Refresh" gets new numbers.
const fs = require('fs');
const path = require('path');

const TOOLS = 'mcp__claude_ai_Shopify__get-shop-info,mcp__claude_ai_Shopify__run-analytics-query,mcp__claude_ai_Shopify__list-orders';
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const num = (x) => (x == null || x === '' || isNaN(+x) ? 0 : +x);

module.exports = function makeShop(ctx, deps) {
  const DIR = path.join(ctx.DATA, 'shop'); fs.mkdirSync(DIR, { recursive: true });
  const file = (pid) => path.join(DIR, pid + '.json');
  const read = (pid) => { try { return JSON.parse(fs.readFileSync(file(pid), 'utf8')); } catch { return null; } };
  const busy = new Set(); const failed = new Map(); // a store that cannot be read is not retried for 30 minutes
  const project = (id) => ctx.state.projects.find((p) => p.id === id);
  const shopify = (pr) => ((pr.workspace || {}).websites || []).find((s) => s.kind === 'shopify');

  function tokenFor(pr) {
    try { for (const e of deps.vault.listRaw()) if (e.service === 'shopify') { const mine = new RegExp(pr.name, 'i').test(e.name); for (const v of e.vars || []) if (mine && /TOKEN|ACCESS|ADMIN/i.test(v.k) && v.v) return v.v; } } catch {}
    return null;
  }
  async function viaToken(pr, site, token) {
    const domain = site.store || host(site.url); const since = new Date(Date.now() - 60 * 864e5).toISOString();
    const q = `{ shop { name currencyCode myshopifyDomain } orders(first: 250, sortKey: CREATED_AT, reverse: true, query: "created_at:>=${since.slice(0, 10)}") { nodes { name createdAt displayFinancialStatus customer { displayName } currentTotalPriceSet { shopMoney { amount } } lineItems(first: 20) { nodes { title quantity originalTotalSet { shopMoney { amount } } } } } } }`;
    const r = await fetch(`https://${domain}/admin/api/2025-07/graphql.json`, { method: 'POST', headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }), signal: AbortSignal.timeout(30000) });
    const j = await r.json().catch(() => ({})); if (!r.ok || j.errors) throw new Error((j.errors && j.errors[0] && j.errors[0].message) || 'Shopify said ' + r.status);
    const orders = (j.data.orders.nodes || []).map((o) => ({ name: o.name, when: o.createdAt, status: o.displayFinancialStatus, customer: o.customer && o.customer.displayName, total: num(o.currentTotalPriceSet.shopMoney.amount), items: o.lineItems.nodes })); const now = Date.now();
    const inRange = (o, a, b) => { const t = Date.parse(o.when); return t >= now - a * 864e5 && t < now - b * 864e5; };
    const cur = orders.filter((o) => inRange(o, 30, 0)), prev = orders.filter((o) => inRange(o, 60, 30)); const sum = (l) => l.reduce((s, o) => s + o.total, 0);
    const days = {}; for (const o of cur) { const k = o.when.slice(0, 10); (days[k] = days[k] || { d: k, sales: 0, orders: 0 }); days[k].sales += o.total; days[k].orders++; }
    const prod = {}; for (const o of cur) for (const it of o.items) { const p = (prod[it.title] = prod[it.title] || { title: it.title, sales: 0, orders: 0 }); p.sales += num(it.originalTotalSet.shopMoney.amount); p.orders += it.quantity; }
    return { source: 'admin-api', shop: { name: j.data.shop.name, currency: j.data.shop.currencyCode, domain }, sales: { total: sum(cur), orders: cur.length, aov: cur.length ? sum(cur) / cur.length : 0, prevTotal: sum(prev), prevOrders: prev.length, days: Object.values(days).sort((a, b) => a.d.localeCompare(b.d)) }, topProducts: Object.values(prod).sort((a, b) => b.sales - a.sales).slice(0, 8), traffic: null, referrers: [], recent: orders.slice(0, 12).map((o) => ({ name: o.name, customer: o.customer || '', total: o.total, status: o.status, when: o.when })) };
  }
  async function viaConnector(pr, site) {
    const want = host(site.url);
    const input = `Read the connected Shopify store and reply with ONLY one JSON object, no prose, no code fences. Steps: 1) call get-shop-info. 2) call run-analytics-query for: "FROM sales SHOW total_sales, orders TIMESERIES day SINCE -30d UNTIL today"; "FROM sales SHOW total_sales, orders, average_order_value SINCE -30d UNTIL today COMPARE TO previous_period"; "FROM sales SHOW total_sales, orders GROUP BY product_title ORDER BY total_sales DESC LIMIT 8 SINCE -30d UNTIL today"; "FROM sessions SHOW sessions, conversion_rate SINCE -30d UNTIL today"; "FROM sales SHOW orders, total_sales GROUP BY order_referrer_source SINCE -30d UNTIL today". 3) call list-orders with first=10. Output this exact shape (numbers as numbers, 0 if unknown): {"shop":{"name":"","domain":"","currency":""},"sales":{"total":0,"orders":0,"aov":0,"prevTotal":0,"prevOrders":0,"days":[{"d":"YYYY-MM-DD","sales":0,"orders":0}]},"topProducts":[{"title":"","sales":0,"orders":0}],"traffic":{"sessions":0,"conversion":0},"referrers":[{"name":"","orders":0,"sales":0}],"recent":[{"name":"#1001","customer":"","total":0,"status":"","when":"ISO"}]}`;
    const r = await deps.runner.runOnce({ agent: 'claude', model: 'claude-haiku-5-5', maxBudget: 0.6, cwd: ctx.DRIVE, input, system: 'You are a data reader. Use the Shopify tools, never invent numbers, and answer with JSON only.', tools: TOOLS, timeoutMs: 240000 });
    const m = r.text.match(/\{[\s\S]*\}/); if (!m) throw new Error('The Shopify connector did not return data'); let j; try { j = JSON.parse(m[0]); } catch { throw new Error('The Shopify data came back in an unexpected form'); }
    const dom = String((j.shop && j.shop.domain) || '').replace(/^www\./, ''); if (dom && want && !dom.endsWith(want) && !want.endsWith(dom) && !(site.store && dom === site.store)) throw new Error(`The Claude Shopify connector is linked to ${dom}, not ${want}. Add a Shopify Admin API token for ${pr.name} in Vault & keys to see this store.`);
    return { source: 'connector', shop: j.shop || {}, sales: j.sales || { total: 0, orders: 0, aov: 0, prevTotal: 0, prevOrders: 0, days: [] }, topProducts: j.topProducts || [], traffic: j.traffic || null, referrers: j.referrers || [], recent: j.recent || [], cost: r.cost || 0 };
  }
  async function refresh(pid) {
    const pr = project(pid); if (!pr) throw new Error('unknown project'); const site = shopify(pr); if (!site) throw new Error('This project has no Shopify store'); if (busy.has(pid)) throw new Error('Already refreshing');
    const f = failed.get(pid); if (f && Date.now() - f.at < 30 * 60e3) throw new Error(f.msg);
    busy.add(pid);
    try {
      const tok = tokenFor(pr); let d; if (tok) d = await viaToken(pr, site, tok); else d = await viaConnector(pr, site);
      d.at = Date.now(); d.project = pid; fs.writeFileSync(file(pid), JSON.stringify(d)); failed.delete(pid); return d;
    } catch (e) { failed.set(pid, { at: Date.now(), msg: String(e.message || e) }); throw e; } finally { busy.delete(pid); }
  }
  const state = (pid) => { const pr = project(pid); const site = pr && shopify(pr); return { available: !!site, snapshot: read(pid), refreshing: busy.has(pid), hasToken: !!(pr && tokenFor(pr)), store: site ? site.store || host(site.url) : null }; };
  return {
    state,
    async handle(req, res, url, p) {
      if (!p.startsWith('/api/shop')) return false; const S = (c, b) => (ctx.send(res, c, b), true);
      try {
        const pid = url.searchParams.get('project') || ''; if (!project(pid)) return S(404, { error: 'unknown project' });
        if (p === '/api/shop') return S(200, state(pid));
        if (p === '/api/shop/refresh' && req.method === 'POST') { const d = await refresh(pid); return S(200, { ...state(pid), snapshot: d }); }
      } catch (e) { return S(400, { error: String(e.message || e) }); }
      return false;
    },
  };
};
