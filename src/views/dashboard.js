/**
 * Incidents view: a port of the mockup's renderDashboard (jafra-z-dashboard.html 1438–1700) on contract data:
 * DashboardHeader (tally, layout, health boxes from J/report) · IncidentTimeline (lanes from J/timeline, charts/lanes.js) ·
 * Incidents list + IncidentCard (J/incidents, J/incidents/{id}) · Needs attention (top 4 groups, primary chart each) ·
 * Healthy / other (sparklines from J/query?step) · anomaly pop (marker click) · range pop (brush on any chart or lane).
 */
import { $, $$, app, esc, icon, qs, state, chartTheme } from '../app/core.js';
import { refreshLive, renderMain, setPage } from '../app/shell.js';
import { PRIMARY, PRIMARY_VIEW, planFor } from '../charts/registry.js';
import { laneGroups, laneHeight, laneOption } from '../charts/lanes.js';
import { CONF_TIP, cardModel } from '../incidents/model.js';
import { questionsFor } from '../chat/questions.js';
import { api } from '../app/core.js';
import { jvmRef, rangeQ } from '../app/core.js';
import {
  GROUP_COLOR, LV, TIMELINE_CHART, buildOption, chartCtx, chartRef, clock, echarts, errHTML, fetchPlan, fmt, fmtUnit, groupName, hidePops, incFelt, incTitle,
  isOpen, iso, metricLabel, overlapping, placeholderHTML, rangeStats, rincHTML, rstatsHTML, seriesStats, setOpt, showPop, spark, tms, win,
} from './shared.js';

const DASH = { layout: 'grid', inc: null, incPinned: false, expanded: new Set(), charts: {}, bodies: {}, metas: {}, seek: null, zoom: null, top: '', detail: {}, jvm: null };
const ST = { critical: 'crit', warning: 'warn', ok: 'ok', unavailable: 'off' };
const STL = { crit: 'critical', warn: 'warning', ok: 'ok', off: 'off' };
const SEV = { critical: 2, warning: 1 };

app.brushables = () => [...Object.values(DASH.charts), ...(DASH.seek ? [DASH.seek] : []), ...(app.pageChart ? [app.pageChart()] : [])].filter(Boolean);
app.disposeCharts = () => {
  Object.values(DASH.charts).forEach((c) => c.dispose()); DASH.charts = {};
  if (DASH.seek) { DASH.seek.dispose(); DASH.seek = null; }
  app.disposePage?.();
};

const groups = () => state.report?.groups || [];
const gOf = (g) => groups().find((x) => x.group === g) || { group: g, state: 'ok' };
const stOf = (g) => ST[gOf(g).state] || 'ok';
const incsOf = (g) => state.incidents.filter((x) => x.group === g);
const worstOf = (g) => incsOf(g).sort((a, b) => (isOpen(b) - isOpen(a)) || ((SEV[b.level] || 0) - (SEV[a.level] || 0)))[0];
const primaryChart = (g) => state.chartList.find((c) => c.id === PRIMARY[g]);
function kpi(g) {
  const x = gOf(g);
  if (x.state === 'unavailable') return (x.flags || []).includes('nmt_off') ? 'NMT is off on this JVM' : 'Not available on this JVM';
  if (x.value == null) return 'No samples in this window';
  return `${metricLabel(x.metric)} ${x.stat || 'avg'} ${fmtUnit(x.value, x.unit)}${x.normal != null ? ` · normally ${fmtUnit(x.normal, x.unit)}` : ''}${x.vs_normal != null && Math.abs(x.vs_normal - 1) > 0.05 ? ` (×${fmt(x.vs_normal)})` : ''}`;
}
/** Report rank: worst state first, then open incidents, then distance from normal (mockup liveRank). */
function rank() {
  const r = { critical: 3, warning: 2, ok: 1, unavailable: 0 };
  return groups().filter((g) => g.state !== 'unavailable').sort((a, b) => (r[b.state] - r[a.state]) || ((b.open_incidents || []).length - (a.open_incidents || []).length) || ((b.vs_normal || 0) - (a.vs_normal || 0))).map((g) => g.group);
}
function headTally() { const o = state.incidents.filter(isOpen).length; const n = state.incidents.length; return `<b>${o}</b> open · <b>${n}</b> incident${n === 1 ? '' : 's'} in this window`; }
function healthHTML() {
  const chip = (g) => { const x = gOf(g); const n = incsOf(g).length; const top = worstOf(g);
    return `<button type="button" role="listitem" class="hchip" data-sub="${g}" data-st="${stOf(g)}" title="${esc(top ? incFelt(top) : 'No incident in this window')}" aria-label="${esc(groupName(g))}: ${n} incident${n === 1 ? '' : 's'}"><i class="sw" style="background:${GROUP_COLOR[g]}"></i>${esc(groupName(g))}<span class="n" aria-hidden="true">${n}</span></button>`; void x; };
  const order = groups().filter((g) => g.state !== 'unavailable').map((g) => g.group);
  return [['crit', 'Critical'], ['warn', 'Warning'], ['ok', 'OK']].map(([st, lbl]) => { const ss = order.filter((g) => stOf(g) === st);
    return `<div class="hbox" data-st="${st}" role="group" aria-label="${lbl}: ${ss.length} subsystem${ss.length === 1 ? '' : 's'}"><div class="hb-h"><span>${lbl}</span><b>${ss.length}</b></div>
      <div class="hb-chips" role="list">${ss.length ? ss.map(chip).join('') : '<span class="hb-none">None</span>'}</div></div>`; }).join('');
}
function liveCtlHTML() {
  const to = win().to;
  return `<span class="lv-state ${state.live ? 'on' : ''}"><i></i>${state.live ? 'Live' : state.pending ? 'Paused · new data' : 'Paused'}</span>
    <span class="lv-pos">window to <b>${clock(to)}Z</b> · every 5 s</span>
    <button type="button" class="lv-btn" data-live="toggle" aria-label="${state.live ? 'Pause live updates' : 'Resume live updates'}" title="${state.live ? 'Pause' : 'Resume'}">${state.live ? '<svg viewBox="0 0 24 24" class="icon"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>' : '<svg viewBox="0 0 24 24" class="icon"><path d="M7 5v14l12-7z"/></svg>'}</button>
    <button type="button" class="lv-btn" data-live="end" aria-label="Jump to the latest window" title="Jump to the latest window"><svg viewBox="0 0 24 24" class="icon"><path d="M6 5l8 7-8 7z"/><path d="M18 5v14"/></svg></button>`;
}
app.syncLive = () => { const c = $('#liveCtl'); if (c) c.innerHTML = liveCtlHTML(); };

/* ---------------- incidents list + card (mockup incidentsHTML / incidentCard) ---------------- */
function sortedIncs() { return [...state.incidents].sort((a, b) => (isOpen(b) - isOpen(a)) || ((SEV[b.level] || 0) - (SEV[a.level] || 0)) || (tms(b.t0) - tms(a.t0))); }
function incidentsHTML() {
  const v = sortedIncs();
  if (!v.length) return `<div class="inc-empty glass"><svg viewBox="0 0 64 40" width="64" height="40" aria-hidden="true"><path d="M2 30 Q12 22 20 26 T38 20 T62 14" fill="none" stroke="#9FA1FF" stroke-width="2.4" stroke-linecap="round"/><circle cx="62" cy="14" r="3" fill="#D9F9DF" stroke="#3BB273"/></svg><div><b>No incidents yet</b><br><span>Each 5 s chunk is checked as it arrives. Incidents open after 2 bad chunks in a row.</span></div></div>`;
  if (!DASH.incPinned || !DASH.inc || !v.some((x) => x.id === DASH.inc)) DASH.inc = v[0].id;
  const x = v.find((z) => z.id === DASH.inc);
  return `<div class="inc-list glass" role="listbox" aria-label="Incidents">
    <div class="il-head"><h3>Incidents</h3><span>${v.filter(isOpen).length} open · ${v.length} total</span></div>
    ${v.map((z) => `<button type="button" class="inc-row" role="option" aria-selected="${z.id === DASH.inc}" data-inc="${esc(z.id)}"><i class="lv" style="background:${LV[z.level]}"></i><span class="ir-b"><span class="ir-t">${esc(incTitle(z))}</span><span class="ir-s">${esc(groupName(z.group))} · ${clock(z.t0)}–${isOpen(z) || !z.t1 ? 'now' : clock(z.t1)}</span></span><span class="ir-st ${isOpen(z) ? 'open' : ''}">${isOpen(z) ? 'open' : 'closed'}</span></button>`).join('')}
  </div>${incidentCard(x)}`;
}
function howBadHTML(m, d) {
  const ev = d?.how_bad?.evidence || {}; const w = ev.worst; const l = ev.latest; const lines = [];
  if (w) lines.push(`Worst <b>${esc(fmtUnit(w.value, w.unit))}</b>${w.at ? ` at ${clock(w.at)}` : ''}${w.band ? ` · band ${esc(fmtUnit(w.band.warning, w.unit))} / ${esc(fmtUnit(w.band.critical, w.unit))}` : ''}${w.limit != null ? ` · limit ${esc(fmtUnit(w.limit, w.unit))}` : ''}`);
  if (l && l !== w) lines.push(`Latest <b>${esc(fmtUnit(l.value, l.unit))}</b>`);
  if (m.who?.name) lines.push(`Mostly on <code>${esc(m.who.name)}</code>${m.who.share_pct != null ? ` (${fmt(m.who.share_pct)}%${m.who.estimate ? ', estimate' : ''})` : ''}`);
  const note = w?.reason ? `${w.reason}${d?.how_bad?.score != null ? ` · score ${d.how_bad.score}` : ''}` : (d?.score != null ? `score ${d.score}` : '');
  return `<p class="hb-lead"><b>${esc(m.how_bad.headline || '')}</b></p>${lines.length ? `<ul class="hb">${lines.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}${note ? `<p class="muted hb-note">${esc(note)}</p>` : ''}`;
}
function wicHTML(m) {
  const top = m.where[0];
  if (!top) return '<div class="wic-row off"><h5>Where in code</h5><span class="wic-none">No stack-carrying event for this type</span></div>';
  return `<button type="button" class="wic-row" data-wic="${esc(m.id)}" aria-haspopup="dialog" aria-label="Where in code: open stack frames and flame graph">
    <h5>Where in code</h5><code class="wic-top" title="Top frame · ${esc(fmt(top.share_pct))}%">${esc(top.frame)}</code>
    <span class="wic-go" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.5"/><path d="m10.5 8 4 4-4 4"/></svg></span></button>`;
}
function incidentCard(x) {
  const d = DASH.detail[x.id]; const m = cardModel(d || x); const open = isOpen(x);
  if (!d && !DASH.detail[`_${x.id}`]) loadDetail(x.id);
  const ids = new Set([x.id, ...(m.together.chain || [])]);
  const chain = state.incidents.filter((z) => ids.has(z.id)).sort((a, b) => tms(a.t0) - tms(b.t0));
  const also = (d?.together?.groups || []).filter((g) => g && g.group).map((g) => `${esc(groupName(g.group))}${g.vs_normal != null ? ` ×${fmt(g.vs_normal)}` : ''}`);
  const instant = m.chunks === 1;
  return `<article class="inc-card glass" data-component="IncidentCard" aria-label="Incident detail">
    <header><i class="lv" style="background:${LV[x.level]}"></i><div class="ic-t"><h3>${esc(m.title)}</h3><div class="ic-sub">${esc(groupName(x.group))} · ${open ? `<span class="pill open">open since ${clock(x.t0)}</span>` : `<span class="pill">closed ${clock(x.t1)}</span>`}</div></div>
      ${m.confidence ? `<span class="conf ${esc(m.confidence)}" tabindex="0" title="${esc(CONF_TIP[m.confidence] || '')}" aria-label="Confidence ${esc(m.confidence)}"><i></i><i></i><i></i>${esc(m.confidence)}</span>` : ''}</header>
    <div class="ic-grid">
      <div class="ic-col">
      <div class="ic-q"><h5>What you felt</h5><p>${esc(m.felt || x.headline || '')}</p></div>
      <div class="ic-q"><h5>When</h5><p><b>${clock(x.t0)}–${open || !x.t1 ? 'now' : clock(x.t1)}</b> UTC${m.when.duration_s != null ? ` · ${m.when.duration_s} s` : ''}<br><span class="muted">opened after ${instant ? '1 chunk (instant type)' : '2 bad chunks'} · closes after 3 normal chunks${x.peak_at ? ` · peak ${clock(x.peak_at)}` : ''}</span></p></div>
      <div class="ic-q hbad"><h5>How bad</h5>${howBadHTML(m, d)}</div>
      </div>
      <div class="ic-q"><h5>Why: what happened together</h5>${chain.length > 1 ? `<ol class="chain">${chain.map((z) => `<li class="${z.id === x.id ? 'me' : ''}"><button type="button" data-inc="${esc(z.id)}"><i class="lv" style="background:${LV[z.level]}"></i><span class="cl">${esc(incTitle(z))}</span><span class="tm">${clock(z.t0)}</span></button></li>`).join('')}</ol>` : '<p class="muted">Nothing else happened in this window.</p>'}${also.length ? `<p class="muted">Also off normal: ${also.join(', ')}.</p>` : ''}<p class="muted">In order of start, same window. Order is not proof of cause.</p></div>
      <div class="ic-q wide wic">${wicHTML(m)}</div>
      <div class="ic-q wide todo"><h5>What to do</h5>${m.todo.length ? `<p>${m.todo.map((t) => esc(t.charAt(0).toUpperCase() + t.slice(1))).join('; ')}.</p>` : `<p class="muted">${d ? 'No suggestion for this type.' : 'Loading…'}</p>`}</div>
    </div>
    <footer><button type="button" class="btn btn-primary sm" data-ask-inc="${esc(x.id)}">${icon('sparkle', 'width:15px;height:15px')}Ask KUSMA</button><button type="button" class="btn sm" data-show-inc="${esc(x.id)}">${icon('chart', 'width:14px;height:14px')}Show on chart</button></footer>
  </article>`;
}
async function loadDetail(id) {
  DASH.detail[`_${id}`] = true;
  try { DASH.detail[id] = await api.client.incident(jvmRef(state.selected), id, rangeQ()); } catch (e) { DASH.detail[id] = null; DASH.detail[`_${id}`] = e; }
  if (DASH.inc === id) { const w = $('#incWrap'); if (w) { const sc = w.querySelector('.inc-list')?.scrollTop || 0; w.innerHTML = incidentsHTML(); const l = w.querySelector('.inc-list'); if (l) l.scrollTop = sc; } }
}
app.incidentDetail = (id) => DASH.detail[id];
function selectIncident(id) {
  DASH.inc = id; DASH.incPinned = true; const w = $('#incWrap');
  if (w) { w.innerHTML = incidentsHTML(); w.querySelector('.inc-card')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  if (DASH.seek) renderSeekOption();
}
app.openIncident = (id) => { if (state.page !== 'incidents') { setPage('incidents'); } setTimeout(() => selectIncident(id), 0); };

/** Context card for one incident (selection kind incident). */
export function incidentCardCtx(x) {
  const ch = primaryChart(x.group);
  return { key: `inc:${x.id}`, group: x.group, label: `${incTitle(x)} · ${groupName(x.group)}`, when: `${clock(x.t0)}–${isOpen(x) || !x.t1 ? 'now' : clock(x.t1)} UTC`, details: x.headline || '',
    chart: chartRef(ch, PRIMARY_VIEW[ch?.id]), selection: { kind: 'incident', id: x.id, type: x.type, group: x.group, level: x.level, status: x.status, t0: x.t0, t1: x.t1 || null, peak_at: x.peak_at || null, headline: x.headline || null },
    spark: DASH.bodies[x.group]?.series?.[0]?.points };
}
function askIncident(id) {
  const x = state.incidents.find((z) => z.id === id); if (!x) return;
  app.attachCard(incidentCardCtx(x)); app.openChat(true);
  app.setInput(questionsFor(x, state.persona)[0] || 'What caused this incident?'); $('#input')?.focus();
}

/* ---------------- cards (mockup cardShell / otherHTML / endpointsHTML) ---------------- */
function cardShell(g, rk, expanded) {
  const st = stOf(g); const top = worstOf(g); const ch = primaryChart(g);
  return `<section class="dcard glass${expanded ? ' expanded' : ''}" id="card-${g}" data-component="SubsystemCard" data-sub="${g}" aria-label="${esc(groupName(g))} chart">
    <header>${rk ? `<span class="rk" title="Rank by incident severity">${rk}</span>` : `<i class="sw" style="width:10px;height:10px;border-radius:50%;background:${GROUP_COLOR[g]};margin-top:6px"></i>`}
      <div class="tt"><h4>${esc(groupName(g))}<span class="stag" data-st="${st}">${STL[st]}</span></h4>
        <div class="kpi" title="${esc(kpi(g))}">${esc(kpi(g))}</div><div class="top-mk">${top ? `${icon('alert', `width:11px;height:11px;color:${LV[top.level]}`)} ${esc(incFelt(top))}` : ''}</div></div>
      ${expanded ? `<button type="button" class="icon-btn cardbtn" data-collapse="${g}" aria-label="Collapse">${icon('x', 'width:14px;height:14px')}</button>` : ''}</header>
    <div class="chart" id="chart-${g}" role="img" aria-label="${esc(groupName(g))} over the window. Drag to select a time range."></div>
    <div class="srcs" title="${esc((ch?.events || []).join(' · '))}">JFR: <code>${esc((ch?.events || []).join(' · ') || ch?.title || '')}</code></div>
    <div class="sr-only">${incsOf(g).map((x) => `<button type="button" data-mk="${esc(x.id)}">Marker: ${esc(incTitle(x))} at ${clock(x.peak_at || x.t0)}. Show questions</button>`).join('')}</div>
  </section>`;
}
function otherHTML(g) {
  const st = stOf(g);
  return `<button type="button" class="ocard glass" data-sub="${g}" data-component="CompactCard" aria-label="${esc(groupName(g))}: ${STL[st]}. Expand chart"><div class="ob"><div class="on"><i class="sw" style="width:8px;height:8px;border-radius:50%;background:${GROUP_COLOR[g]}"></i>${esc(groupName(g))}<span class="stag" data-st="${st}">${st === 'crit' ? 'crit' : st === 'warn' ? 'warn' : st}</span></div><div class="ok" title="${esc(kpi(g))}">${esc(kpi(g))}</div></div><span class="sp" data-spark="${g}"></span></button>`;
}
function endpointsOffHTML() {
  const jdk = state.selected?.jdk;
  return `<div class="ocard glass endpoints" data-component="EndpointsCard" aria-label="Endpoints: no method timing on this JVM"><div class="ob"><div class="on"><svg class="icon" viewBox="0 0 24 24" style="width:14px;height:14px;color:#14A38B"><path d="M4 7h10M4 12h16M4 17h7"/><circle cx="18" cy="7" r="2"/><circle cx="15" cy="17" r="2"/></svg>Endpoints<span class="stag" data-st="off">off</span></div>
  <div class="ok">Turn on method timing for Quarkus endpoints</div><div class="ep-how" title="JDK 25+ (JEP 520). This JVM runs JDK ${esc(jdk)}.">JDK 25+ · <code>method-timing=@jakarta.ws.rs.GET</code></div></div></div>`;
}
const armBrush = (c) => c.dispatchAction({ type: 'takeGlobalCursor', key: 'brush', brushOption: { brushType: 'lineX', brushMode: 'single' } });
async function renderCardChart(g, refresh) {
  const el = document.getElementById(`chart-${g}`); if (!el) return;
  const ch = primaryChart(g);
  if (!ch) { el.innerHTML = errHTML({ error: 'unknown_chart', message: `No primary chart for ${groupName(g)} in J/charts`, hint: 'The analyzer catalogue has no chart for this group.' }); return; }
  if (ch.availability !== 'available') { el.innerHTML = placeholderHTML(ch, true); el.classList.add('is-ph'); return; }
  const plan = planFor(ch, PRIMARY_VIEW[ch.id] || ch.views?.[0]?.id);
  const body = await fetchPlan(plan, ch);
  if (!document.body.contains(el)) return;
  DASH.bodies[g] = body;
  if (body.error) { DASH.charts[g]?.dispose(); delete DASH.charts[g]; el.innerHTML = errHTML(body); return; }
  const option = buildOption(plan, body, chartCtx(ch));
  if (DASH.zoom) option.xAxis = { ...option.xAxis, min: DASH.zoom[0], max: DASH.zoom[1] };
  let c = DASH.charts[g];
  if (!c || refresh === 'new') {
    el.innerHTML = ''; c = echarts.init(el, null, { renderer: 'svg' }); c.group = 'jzdash'; DASH.charts[g] = c;
    c.on('click', (p) => { if (p.componentType === 'markPoint' && p.data?.id) onMarker(p.data.id, g, p.event?.event); });
    c.on('brushEnd', (p) => { const a = p.areas && p.areas[0]; if (!a) return; const [x0, x1] = a.coordRange; onRange(g, Math.round(x0), Math.round(x1)); });
  }
  DASH.metas[g] = setOpt(c, option); armBrush(c); echarts.connect('jzdash');
}
async function loadSpark(g) {
  const x = gOf(g); const host = document.querySelector(`[data-spark="${g}"]`); if (!host || !x.metric) return;
  try { const r = await api.client.query(jvmRef(state.selected), { ...rangeQ(), metric: x.metric, stat: x.stat || 'avg', step: '30s' }); host.innerHTML = spark(r.points || [], 86, 34, GROUP_COLOR[g]); } catch { /* compact card keeps its KPI */ }
}
function expandOther(g, scroll) {
  DASH.expanded.add(g); if (document.getElementById(`card-${g}`)) { focusSub(g); return; }
  $('#expGrid').insertAdjacentHTML('beforeend', cardShell(g, 0, true)); renderCardChart(g, 'new');
  if (scroll) focusSub(g);
}
function focusSub(g) {
  const el = document.getElementById(`card-${g}`); if (!el) { expandOther(g, true); return; }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
}

/* ---------------- timeline lanes (mockup renderSeek via charts/lanes.js) ---------------- */
let LANES = [];
function renderSeekOption() {
  const c = DASH.seek; if (!c) return;
  c.setOption(laneOption(state.timeline, state.incidents, LANES, { theme: chartTheme(), selectedId: DASH.inc, titleOf: incTitle, feltOf: incFelt }), { notMerge: false, replaceMerge: ['series'] });
}
function renderSeek() {
  const el = $('#seekChart'); if (!el) return;
  LANES = laneGroups(state.timeline, state.incidents, state.report, { all: qs.get('lanes') === 'all' });
  if (!LANES.length) { el.style.height = 'auto'; el.innerHTML = '<p class="seek-empty muted">No subsystem left normal in this window.</p>'; return; }
  el.style.height = `${laneHeight(LANES.length)}px`;
  const c = echarts.init(el, null, { renderer: 'svg' }); DASH.seek = c;
  c.setOption(laneOption(state.timeline, state.incidents, LANES, { theme: chartTheme(), selectedId: DASH.inc, titleOf: incTitle, feltOf: incFelt })); armBrush(c);
  c.on('datazoom', () => { const o = c.getOption().dataZoom[0]; const w = win(); const a = Math.round(o.startValue); const b = Math.round(o.endValue);
    DASH.zoom = (a <= tms(w.from) && b >= tms(w.to)) ? null : [a, b];
    Object.values(DASH.charts).forEach((ch) => ch.setOption({ xAxis: { min: DASH.zoom ? a : tms(w.from), max: DASH.zoom ? b : tms(w.to) } })); hidePops(); });
  c.on('click', (p) => { if (p.data && p.data.inc) selectIncident(p.data.inc); });
  c.on('brushEnd', (p) => { const a = p.areas && p.areas[0]; if (!a) return; const [x0, x1] = a.coordRange; onRange(null, Math.round(x0), Math.round(x1)); });
}

/* ---------------- brush → range pop (mockup onRange) ---------------- */
async function onRange(g, a, b) {
  if (!(b - a >= 1000)) return;
  const host = g ? document.getElementById(`chart-${g}`) : $('#seekChart'); const c = g ? DASH.charts[g] : DASH.seek; if (!host || !c) return;
  const inc = overlapping(a, b); const st = await rangeStats(a, b);
  const subsIn = [...new Set(inc.map((x) => x.group))];
  const rtitle = `${clock(a)}–${clock(b)} · ${Math.round((b - a) / 1000)} s · ${inc.length ? `${inc.length} incident${inc.length > 1 ? 's' : ''}` : 'no incidents'}`;
  const rdots = subsIn.length ? `<span class="rdots" title="${esc(subsIn.map(groupName).join(', '))}">${subsIn.map((s) => `<i style="background:${GROUP_COLOR[s]}"></i>`).join('')}</span>` : '';
  const cr = host.getBoundingClientRect(); const px = c.convertToPixel({ xAxisIndex: 0 }, (a + b) / 2);
  const ch = g ? primaryChart(g) : null;
  const card = { key: `range:${g || 'lanes'}:${a}-${b}`, group: g || subsIn[0] || null, label: `${g ? groupName(g) : 'Timeline'} · ${clock(a)}–${clock(b)}`, when: `${clock(a)}–${clock(b)} UTC · ${Math.round((b - a) / 1000)} s`,
    details: st.slice(0, 3).map((r) => `${groupName(r.g)} ${fmtUnit(r.v, r.unit)}${r.x ? ` (×${fmt(r.x)})` : ''}`).join(' · '),
    chart: ch ? chartRef(ch, PRIMARY_VIEW[ch.id]) : chartRef(TIMELINE_CHART, 'lanes'),
    selection: { kind: 'range', from: iso(a), to: iso(b), ...(g ? { values: seriesStats(DASH.bodies[g], a, b) } : { lanes: LANES }),
      vs_normal: st.slice(0, 6).map((r) => ({ group: r.g, metric: r.metric, stat: r.stat, value: r.v, unit: r.unit, normal: r.base, ratio: r.x })), incidents: inc.map((x) => x.id) },
    spark: g ? DASH.bodies[g]?.series?.[0]?.points : null };
  showPop({ id: 'rangePop', ic: 'chart', head: `${rtitle}${rdots}`, label: 'Range summary', sub: "From J/query over the range, compared with this window's normal (J/report).",
    extra: rstatsHTML(st) + rincHTML(inc), primary: 'Ask KUSMA about this range', primaryText: `What happened between ${clock(a)} and ${clock(b)}?`, card,
    x: cr.left + px, y: cr.top + cr.height - 32, foot: 'Attaches this range to KUSMA as context' });
}

/* ---------------- marker → anomaly pop (mockup onMarkerClick / showAnomaly) ---------------- */
function onMarker(id, g, ev) {
  const x = state.incidents.find((z) => z.id === id); if (!x) return;
  const card = incidentCardCtx(x); app.attachCard(card);
  const el = document.getElementById(`chart-${g}`); const r = el.getBoundingClientRect();
  showPop({ id: 'anomalyPop', ic: 'alert', col: LV[x.level], head: esc(incTitle(x)), sub: `${clock(x.t0)}–${isOpen(x) || !x.t1 ? 'now' : clock(x.t1)} · ${esc(incFelt(x))}`,
    qs: questionsFor(x, state.persona), own: false, card, x: ev?.clientX ?? r.left + r.width / 2, y: ev?.clientY ?? r.top + 40,
    foot: `Chart attached to KUSMA · <button type="button" class="linkish" data-rinc="${esc(x.id)}">Open incident card</button>` });
}

/* ---------------- render ---------------- */
export function renderDashboard(m) {
  if (DASH.jvm !== state.selected) { DASH.jvm = state.selected; DASH.inc = null; DASH.incPinned = false; DASH.detail = {}; DASH.expanded = new Set(); DASH.zoom = null; }
  DASH.zoom = null; DASH.bodies = {};
  const rk = rank(); const top = rk.slice(0, 4); const restAll = groups().map((g) => g.group).filter((g) => !top.includes(g)); DASH.top = top.join();
  const epOff = !state.chartList.some((c) => c.group === 'endpoint' && c.availability === 'available');
  const rest = restAll.filter((g) => !(g === 'endpoint' && epOff) && gOf(g).state !== 'unavailable');
  const off = restAll.filter((g) => gOf(g).state === 'unavailable' && g !== 'endpoint');
  m.insertAdjacentHTML('beforeend', `
  <section class="dash-head glass" data-component="DashboardHeader">
    <div class="row1"><h2>${icon('chart', 'width:18px;height:18px;color:var(--periwinkle-strong)')}Incident report<span class="dh-tally" id="dhTally" aria-live="polite">${headTally()}</span></h2>
      <div class="seg icon-seg" id="layoutSeg" role="group" aria-label="Chart layout"><button type="button" data-v="grid" title="Two columns" aria-label="Two columns" aria-pressed="${DASH.layout === 'grid'}">${icon('grid', 'width:15px;height:15px')}</button><button type="button" data-v="list" title="One column" aria-label="One column" aria-pressed="${DASH.layout === 'list'}">${icon('list', 'width:15px;height:15px')}</button></div></div>
    <div class="health" id="health" role="group" aria-label="Health by subsystem">${healthHTML()}</div>
  </section>
  <section class="seek glass" data-component="IncidentTimeline">
    <header><h3>Timeline</h3><span class="hint">One lane per subsystem · drag on any chart to pick a time range</span>
      <div class="live" id="liveCtl">${liveCtlHTML()}</div></header>
    <div id="seekChart" role="img" aria-label="Incident lanes over the window; drag the handles to zoom every chart"></div>
  </section>
  <section class="inc-wrap" id="incWrap" data-component="Incidents">${incidentsHTML()}</section>
  <div class="sec-head"><h3>Needs attention</h3><span class="hint">Top 4 subsystems by incident severity · click a marker for questions</span>
    <span class="mk-legend"><span><i style="background:${LV.critical}"></i>critical</span><span><i style="background:${LV.warning}"></i>warning</span><span><i style="background:${LV.info}"></i>info</span></span></div>
  <div class="dash-grid ${DASH.layout}" id="topGrid">${top.map((g, i) => cardShell(g, i + 1)).join('')}</div>
  <div class="sec-head"><h3>Healthy / other</h3><span class="hint">${rest.length} subsystems · click to expand</span></div>
  <div class="other-grid" id="otherGrid">${rest.map(otherHTML).join('')}${off.map(otherHTML).join('')}${epOff ? endpointsOffHTML() : ''}</div>
  <div class="dash-grid list" id="expGrid"></div>`);
  top.forEach((g) => renderCardChart(g, 'new'));
  [...DASH.expanded].filter((g) => rest.includes(g)).forEach((g) => expandOther(g, false));
  rest.forEach(loadSpark);
  renderSeek();
  $('#layoutSeg').onclick = (e) => { const b = e.target.closest('[data-v]'); if (!b) return; DASH.layout = b.dataset.v; $('#topGrid').className = `dash-grid ${DASH.layout}`;
    $$('#layoutSeg [data-v]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.v === DASH.layout)); hidePops(); requestAnimationFrame(() => Object.values(DASH.charts).forEach((c) => c.resize())); };
  $('#health').onclick = (e) => { const c = e.target.closest('[data-sub]'); if (c) focusSub(c.dataset.sub); };
  $('#otherGrid').onclick = (e) => { const c = e.target.closest('button[data-sub]'); if (c) expandOther(c.dataset.sub, true); };
  $('#liveCtl').onclick = (e) => { const b = e.target.closest('[data-live]'); if (!b) return;
    if (b.dataset.live === 'toggle') { state.live = !state.live; if (state.live && state.pending) refreshLive(); } else { state.live = true; refreshLive(); }
    app.syncLive(); };
  m.onclick = (e) => {
    const mk = e.target.closest('[data-mk]'); if (mk) { const x = state.incidents.find((z) => z.id === mk.dataset.mk); if (x) onMarker(x.id, x.group); return; }
    const x = e.target.closest('[data-collapse]'); if (x) { DASH.expanded.delete(x.dataset.collapse); DASH.charts[x.dataset.collapse]?.dispose(); delete DASH.charts[x.dataset.collapse]; document.getElementById(`card-${x.dataset.collapse}`)?.remove(); return; }
    const w = e.target.closest('[data-wic]'); if (w) { app.openEvidence(w.dataset.wic); return; }
    const i = e.target.closest('[data-inc]'); if (i && !e.target.closest('.anomaly-pop')) { selectIncident(i.dataset.inc); return; }
    const a = e.target.closest('[data-ask-inc]'); if (a) { askIncident(a.dataset.askInc); return; }
    const sc = e.target.closest('[data-show-inc]'); if (sc) { const z = state.incidents.find((q) => q.id === sc.dataset.showInc); if (z) focusSub(z.group); }
  };
}
app.renderDashboard = renderDashboard;

/** One SSE window: health, tally, lanes, incidents and every card's chart (mockup liveUpdate). */
app.liveUpdate = () => {
  if (state.page === 'charts') { app.chartsLive?.(); return; }
  if (!$('#topGrid')) return;
  if (rank().slice(0, 4).join() !== DASH.top) { const sc = $('#main').scrollTop; renderMain(); $('#main').scrollTop = sc; return; }
  $('#health').innerHTML = healthHTML(); $('#dhTally').innerHTML = headTally(); app.syncLive();
  const w = $('#incWrap'); if (w) { const sc = w.querySelector('.inc-list')?.scrollTop || 0; const keep = DASH.inc; w.innerHTML = incidentsHTML(); if (keep !== DASH.inc) delete DASH.detail[`_${DASH.inc}`]; const l = w.querySelector('.inc-list'); if (l) l.scrollTop = sc; }
  const n = laneGroups(state.timeline, state.incidents, state.report, { all: qs.get('lanes') === 'all' });
  if (DASH.seek && n.join() === LANES.join()) renderSeekOption(); else { DASH.seek?.dispose(); DASH.seek = null; $('#seekChart').innerHTML = ''; renderSeek(); }
  $$('.dcard').forEach((c) => { const g = c.dataset.sub; const t = c.querySelector('h4 .stag'); if (t) { t.dataset.st = stOf(g); t.textContent = STL[stOf(g)]; }
    const k = c.querySelector('.kpi'); if (k) k.textContent = kpi(g);
    const mk = c.querySelector('.top-mk'); const top = worstOf(g); if (mk) mk.innerHTML = top ? `${icon('alert', `width:11px;height:11px;color:${LV[top.level]}`)} ${esc(incFelt(top))}` : '';
    renderCardChart(g); });
  $$('#otherGrid .ocard[data-sub]').forEach((b) => { const g = b.dataset.sub; const t = b.querySelector('.stag'); if (t) { t.dataset.st = stOf(g); t.textContent = stOf(g) === 'crit' ? 'crit' : stOf(g) === 'warn' ? 'warn' : stOf(g); } loadSpark(g); });
};
window.addEventListener('resize', () => { Object.values(DASH.charts).forEach((c) => c.resize()); DASH.seek?.resize(); hidePops(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hidePops(); });
