/**
 * Charts view: a port of the mockup's renderCharts / drawChart / pops (jafra-z-dashboard.html 2044–2182) on contract data.
 * One chart at a time from J/charts (18 catalogue groups), views seg, range seg, trend toggle (Theil–Sen + time to limit),
 * flame entries (J/flame/{group}), bars (J/query by=…), endpoints table, slow-calls scatter, placeholders and API errors.
 */
import { $, $$, api, app, esc, icon, jvmRef, qs, rangeQ, state } from '../app/core.js';
import { ENDPOINT_TABLE, FLAME_GROUP, GROUP_ORDER, TREND_VIEWS, navEntries, planFor, visibleForGc } from '../charts/registry.js';
import { FRAME_UNIT, GROUP_KIND, flName, flTakeaway, renderFlame, toTree } from '../flame/flame.js';
import { QT, pickQuestions, rangeQuestions } from '../chat/questions.js';
import { openFlameModal } from './evidence.js';
import {
  GROUP_COLOR, LV, buildOption, chartCtx, chartRef, clock, echarts, errHTML, fetchPlan, fmt, fmtUnit, groupName, hidePops, incFelt, incTitle, isOpen, iso,
  metricLabel, overlapping, placeholderHTML, rangeStats, rincHTML, rstatsHTML, seriesStats, setOpt, showPop, tms, win,
} from './shared.js';
import { incidentCardCtx } from './dashboard.js';

const CH = { id: qs.get('chart'), view: {}, range: {}, trend: {}, chart: null, body: null, meta: null, fl: { zoom: null }, flTree: null, seq: 0 };
app.pageChart = () => CH.chart;
app.disposePage = () => { if (CH.chart) { CH.chart.dispose(); CH.chart = null; } };

const list = () => navEntries(state.chartList).filter((c) => visibleForGc(c.id, state.info?.gc?.old || ''));
const cur = () => list().find((c) => c.id === CH.id);
const isFlame = (c, v) => planFor(c, v).source === 'flame';
const vOf = (c) => CH.view[c.id] || c.views?.[0]?.id;
const CHART_IC = '<svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><path d="M3 20h18" stroke="currentColor" stroke-width="1.8" fill="none"/><path d="M5 16l4-5 4 3 6-8" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const FLAME_IC = '<svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><rect x="3" y="16" width="18" height="4" rx="1.5" fill="currentColor" opacity=".45"/><rect x="3" y="11" width="11" height="4" rx="1.5" fill="currentColor" opacity=".7"/><rect x="15" y="11" width="5" height="4" rx="1.5" fill="currentColor" opacity=".7"/><rect x="5" y="6" width="6" height="4" rx="1.5" fill="currentColor"/></svg>';
const icOf = (c) => (c.availability !== 'available' ? icon('cube', 'color:var(--ink-3)') : (c.id.endsWith('-flame') || c.views?.some((v) => v.id === 'flame')) ? FLAME_IC : CHART_IC);

function worstStretch() {
  const w = [...state.incidents].sort((a, b) => (b.level === 'critical') - (a.level === 'critical') || tms(b.t0) - tms(a.t0))[0]; if (!w) return null;
  const W = win(); const to = isOpen(w) || !w.t1 ? tms(W.to) : tms(w.t1);
  return [Math.max(tms(W.from), tms(w.t0) - 60000), Math.min(tms(W.to), to + 60000)];
}
function rangeParams(c) { const r = CH.range[c.id]; const ws = worstStretch(); return r === 'worst' && ws ? { from: iso(ws[0]), to: iso(ws[1]) } : {}; }

export function renderCharts(m, j) {
  const L = list(); if (!L.length) { m.insertAdjacentHTML('beforeend', `<section class="empty glass"><div class="inner"><h2>No charts</h2><p>J/charts returned an empty catalogue.</p></div></section>`); return; }
  if (!L.some((c) => c.id === CH.id)) CH.id = L[0].id;
  const W = win();
  m.insertAdjacentHTML('beforeend', `<section class="cp glass" id="chartsPage" data-component="ChartsPage">
    <div class="cp-head"><button type="button" class="cp-arrow" data-cpstep="-1" aria-label="Previous chart">${icon('chev', 'transform:rotate(90deg)')}</button>
      <button type="button" class="cp-sel" id="cpSel" aria-haspopup="listbox" aria-expanded="false"></button>
      <button type="button" class="cp-arrow" data-cpstep="1" aria-label="Next chart">${icon('chev', 'transform:rotate(-90deg)')}</button>
      <span class="cp-count" id="cpCount"></span><span class="cp-scope">${esc(j.workload)} · ${esc((state.info?.gc?.old || '').replace(/Old$/, '') || 'JVM')} GC · ${clock(W.from)}–${clock(W.to)} UTC</span></div>
    <div class="cp-menu glass" id="cpMenu" role="listbox" hidden><div class="search cp-search">${icon('search')}<input id="cpQ" placeholder="Search charts" autocomplete="off" aria-label="Search charts"></div><div class="cp-list" id="cpList"></div></div>
    <div class="cp-body" id="cpBody"></div></section>`);
  const pg = $('#chartsPage');
  pg.addEventListener('click', (e) => {
    const s = e.target.closest('[data-cpstep]'); if (s) { step(+s.dataset.cpstep); return; }
    if (e.target.closest('#cpSel')) { toggleMenu(); return; }
    const it = e.target.closest('[data-cpid]'); if (it) { toggleMenu(false); select(it.dataset.cpid); return; }
    const a = e.target.closest('[data-cpalt]'); if (a) { select(a.dataset.cpalt); return; }
    const sv = e.target.closest('[data-cpview]'); if (sv) { CH.view[CH.id] = sv.dataset.cpview; drawChart(); return; }
    const rg = e.target.closest('[data-cprange]'); if (rg) { CH.range[CH.id] = rg.dataset.cprange; drawChart(); return; }
    const tg = e.target.closest('[data-trend]'); if (tg) { CH.trend[CH.id] = CH.trend[CH.id] === false; drawChart(true); return; }
    const ep = e.target.closest('[data-epkey]'); if (ep) { endpointRowPop(ep, e); return; }
    if (e.target.closest('#cpAsk')) askWhole();
  });
  $('#cpQ').addEventListener('input', renderList);
  $('#cpQ').addEventListener('keydown', (e) => {
    const its = $$('#cpList [data-cpid]'); let i = its.findIndex((x) => x.classList.contains('kb'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); its.forEach((x) => x.classList.remove('kb')); i = e.key === 'ArrowDown' ? Math.min(its.length - 1, i + 1) : Math.max(0, i - 1); if (its[i]) { its[i].classList.add('kb'); its[i].scrollIntoView({ block: 'nearest' }); } }
    else if (e.key === 'Enter') { const t = its[i >= 0 ? i : 0]; if (t) { toggleMenu(false); select(t.dataset.cpid); } } else if (e.key === 'Escape') { toggleMenu(false); $('#cpSel').focus(); }
  });
  renderHead(); drawChart();
}
app.renderCharts = renderCharts;
function renderHead() {
  const c = cur(); const L = list();
  $('#cpSel').innerHTML = `<i class="cx-dot" style="background:${GROUP_COLOR[c.group]}"></i>${icOf(c)}<span class="cp-sel-t">${esc(c.title)}</span>${c.availability !== 'available' ? '<span class="ph-badge">Needs data</span>' : ''}${icon('chev', 'width:14px;height:14px')}`;
  $('#cpCount').textContent = `${L.indexOf(c) + 1} of ${L.length}`;
}
function renderList() {
  const q = ($('#cpQ').value || '').trim().toLowerCase(); const L = list();
  $('#cpList').innerHTML = GROUP_ORDER.map((g) => {
    const its = L.filter((c) => c.group === g && (!q || `${c.title} ${groupName(g)} ${(c.events || []).join(' ')} ${(c.metrics || []).join(' ')}`.toLowerCase().includes(q))); if (!its.length) return '';
    return `<div class="cp-grp"><div class="cp-gh"><i class="cx-dot" style="background:${GROUP_COLOR[g]}"></i>${esc(groupName(g))}</div>${its.map((c) => `<button type="button" class="cp-it${c.id === CH.id ? ' on' : ''}" role="option" aria-selected="${c.id === CH.id}" data-cpid="${c.id}">${icOf(c)}<span>${esc(c.title)}</span>${c.availability !== 'available' ? '<span class="ph-badge">Needs data</span>' : ''}</button>`).join('')}</div>`;
  }).join('') || `<div class="cp-none">No chart matches "${esc(q)}".</div>`;
}
function toggleMenu(open) {
  const mn = $('#cpMenu'); const b = $('#cpSel'); if (!mn) return; open = open == null ? mn.hidden : open; mn.hidden = !open; b.setAttribute('aria-expanded', open);
  if (open) { hidePops(); $('#cpQ').value = ''; renderList(); const r = b.getBoundingClientRect(); const pr = $('#chartsPage').getBoundingClientRect(); mn.style.left = `${Math.max(0, r.left - pr.left)}px`; mn.style.top = `${r.bottom - pr.top + 6}px`;
    setTimeout(() => { $('#cpQ').focus(); $('#cpList .on')?.scrollIntoView({ block: 'nearest' }); }, 0); }
}
function select(id) { CH.id = id; const u = new URL(location.href); u.searchParams.set('chart', id); history.replaceState(null, '', u); renderHead(); drawChart(); }
function step(k) { const L = list(); const i = L.findIndex((c) => c.id === CH.id); select(L[(i + k + L.length) % L.length].id); }

function trendText(tr, c) {
  if (!tr) return '';
  const mins = (m) => (m == null ? null : m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${Math.round(m % 60)} min` : ''}` : `${Math.round(m)} min`);
  const ttl = tr.time_to_limit;
  const slope = tr.slope_per_h != null ? `${tr.shape || (tr.slope_per_h > 0 ? 'rising' : 'falling')} ${fmtUnit(Math.abs(tr.slope_per_h), tr.unit)}/h` : tr.shape || '';
  let lim;
  if (tr.limit == null) lim = c.id === 'metaspace' ? 'no MaxMetaspaceSize set, so no time to limit' : 'no limit set, so no time to limit';
  else if (!ttl || ttl.mid == null) lim = `not heading to the ${esc(tr.limit_source || 'limit')}`;
  else lim = `<b>${mins(ttl.mid)}</b> to the ${esc(tr.limit_source || 'limit')} (${mins(ttl.low)}–${mins(ttl.high)})`;
  return `<span class="ttl-note">Trend (Theil–Sen${tr.significant === false ? ', not significant' : ''}): ${esc(slope)} · ${lim}</span>`;
}

async function drawChart(keepView) {
  const c = cur(); const body = $('#cpBody'); if (!c || !body) return; void keepView;
  app.disposePage(); hidePops(); const seq = ++CH.seq; CH.body = null; CH.meta = null;
  const v = vOf(c); const views = (c.views || []).length > 1 ? `<div class="seg sm" role="group" aria-label="View">${c.views.map((x) => `<button type="button" data-cpview="${x.id}" aria-pressed="${v === x.id}">${esc(x.title || x.id)}</button>`).join('')}</div>` : '';
  if (c.availability !== 'available') {
    body.innerHTML = `<div class="cp-title"><h2>${esc(c.title)}</h2><p class="cp-take">Not available for this JVM.</p></div>${placeholderHTML(c)}`; return;
  }
  const plan = planFor(c, v); const flame = plan.source === 'flame'; const ws = worstStretch();
  const trendable = TREND_VIEWS[c.id] === v; const tOn = CH.trend[c.id] !== false;
  body.innerHTML = `<div class="cp-title"><h2>${esc(c.title)}</h2><p class="cp-take" id="cpTake">Loading…</p></div>
    <div class="cp-ctl">${views}<span class="cp-range"><div class="seg sm" role="group" aria-label="Time range"><button type="button" data-cprange="all" aria-pressed="${CH.range[c.id] !== 'worst'}">Whole window</button>${ws ? `<button type="button" data-cprange="worst" aria-pressed="${CH.range[c.id] === 'worst'}">Worst stretch ${clock(ws[0])}–${clock(ws[1])}</button>` : ''}</div></span>
      ${trendable ? `<button type="button" class="btn sm tr-tog" data-trend aria-pressed="${tOn}" title="Theil–Sen trend line and time to limit">${icon('chart', 'width:13px;height:13px')}Trend</button>` : ''}
      <span class="cp-hint" id="cpHint"></span><button type="button" class="btn btn-primary sm cp-ask" id="cpAsk">${icon('sparkle', 'width:15px;height:15px')}Ask KUSMA</button></div>
    <div class="cp-chart" id="cpChart"></div><div class="cp-foot">${icon('layers', 'width:13px;height:13px')}From JFR events: <code>${esc((c.events || []).join(' · ') || (c.frames || []).map((f) => `${f} stacks`).join(' · ') || (c.metrics || []).slice(0, 4).join(' · '))}</code></div>`;
  const host = $('#cpChart');
  if (c.id === 'endpoints-overview') { await drawEndpointTable(c, host, seq); return; }
  const payload = await fetchPlan(plan, c, rangeParams(c));
  if (seq !== CH.seq || !document.body.contains(host)) return;
  CH.body = payload; CH.plan = plan;
  if (payload.error) { host.innerHTML = errHTML(payload); host.style.height = 'auto'; host.style.minHeight = '0'; $('#cpTake').textContent = 'The analyzer returned an error for this view.'; return; }
  if (flame) {
    const fl = toTree(payload); CH.flTree = fl; CH.fl = { zoom: null }; const unit = FRAME_UNIT[payload.kind] || 'samples';
    host.classList.add('is-flame'); $('#cpHint').textContent = 'Click a block to zoom and ask about it';
    renderFlame(host, fl, { unit, legend: true, take: true, st: CH.fl, empty: 'No stacks for this event in the window.', onSelect: (q, e, f) => framePop(q, e, f, unit, c) });
    const tk = fl && fl.total ? flTakeaway(fl) : null;
    $('#cpTake').innerHTML = tk ? `${tk.html} <span class="muted">· ${fl.total.toLocaleString('en-US')} ${esc(unit)} · <code>J/flame/${esc(plan.group)}${plan.kind ? `?kind=${esc(plan.kind)}` : ''}</code></span>` : 'No samples in this window.';
    return;
  }
  const option = buildOption(plan, payload, chartCtx(c, { page: true, trend: tOn }));
  const ch = echarts.init(host, null, { renderer: 'svg' }); CH.chart = ch; const meta = setOpt(ch, option); CH.meta = meta; host.dataset.kind = meta.kind || '';
  const tr = payload.trend; const sum = payload.summary || (payload.value != null ? `${metricLabel(payload.metric)} ${payload.stat || ''} ${fmtUnit(payload.value, payload.unit)}` : '');
  $('#cpTake').innerHTML = `${esc(sum)}${trendable && tOn ? ` ${trendText(tr, c)}` : ''}`;
  if (meta.kind === 'ts' || meta.kind === 'scatter-calls') {
    ch.dispatchAction({ type: 'takeGlobalCursor', key: 'brush', brushOption: { brushType: 'lineX', brushMode: 'single' } });
    ch.on('brushEnd', (p) => { const a = p.areas && p.areas[0]; if (!a) return; const [x0, x1] = a.coordRange; rangePop(Math.round(x0), Math.round(x1)); });
    $('#cpHint').textContent = meta.kind === 'scatter-calls' ? 'Click a call for its flame graph · drag to pick a range' : 'Click a point to ask · drag across the chart to pick a range';
  } else if (meta.kind === 'bars') $('#cpHint').textContent = c.id === 'slow-breakdown' ? 'Click a wait cause to open the calls\u2019 flame graph' : 'Click a bar to ask about it';
  ch.on('click', (p) => {
    if (p.componentType === 'markPoint' && p.data?.id) { incidentPop(p.data.id, p.event?.event); return; }
    if (meta.kind === 'bars' && p.componentType === 'series') { barPop(p.dataIndex, p.event?.event, c); return; }
    if (meta.kind === 'scatter-calls' && p.data?.ev) { slowCallPop(p.data.ev, p.event?.event, c); return; }
    if (meta.kind === 'ts' && p.componentType === 'series' && Array.isArray(p.value)) pointPop(p.value[0], p.event?.event, c);
  });
  if (meta.kind === 'ts') ch.getZr().on('click', (e) => { if (e.target) return; const t = ch.convertFromPixel({ xAxisIndex: 0 }, e.offsetX); const g = ch.convertFromPixel({ gridIndex: 0 }, [e.offsetX, e.offsetY]); if (t == null || !ch.containPixel({ gridIndex: 0 }, [e.offsetX, e.offsetY])) return; void g; pointPop(t, e.event, c); });
}
app.chartsLive = () => { if (state.page === 'charts' && cur() && !$('#cxPop:not([hidden])') && CH.range[CH.id] !== 'worst') drawChart(true); };
window.addEventListener('resize', () => { CH.chart?.resize(); if (CH.flTree && $('#cpChart.is-flame')) { /* flame redraws itself on resize */ } });

/* ---------------- endpoints-overview table (calls/avg/max/count, % over 500 ms) ---------------- */
async function drawEndpointTable(c, host, seq) {
  const ref = jvmRef(state.selected); const rp = rangeParams(c); const r = rp.from ? rp : rangeQ();
  const res = await Promise.all(ENDPOINT_TABLE.map(([metric, stat]) => api.client.query(ref, { ...r, metric, by: 'handler', stat }).then((b) => ({ b }), (e) => ({ e: e.body || e }))));
  if (seq !== CH.seq) return;
  const err = res.find((x) => x.e); if (err && res.every((x) => x.e)) { host.innerHTML = errHTML(err.e); host.style.height = 'auto'; $('#cpTake').textContent = 'The analyzer returned an error for this view.'; return; }
  const keys = new Map();
  res.forEach((x, i) => (x.b?.rows || []).forEach((row) => { if (!keys.has(row.key)) keys.set(row.key, {}); keys.get(row.key)[i] = { v: row.value, unit: x.b.unit }; }));
  const rows = [...keys.entries()].sort((a, b) => (b[1][0]?.v || 0) - (a[1][0]?.v || 0));
  CH.ep = rows;
  host.style.height = 'auto'; host.style.minHeight = '0'; host.dataset.kind = 'table';
  host.innerHTML = rows.length ? `<table class="ep-table"><thead><tr><th>Endpoint</th>${ENDPOINT_TABLE.map(([, , l]) => `<th class="num">${esc(l)}</th>`).join('')}</tr></thead><tbody>${rows.map(([k, cells], ri) => `<tr data-epkey="${ri}"><td><code>${esc(k)}</code></td>${ENDPOINT_TABLE.map(([m], i) => { const x = cells[i]; const hot = m === 'endpoint.slow.pct' && x?.v > 5; return `<td class="num${hot ? ' hot' : ''}">${x ? esc(m.endsWith('.pct') ? `${fmt(x.v)}%` : fmtUnit(x.v, x.unit)) : '–'}</td>`; }).join('')}</tr>`).join('')}</tbody></table>` : '<p class="muted">No endpoint calls in this window.</p>';
  $('#cpTake').innerHTML = rows.length ? `${rows.length} endpoint${rows.length > 1 ? 's' : ''}; busiest <code>${esc(rows[0][0])}</code>. <span class="muted">J/query by=handler for calls/s, avg, max, slow count and % over 500 ms.</span>` : 'No endpoint calls in this window.';
  $('#cpHint').textContent = 'Click a row to ask about an endpoint';
}
function endpointRowPop(tr, e) {
  const c = cur(); const [k, cells] = CH.ep[+tr.dataset.epkey]; const vals = ENDPOINT_TABLE.map(([m, stat, l], i) => ({ metric: m, stat, label: l, value: cells[i]?.v ?? null, unit: cells[i]?.unit || null }));
  const val = vals.map((x) => `${x.label} ${x.value == null ? '–' : x.metric.endsWith('.pct') ? `${fmt(x.value)}%` : fmtUnit(x.value, x.unit)}`).join(' · ');
  showPop({ ic: 'chart', head: esc(k), sub: esc(val), qs: QT.bar({ name: k, rank: +tr.dataset.epkey + 1, what: 'endpoint by calls/s', val: vals[0].value == null ? '–' : fmtUnit(vals[0].value, vals[0].unit) }), x: e.clientX, y: e.clientY,
    card: wholeCard(c, { kind: 'bar', by: 'handler', key: k, rank: +tr.dataset.epkey + 1, values: vals }, k, val) });
}

/* ---------------- pops (mockup openPointPop / RangePop / BarPop / FramePop / askWhole) ---------------- */
function wholeCard(c, selection, short, details) {
  const W = win(); const rp = rangeParams(c);
  return { key: `cx:${c.id}:${JSON.stringify(selection).slice(0, 80)}`, group: c.group, label: `${c.title} · ${short}`, when: rp.from ? `${clock(rp.from)}–${clock(rp.to)} UTC` : `${clock(W.from)}–${clock(W.to)} UTC`, details,
    chart: chartRef(c, vOf(c)), selection, spark: CH.body?.series?.[0]?.points };
}
function pointPop(t, ev, c) {
  const body = CH.body; if (!body?.series) return;
  const vals = body.series.map((s) => { let best = null; let bd = Infinity; for (const p of s.points || []) { const pt = Array.isArray(p) ? [tms(p[0]), p[1]] : [tms(p.t), p.v]; const d = Math.abs(pt[0] - t); if (d < bd && pt[1] != null) { bd = d; best = pt; } } return best ? { metric: s.metric, unit: s.unit, t: best[0], v: best[1] } : null; }).filter(Boolean);
  if (!vals.length) return; const s = vals[0]; const tt = s.t;
  const all = (body.series[0].points || []).map((p) => (Array.isArray(p) ? p[1] : p.v)).filter((v) => v != null).sort((a, b) => a - b); const med = all.length ? all[Math.floor(all.length / 2)] : null;
  const inc = overlapping(tt - 10000, tt + 10000);
  const [f, u] = [1, '']; void f;
  const q = QT.point({ q: metricLabel(s.metric).toLowerCase(), v: s.v, u, t: tt, med }).map((x) => x.replace(/(\d[\d.,]*)(?=\s)/, (m) => m));
  showPop({ head: `${esc(metricLabel(s.metric))} · ${clock(tt)}`, sub: `${vals.slice(0, 3).map((z) => `${esc(metricLabel(z.metric))} <b>${esc(fmtUnit(z.v, z.unit))}</b>`).join(' · ')}${inc.length ? ` · during <b>${esc(incTitle(inc[0]))}</b>` : ''}`,
    qs: [...q.map((x) => x.replace(fmt(s.v), fmtUnit(s.v, s.unit)).replace(fmt(med), fmtUnit(med, s.unit))), ...(inc.length ? [`Is the ${incTitle(inc[0]).toLowerCase()} incident related to ${metricLabel(s.metric).toLowerCase()} at ${clock(tt)}?`] : [])],
    x: ev?.clientX ?? 0, y: ev?.clientY ?? 0,
    card: wholeCard(c, { kind: 'point', t: iso(tt), values: vals.map((z) => ({ metric: z.metric, unit: z.unit, value: z.v })), median: med, incidents: inc.map((x) => x.id) }, `${metricLabel(s.metric)} at ${clock(tt)}`, vals.slice(0, 3).map((z) => `${metricLabel(z.metric)} ${fmtUnit(z.v, z.unit)}`).join(' · ')) });
}
async function rangePop(a, b) {
  const c = cur(); if (!c || !(b - a >= 1000) || !CH.chart) return;
  const vals = seriesStats(CH.body, a, b); const st = await rangeStats(a, b); const inc = overlapping(a, b); const s = vals[0];
  const stats = s ? { q: metricLabel(s.metric).toLowerCase(), u: '', f: s.first, l: s.last, mx: s.max, tm: tms(s.max_at), a, b, inc: inc.length } : null;
  let Q = rangeQuestions(CH.body, state.persona, a, b, stats);
  if (!CH.body?.range_questions?.[state.persona === 'expert' ? 'expert' : 'developer'] && stats) {
    Q = QT.range(stats).map((x) => x.replaceAll(fmt(s.first), fmtUnit(s.first, s.unit)).replaceAll(fmt(s.last), fmtUnit(s.last, s.unit)).replaceAll(fmt(s.max), fmtUnit(s.max, s.unit)));
  }
  const px = CH.chart.convertToPixel({ xAxisIndex: 0 }, (a + b) / 2); const cr = $('#cpChart').getBoundingClientRect();
  showPop({ ic: 'clock', head: `${clock(a)}–${clock(b)} · ${Math.round((b - a) / 1000)} s`, sub: s ? `${esc(metricLabel(s.metric))} ${esc(fmtUnit(s.first, s.unit))} → <b>${esc(fmtUnit(s.last, s.unit))}</b> · peak ${esc(fmtUnit(s.max, s.unit))} at ${clock(s.max_at)}` : 'Compared with this window\u2019s normal (J/report).',
    extra: rstatsHTML(st, 3) + rincHTML(inc), qs: Q, x: cr.left + px, y: cr.top + cr.height * 0.55, foot: 'Attaches this range to KUSMA as context',
    card: wholeCard(c, { kind: 'range', from: iso(a), to: iso(b), values: vals, vs_normal: st.slice(0, 4).map((r) => ({ group: r.g, metric: r.metric, stat: r.stat, value: r.v, unit: r.unit, normal: r.base, ratio: r.x })), incidents: inc.map((x) => x.id) }, `${clock(a)}–${clock(b)}`, s ? `${metricLabel(s.metric)} ${fmtUnit(s.first, s.unit)}→${fmtUnit(s.last, s.unit)}` : '') });
}
function barPop(i, ev, c) {
  const m = CH.meta; const row = m.rows?.[i]; if (!row) return; const name = String(row.key); const rank = m.rows.length - i; const val = `${fmt(m.vals[i])}${m.s}`;
  const sel = { kind: 'bar', metric: CH.body.metric, by: CH.plan.by, stat: CH.body.stat || CH.plan.stat || null, key: row.key, value: row.value, unit: CH.body.unit, share_pct: row.share_pct ?? null, rank };
  if (c.id === 'slow-breakdown') {
    const rp = rangeParams(c); const W = win();
    showPop({ ic: 'chart', head: esc(name), sub: `${esc(m.what)} · ${esc(val)}`, qs: QT.bar({ name, rank, what: m.what, val }), primary: 'Open the calls\u2019 flame graph', x: ev?.clientX ?? 0, y: ev?.clientY ?? 0, card: wholeCard(c, sel, name, `${m.what}: ${name} · ${val}`) });
    const btn = $('#cxPop [data-pprimary]'); if (btn) btn.onclick = (e) => { e.stopPropagation(); hidePops(); openFlameModal({ title: `Slow calls · ${esc(name)}`, sub: `<code>J/flame/endpoint?kind=wall</code> · wait cause <b>${esc(name)}</b> · ${clock(rp.from || W.from)}–${clock(rp.to || W.to)} UTC`, group: 'endpoint', kind: 'wall', from: rp.from || W.from, to: rp.to || W.to, onSelect: (q, e2, f) => framePop(q, e2, f, FRAME_UNIT.wall, c) }); };
    return;
  }
  showPop({ ic: 'chart', head: esc(name), sub: `${esc(m.what)} · ${esc(val)}`, qs: QT.bar({ name, rank, what: m.what, val }), x: ev?.clientX ?? 0, y: ev?.clientY ?? 0, card: wholeCard(c, sel, name, `${m.what}: ${name} · ${val}`) });
}
function slowCallPop(evt, ev, c) {
  const t = tms(evt.t); const durMs = (evt.duration_us || 0) / 1000; const from = iso(t - Math.max(1000, durMs)); const to = iso(t + 1000);
  const name = evt.handler || evt.endpoint || evt.name || 'slow call';
  showPop({ ic: 'clock', head: `${esc(name)} · ${fmt(durMs)} ms`, sub: `at ${clock(t)}${evt.wait_cause ? ` · waiting on <b>${esc(evt.wait_cause)}</b>` : ''}`, qs: [`Why did ${name} take ${fmt(durMs)} ms at ${clock(t)}?`, `What was ${name} waiting on at ${clock(t)}?`, `Is ${fmt(durMs)} ms normal for ${name}?`],
    primary: 'Open this call\u2019s flame graph', x: ev?.clientX ?? 0, y: ev?.clientY ?? 0,
    card: wholeCard(c, { kind: 'point', t: iso(t), event: evt }, `${name} at ${clock(t)}`, `${fmt(durMs)} ms`) });
  const btn = $('#cxPop [data-pprimary]'); if (btn) btn.onclick = (e) => { e.stopPropagation(); hidePops(); openFlameModal({ title: `Slow call · ${esc(name)}`, sub: `<code>J/flame/endpoint?kind=wall</code> · ${clock(from)}–${clock(to)} UTC · ${fmt(durMs)} ms`, group: 'endpoint', kind: 'wall', from, to, onSelect: (q, e2, f) => framePop(q, e2, f, FRAME_UNIT.wall, c) }); };
}
function framePop(q, e, fl, unit, c) {
  const raw = q.n[4] || q.n[0]; const name = flName(q.n); const pct = q.n[1] / fl.total * 100; const cat = q.n[3];
  const card = wholeCard(c, { kind: 'frame', frame: raw, category: cat, samples: q.n[1], total: fl.total, pct: +pct.toFixed(2), frame_kind: fl.kind || GROUP_KIND[c.group] || null, path: q.p }, name, `${raw} · ${fmt(pct)}% (${q.n[1]} of ${fl.total} ${unit})`);
  showPop({ ic: 'code', col: 'var(--periwinkle-strong)', head: esc(name), sub: `${esc({ app: 'Your code', jdk: 'Java / JDK', jvm: 'JVM native', sys: 'Kernel / other' }[cat] || '')} · <b>${fmt(pct)}%</b> of ${esc(unit)} (${q.n[1].toLocaleString('en-US')})`,
    extra: raw !== name ? `<code class="cx-raw">${esc(raw)}</code>` : '', qs: QT.frame({ name, pct, unit, cat }), x: e.clientX, y: e.clientY, card });
}
function incidentPop(id, ev) {
  const x = state.incidents.find((z) => z.id === id); if (!x) return; const card = incidentCardCtx(x); card.chart = chartRef(cur(), vOf(cur()));
  showPop({ ic: 'alert', col: LV[x.level], head: esc(incTitle(x)), sub: `${clock(x.t0)}–${isOpen(x) || !x.t1 ? 'now' : clock(x.t1)} · ${esc(incFelt(x))}`, qs: pickQuestions(x, state.persona, 'chart-marker'), x: ev?.clientX ?? 0, y: ev?.clientY ?? 0, card,
    foot: `Attaches this incident to KUSMA · <button type="button" class="linkish" data-rinc="${esc(x.id)}">Open incident card</button>` });
}
function askWhole() {
  const c = cur(); const t = c.title.toLowerCase(); const r = $('#cpAsk').getBoundingClientRect(); const tk = ($('#cpTake')?.textContent || '').trim(); const rp = rangeParams(c); const W = win();
  showPop({ ic: 'sparkle', head: esc(c.title), sub: esc(tk).slice(0, 220), qs: (CH.body?.questions && pickQuestions(CH.body, state.persona, 'chart')) || [`Explain the ${t} chart for this JVM.`, `What stands out in ${t}?`, `Is anything in ${t} linked to the incidents?`, 'What should I change based on this chart?'],
    x: r.left + r.width / 2, y: r.bottom, card: wholeCard(c, { kind: 'chart', from: rp.from || W.from, to: rp.to || W.to }, 'whole chart', tk.slice(0, 200)) });
}
