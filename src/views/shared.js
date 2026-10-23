/** Shared view helpers: data per plan, chart ctx, pops (mockup showCxPop / ap-pop), errors, placeholders, range stats. */
import * as echarts from 'echarts';
import { $, api, app, esc, icon, jvmRef, rangeQ, state, chartTheme } from '../app/core.js';
import { GROUP_COLOR, GROUP_LABEL, LVL_COLOR, buildOption, clock, fmt, fmtUnit, metricLabel, placeholderCopy, tms } from '../charts/registry.js';
import { typeTitle } from '../incidents/model.js';

export { echarts };
export const LV = { critical: LVL_COLOR.crit, warning: LVL_COLOR.warn, info: LVL_COLOR.info };
export const incTitle = (x) => typeTitle(x.type);
export const incFelt = (x) => x.felt || x.headline || '';
export const isOpen = (x) => x.status === 'open';
export const groupName = (g) => GROUP_LABEL[g] || g;
export const win = () => state.timeline?.window || state.report?.window || {};

/** ctx.incidents for timeOption (contract incident list → markArea/markPoint). */
export function ctxIncidents(filter) {
  return (state.incidents || []).filter(filter || (() => true)).map((x) => ({ id: x.id, level: x.level, t0: x.t0, t1: isOpen(x) ? null : x.t1, peak_at: x.peak_at, title: incTitle(x), felt: incFelt(x), status: x.status }));
}
export function chartCtx(chart, extra = {}) {
  const w = win();
  return { theme: chartTheme(), color: GROUP_COLOR[chart.group], incidents: ctxIncidents((x) => x.group === chart.group), trend: true, brush: true, xMin: tms(w.from), xMax: tms(w.to), ...extra };
}
/** Fetch one plan (registry.planFor) → payload, or the contract error body (never throws). */
export async function fetchPlan(plan, chart, q = {}) {
  const ref = jvmRef(state.selected); const c = api.client; const r = q.from ? { ...q } : { ...rangeQ(), ...q };
  try {
    if (plan.source === 'flame') return await c.flame(ref, plan.group, { ...r, ...(plan.kind ? { kind: plan.kind } : {}) });
    if (plan.source === 'query') return await c.query(ref, { ...r, metric: plan.metric, ...(plan.by ? { by: plan.by } : {}), ...(plan.stat ? { stat: plan.stat } : {}), ...(plan.step ? { step: typeof plan.step === 'string' ? plan.step : '15s' } : {}) });
    return await c.chart(ref, chart.id, { ...r, view: plan.view });
  } catch (e) { return e.body || { error: 'network', message: e.message, hint: 'Check the analyzer in Settings.', valid: [] }; }
}
export function setOpt(c, option) { const { _meta, ...o } = option; c.setOption(o, { notMerge: true }); return _meta || {}; }

/** API error ({error,message,hint,valid}) in place of a chart (decision 8). */
export function errHTML(e) {
  const b = e?.body || e || {};
  return `<div class="api-err" role="alert">${icon('alert', 'width:16px;height:16px;color:var(--err)')}<div><b>${esc(b.message || b.error || 'Request failed')}</b>${b.error ? ` <code>${esc(b.error)}</code>` : ''}${b.hint ? `<p>${esc(b.hint)}</p>` : ''}${Array.isArray(b.valid) && b.valid.length ? `<p class="muted">Valid: ${b.valid.slice(0, 8).map((v) => `<code>${esc(v)}</code>`).join(' ')}${b.valid.length > 8 ? ' …' : ''}</p>` : ''}</div></div>`;
}
/** Mockup cp-ph placeholder (needs / why / alt). */
export function placeholderHTML(chart, compact) {
  const p = placeholderCopy(chart.availability, chart) || { needs: chart.availability, why: 'This view is not available for this JVM.', alt: null };
  const alt = p.alt && state.chartList.find((c) => c.id === p.alt);
  return `<div class="cp-ph${compact ? ' sm' : ''}" data-placeholder="${esc(chart.id)}"><svg viewBox="0 0 120 80" width="${compact ? 80 : 120}" height="${compact ? 54 : 80}" aria-hidden="true">${[0, 1, 2, 3, 4, 5].map((i) => [0, 1, 2, 3].map((j) => `<rect x="${6 + i * 18}" y="${6 + j * 18}" width="15" height="15" rx="3" fill="${['#9FA1FF', '#F9B2D7', '#FFF0BE', '#D9F9DF'][(i + j * 2) % 4]}" opacity="${0.25 + ((i * 7 + j * 3) % 5) / 10}"/>`).join('')).join('')}</svg>
    <h3>This view needs data the recording does not have</h3><p>${esc(p.why)}</p><p class="ph-need"><b>Needs:</b> <code>${esc(p.needs)}</code></p>${alt ? `<button type="button" class="btn sm" data-cpalt="${alt.id}">Open ${esc(alt.title)} instead</button>` : ''}</div>`;
}

/** Contract chart object for the context block. */
export const chartRef = (chart, view) => (chart ? { id: chart.id, title: chart.title, view: view || chart.views?.[0]?.id || null, metrics: chart.metrics || [], events: chart.events || [], frames: chart.frames || [] } : null);
export const TIMELINE_CHART = { id: 'timeline', title: 'Timeline', group: null, views: [{ id: 'lanes' }], metrics: [], events: [], frames: [] };

/* ---------------- brush → range summary (J/query stats vs the report's normal) ---------------- */
export async function rangeStats(a, b, n = 6) {
  const ref = jvmRef(state.selected);
  const gs = (state.report?.groups || []).filter((g) => g.metric && g.state !== 'unavailable').slice(0, n);
  const from = new Date(a).toISOString(); const to = new Date(b).toISOString();
  const out = await Promise.all(gs.map(async (g) => {
    try { const r = await api.client.query(ref, { metric: g.metric, stat: g.stat || 'avg', from, to }); return { g: g.group, metric: g.metric, stat: g.stat || 'avg', v: r.value, unit: r.unit || g.unit, base: g.normal, x: g.normal > 0 && r.value != null ? r.value / g.normal : null }; } catch { return null; }
  }));
  return out.filter((r) => r && r.v != null).sort((p, q) => (q.x || 0) - (p.x || 0));
}
export const overlapping = (a, b) => (state.incidents || []).filter((x) => tms(x.t0) <= b && (isOpen(x) || !x.t1 ? Infinity : tms(x.t1)) >= a).sort((p, q) => (q.level === 'critical') - (p.level === 'critical'));
export function rstatsHTML(st, k = 5) {
  return `<div class="rstats">${st.slice(0, k).map((r) => `<div class="rs ${r.x >= 3 ? 'hot' : r.x >= 1.5 ? 'warm' : ''}"><span class="rn">${esc(groupName(r.g))}</span><span class="rv"><b>${esc(fmtUnit(r.v, r.unit))}</b> <small>${esc(metricLabel(r.metric))}</small></span><span class="rx" title="normal: ${esc(fmtUnit(r.base, r.unit))}">${r.x == null ? 'new' : r.x >= 100 ? 'from ~0' : r.x >= 1.05 || r.x <= 0.95 ? `×${fmt(r.x)}` : 'normal'}</span></div>`).join('')}</div>`;
}
export function rincHTML(inc) {
  return inc.length ? `<div class="rinc"><b>${inc.length} incident${inc.length > 1 ? 's' : ''} overlap:</b> ${inc.slice(0, 4).map((x) => `<button type="button" class="chipx" data-rinc="${esc(x.id)}"><i style="background:${LV[x.level]}"></i>${esc(incTitle(x))}</button>`).join('')}</div>` : '<div class="rinc muted">No incident overlaps this range.</div>';
}

/* ---------------- sparkline (mockup sparkFromSeries) ---------------- */
export function spark(points, w = 86, h = 34, col = '#7F81F2') {
  const ys = (points || []).map((p) => (Array.isArray(p) ? p[1] : p.v) || 0); if (ys.length < 2) return '';
  const mn = Math.min(...ys); const mx = Math.max(...ys); const n = ys.length - 1;
  const X = (i) => (i / n * (w - 4) + 2).toFixed(1); const Y = (v) => (h - 3 - (v - mn) / (mx - mn || 1) * (h - 8)).toFixed(1);
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${ys.map((v, i) => `${X(i)},${Y(v)}`).join(' ')}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}

/* ---------------- one shared ask-pop (mockup showCxPop), placed in #main ---------------- */
export function hidePops() {
  ['#anomalyPop', '#rangePop', '#cxPop'].forEach((s) => { const p = $(s); if (p) p.hidden = true; });
  (app.brushables?.() || []).forEach((c) => { try { c.dispatchAction({ type: 'brush', areas: [] }); } catch { /* disposed */ } });
}
app.hidePops = hidePops;
/**
 * o = {id:'cxPop'|'anomalyPop'|'rangePop', ic, col, head, sub, extra, qs:[...], own:boolean, foot, card, x, y, onInc}
 * Clicking a question attaches o.card and sends the question (mockup).
 */
export function showPop(o) {
  const main = $('#main'); let pop = $(`#${o.id || 'cxPop'}`);
  if (!pop) { main.insertAdjacentHTML('beforeend', `<div class="anomaly-pop${o.id === 'rangePop' ? ' range-pop' : o.id === 'anomalyPop' ? '' : ' cx-pop'}" id="${o.id || 'cxPop'}" role="dialog" hidden></div>`); pop = $(`#${o.id || 'cxPop'}`); }
  ['#anomalyPop', '#rangePop', '#cxPop'].forEach((s) => { const p = $(s); if (p && p !== pop) p.hidden = true; });
  const Q = (o.qs || []).filter(Boolean).slice(0, 5);
  pop.setAttribute('aria-label', o.label || 'Suggested questions');
  pop.innerHTML = `<div class="ap-head">${icon(o.ic || 'chart', `color:${o.col || 'var(--pink-strong)'}`)}<h4>${o.head}</h4><button class="icon-btn" style="width:28px;height:28px" aria-label="Close" data-pclose>${icon('x', 'width:14px;height:14px')}</button></div>
    ${o.sub ? `<div class="ap-sub">${o.sub}</div>` : ''}${o.extra || ''}${Q.map((q, k) => `<button class="q" data-k="${k}" style="--i:${k}">${icon('q', 'width:15px;height:15px')}<span>${esc(q)}</span></button>`).join('')}
    ${o.primary ? `<button class="btn btn-primary sm wide" data-pprimary>${icon('sparkle', 'width:15px;height:15px')}${esc(o.primary)}</button>` : ''}
    ${o.own !== false && !o.primary ? `<button type="button" class="cx-own" data-pown>${icon('sparkle', 'width:14px;height:14px')}Ask your own question</button>` : ''}
    <div class="ap-foot">${icon('chart', 'width:13px;height:13px')}${o.foot || 'Attaches this selection to KUSMA as context'}</div>`;
  pop.hidden = false; pop.classList.remove('above');
  const mr = main.getBoundingClientRect(); const W = pop.offsetWidth; const H = pop.offsetHeight; const BW = main.clientWidth;
  const left = Math.max(8, Math.min(BW - W - 8, o.x - mr.left - W / 2)); let top = o.y - mr.top + main.scrollTop + 14;
  if (o.y + 14 + H > innerHeight - 8 && o.y - H - 14 > mr.top) { top = o.y - mr.top + main.scrollTop - H - 14; pop.classList.add('above'); }
  pop.style.left = `${left}px`; pop.style.top = `${top}px`; pop.style.setProperty('--arrow-x', `${Math.max(16, Math.min(W - 16, o.x - mr.left - left))}px`);
  pop.onclick = (e) => {
    if (e.target.closest('[data-pclose]')) { hidePops(); return; }
    const r = e.target.closest('[data-rinc]'); if (r) { hidePops(); app.openIncident?.(r.dataset.rinc); return; }
    if (e.target.closest('[data-pown]')) { app.attachCard(o.card); hidePops(); app.openChat(true); setTimeout(() => $('#input')?.focus(), 0); return; }
    if (e.target.closest('[data-pprimary]')) { app.attachCard(o.card); hidePops(); app.openChat(true); if (o.primaryText) app.setInput(o.primaryText); $('#input')?.focus(); return; }
    const b = e.target.closest('button.q'); if (!b) return;
    app.attachCard(o.card); hidePops(); app.openChat(true); app.setInput(Q[+b.dataset.k]); app.submit();
  };
  const r = pop.getBoundingClientRect(); if (r.bottom > mr.bottom) main.scrollBy({ top: r.bottom - mr.bottom + 16, behavior: 'smooth' });
  pop.querySelector('button.q,[data-pprimary]')?.focus({ preventScroll: true });
  return pop;
}

/** Selection values from a time-series body over [a,b] (exact values for the context block). */
export function seriesStats(body, a, b) {
  return (body?.series || []).map((s) => {
    const pts = (s.points || []).map((p) => (Array.isArray(p) ? [tms(p[0]), p[1]] : [tms(p.t), p.v])).filter((p) => p[0] >= a && p[0] <= b && p[1] != null);
    if (!pts.length) return null;
    let mx = pts[0]; let mn = pts[0]; let sum = 0; for (const p of pts) { if (p[1] > mx[1]) mx = p; if (p[1] < mn[1]) mn = p; sum += p[1]; }
    return { metric: s.metric, unit: s.unit, first: pts[0][1], last: pts[pts.length - 1][1], min: mn[1], max: mx[1], max_at: new Date(mx[0]).toISOString(), avg: sum / pts.length, n: pts.length };
  }).filter(Boolean);
}
export const iso = (ms) => new Date(ms).toISOString();
export { clock, fmt, fmtUnit, metricLabel, tms, buildOption, GROUP_COLOR, GROUP_LABEL };
