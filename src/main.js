import './styles/shell.css';
import './styles/dash4.css';
import './styles/picker.css';
import './styles/charts.css';
import './styles/app.css';
import * as echarts from 'echarts';
import 'echarts-gl';
import { apiBase, createClient, harnessBase, saveApiBase } from './api/client.js';
import { openStream } from './api/stream.js';
import { GROUP_COLOR, GROUP_LABEL, PRIMARY, buildOption, navEntries, placeholderCopy, planFor, visibleForGc } from './charts/registry.js';
import { CONF_TIP, cardModel, typeTitle } from './incidents/model.js';
import { buildContext } from './chat/context.js';
import { QT, STARTERS, questionsFor } from './chat/questions.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (id, st = '') => `<svg class="icon" style="${st}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const qs = new URLSearchParams(location.search);
const SERVICES = [
  { id: 'analyzer', label: 'Analyzer', detail: 'Workloads, incidents and charts.' },
  { id: 'laya', label: 'Laya', detail: 'Reads the question and calls tools.' },
  { id: 'jafraz', label: 'Jafra Z', detail: 'Writes the answer.' },
];
const STATE_TEXT = { connected: 'Connected', connecting: 'Connecting', down: 'Down' };
const LVL = { critical: '#E5484D', warning: '#E59A12', ok: '#3BB273', unavailable: '#9A9CBF' };

const state = {
  page: qs.get('page') === 'charts' ? 'charts' : 'incidents',
  theme: qs.get('theme') === 'dark' ? 'dark' : (localStorage.getItem('jz-theme') || 'light'),
  chatOpen: qs.get('chat') !== '0',
  persona: localStorage.getItem('jz.persona') === 'expert' ? 'expert' : 'developer',
  data: qs.get('data') === 'empty' ? 'empty' : 'data',
  svc: {
    analyzer: qs.get('analyzer') || 'connecting',
    laya: qs.get('laya') || 'down',
    jafraz: qs.get('jafraz') || 'down',
  },
  workloads: [],
  selected: null,
  info: null,
  report: null,
  timeline: null,
  incidents: [],
  chartList: [],
  chartId: qs.get('chart') || null,
  layout: 'grid',
  pinned: false,
  pinnedId: null,
  live: true,
  pausedBuf: [],
  stream: null,
  fails: 0,
  backoff: 1000,
  charts: {},
  seek: null,
  pageChart: null,
  lastTs: {},
  sending: false,
  abort: null,
  chats: {},
  range: { last: '15m' },
  scope: 'all',
};

let client = createClient(apiBase());
const term = () => (state.persona === 'expert' ? 'Expert' : 'Developer');

function splitPod(pod) {
  let m = pod.match(/^(.*)-(\d{6,})-([a-z0-9]+)$/i);
  if (m) return { workload: m[1], kind: 'Job', suffix: m[3] };
  m = pod.match(/^(.*)-([0-9a-f]{6,10})-([a-z0-9]+)$/i);
  if (m && !/^\d+$/.test(m[2])) return { workload: m[1], kind: 'Deployment', suffix: m[3] };
  m = pod.match(/^(.*)-(\d+)$/);
  if (m) return { workload: m[1], kind: 'StatefulSet', suffix: m[2] };
  return { workload: pod, kind: 'Pod', suffix: '' };
}
function dotOf(last) {
  const age = Date.now() - Date.parse(last);
  if (Number.isNaN(age)) return 'ended';
  if (age <= 15_000) return 'live';
  if (age <= 10 * 60_000) return 'stale';
  return 'ended';
}
function startLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toISOString().slice(0, 19).replace('T', ' ')}Z`;
}
function clock(iso) { return iso ? String(iso).slice(11, 19) : ''; }
function jvmKey(j) { return `${j.ns}/${j.pod}/${j.container}|${j.start}|${j.cluster || ''}`; }

function flatJvms() {
  const out = [];
  for (const w of state.workloads) {
    const { workload, kind, suffix } = splitPod(w.pod);
    for (const j of w.jvms || []) {
      out.push({
        ns: w.ns, pod: w.pod, container: w.container, cluster: w.cluster,
        workload, kind, suffix, start: j.start, jdk: j.jdk, profile: j.profile,
        first: j.first, last: j.last, st: dotOf(j.last),
      });
    }
  }
  return out;
}
function writeJvmUrl(j) {
  const u = new URL(location.href);
  u.searchParams.set('jvm', `${j.ns}/${j.pod}/${j.container}`);
  u.searchParams.set('start', String(Date.parse(j.start)));
  if (j.cluster) u.searchParams.set('cluster', j.cluster);
  history.replaceState(null, '', u);
}
function pickFromUrl() {
  const all = flatJvms();
  const spec = qs.get('jvm');
  if (spec) {
    const [ns, pod, container] = spec.split('/');
    const start = qs.get('start');
    const cluster = qs.get('cluster');
    const hit = all.find((j) => j.ns === ns && j.pod === pod && j.container === container
      && (!start || String(Date.parse(j.start)) === start || j.start === start)
      && (!cluster || j.cluster === cluster));
    if (hit) return hit;
  }
  return all.find((j) => j.ns === 'fulfillment' && j.pod === 'orders-worker-0' && j.st === 'live')
    || all.find((j) => j.st === 'live')
    || all[0]
    || null;
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  try { localStorage.setItem('jz-theme', state.theme); } catch { /* ignore */ }
  const dark = state.theme === 'dark';
  $('#themeBtn').innerHTML = icon(dark ? 'sun' : 'moon');
  $('#themeBtn').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  document.querySelectorAll('#themeSeg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === state.theme));
}
function renderChips() {
  $('#chips').innerHTML = SERVICES.map((s) => {
    const st = state.svc[s.id];
    return `<button class="chip" type="button" aria-label="${s.label}: ${STATE_TEXT[st] || st}"><i class="dot" data-state="${st}"></i><span class="brand">${s.label}</span><span class="tooltip" role="tooltip"><strong><i class="dot" data-state="${st}"></i>${STATE_TEXT[st] || st}</strong>${s.detail}</span></button>`;
  }).join('');
  $('#clusterBtn').innerHTML = SERVICES.map((s) => `<i class="dot" data-state="${state.svc[s.id]}"></i>`).join('');
  $('#statusPop').innerHTML = `<h3>Services</h3>${SERVICES.map((s) => `<div class="row"><span class="svc-name"><i class="dot" data-state="${state.svc[s.id]}"></i><b class="brand">${s.label}</b></span><span style="color:var(--ink-3)">${STATE_TEXT[state.svc[s.id]] || ''}</span></div>`).join('')}`;
}
function setAnalyzer(st) {
  if (qs.get('analyzer')) { state.svc.analyzer = qs.get('analyzer'); renderChips(); return; }
  state.svc.analyzer = st;
  renderChips();
}

function renderNav() {
  const p = state.page;
  const labels = { incidents: ['Incidents', 'What went wrong and why'], charts: ['Charts', 'Every JFR view, one at a time'] };
  $('#navCard').innerHTML = `<button type="button" class="nav-btn" id="navBtn" aria-haspopup="menu" aria-expanded="${!$('#navPop').hidden}" aria-label="Switch view (now ${labels[p][0]})"><span>${labels[p][0]}</span></button>`;
  $('#navPop').innerHTML = Object.keys(labels).map((k) => `<button type="button" class="nav-it${k === p ? ' on' : ''}" data-nav="${k}"><span><b>${labels[k][0]}</b><small>${labels[k][1]}</small></span></button>`).join('');
  $('#navBtn').onclick = (e) => { e.stopPropagation(); $('#navPop').hidden = !$('#navPop').hidden; };
}
function setPage(pg) {
  state.page = pg;
  const u = new URL(location.href);
  if (pg === 'charts') u.searchParams.set('page', 'charts');
  else { u.searchParams.delete('page'); u.searchParams.delete('chart'); }
  history.replaceState(null, '', u);
  $('#navPop').hidden = true;
  renderNav();
  renderMain();
}

function identHTML(j) {
  const gc = state.info?.gc?.old || '';
  const jdk = state.info?.jvm?.version || j.jdk;
  return `<div class="id-main"><div class="crumb">${icon('pod', 'width:12px;height:12px')}<span title="Namespace">${esc(j.ns)}</span><i class="sep">›</i><span title="Workload">${esc(j.workload)}</span><i class="sep c-pod">›</i><span class="c-pod" title="${esc(j.pod)}">${esc(j.suffix || j.pod)}</span><i class="sep">›</i><span title="Container">${esc(j.container)}</span></div>
    <div class="id-title"><i class="dot" data-state="${j.st}"></i><b>${esc(startLabel(j.start))}</b><span class="pidtag">${esc(gc)} · JDK ${esc(jdk)}</span>
      <button type="button" class="wl-btn" id="wlBtn" aria-label="Select workload" aria-haspopup="dialog" aria-controls="wlPop"><svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></button></div></div>
    <div class="id-meta"><div class="meta m-pod"><small>POD</small><span title="${esc(j.pod)}">${esc(j.pod)}</span></div>
      <div class="meta m-jvm"><small>JVM START</small><span>${esc(startLabel(j.start))}</span></div></div>`;
}
function renderTree() {
  const all = flatJvms();
  const namespaces = [...new Set(all.map((j) => j.ns))];
  if (!state.ns) state.ns = state.selected?.ns || namespaces[0] || '';
  const btn = $('#nsBtn');
  if (btn) btn.innerHTML = `${icon('layers', 'width:16px;height:16px;color:var(--periwinkle-strong)')}<span class="nsv">${esc(state.ns || 'No namespaces')}</span>`;
  const nq = ($('#nsSearch')?.value || '').trim().toLowerCase();
  const nsList = $('#nsList');
  if (nsList) nsList.innerHTML = namespaces.filter((n) => !nq || n.includes(nq)).map((n) => `<li role="option" class="ns-opt" data-ns="${esc(n)}" aria-selected="${n === state.ns}"><i class="dot" data-state="${all.some((j) => j.ns === n && j.st === 'live') ? 'live' : 'stale'}"></i><span>${esc(n)}</span></li>`).join('');
  const q = ($('#treeSearch')?.value || '').trim().toLowerCase();
  const root = $('#treeRoot');
  if (!root) return;
  if (state.data === 'empty' || !state.ns) { root.innerHTML = '<li class="tree-empty">No workloads yet.</li>'; return; }
  let html = '';
  for (const g of grouped().filter((g) => g.ns === state.ns)) {
    if (q && !`${g.workload} ${[...g.pods.keys()].join(' ')}`.toLowerCase().includes(q)) continue;
    const live = [...g.pods.values()].some((p) => [...p.containers.values()].some((js) => js.some((j) => j.st === 'live')));
    html += `<li role="none"><div class="node grp" role="treeitem" aria-expanded="true"><i class="dot" data-state="${live ? 'live' : 'ended'}"></i><span class="lbl">${esc(g.workload)}</span><span class="kind">${esc(g.kind)}</span></div><ul role="group">`;
    for (const p of g.pods.values()) {
      html += `<li role="none"><div class="node pod" role="treeitem"><span class="lbl">${esc(p.pod)}</span></div><ul role="group">`;
      for (const [c, jvms] of p.containers) {
        html += `<li role="none"><div class="node ctr" role="treeitem"><span class="kind">ctr</span><span class="lbl">${esc(c)}</span></div><ul role="group">`;
        for (const j of jvms) {
          const on = state.selected && jvmKey(state.selected) === jvmKey(j);
          html += `<li role="none"><div class="node jvm" role="treeitem" tabindex="0" aria-selected="${on}" data-key="${esc(jvmKey(j))}"><i class="dot" data-state="${j.st}"></i><span class="lbl">${esc(startLabel(j.start))}</span></div></li>`;
        }
        html += '</ul></li>';
      }
      html += '</ul></li>';
    }
    html += '</ul></li>';
  }
  root.innerHTML = html || '<li class="tree-empty">No match in this namespace.</li>';
}
function renderIdentity() {
  const c = $('#identCard');
  const j = state.selected;
  if (state.svc.analyzer !== 'connected' || !j) {
    c.innerHTML = `<span class="id-empty">${icon('pod', 'width:14px;height:14px')} ${state.svc.analyzer === 'down' ? 'Analyzer not connected' : 'Connecting…'}</span>`;
    return;
  }
  c.innerHTML = identHTML(j);
  $('#wlBtn')?.addEventListener('click', (e) => { e.stopPropagation(); openPicker(); });
}

function grouped() {
  const map = new Map();
  for (const j of flatJvms()) {
    const key = `${j.ns}|${j.workload}|${j.kind}`;
    if (!map.has(key)) map.set(key, { key, ns: j.ns, workload: j.workload, kind: j.kind, pods: new Map() });
    const g = map.get(key);
    if (!g.pods.has(j.pod)) g.pods.set(j.pod, { pod: j.pod, suffix: j.suffix, containers: new Map() });
    const p = g.pods.get(j.pod);
    if (!p.containers.has(j.container)) p.containers.set(j.container, []);
    p.containers.get(j.container).push(j);
  }
  return [...map.values()];
}
function renderPicker(q = '') {
  const query = q.trim().toLowerCase();
  const sel = state.selected;
  const rows = [];
  const byNs = new Map();
  for (const g of grouped()) {
    if (!byNs.has(g.ns)) byNs.set(g.ns, []);
    byNs.get(g.ns).push(g);
  }
  for (const [ns, groups] of byNs) {
    const blob = groups.map((g) => `${g.workload} ${[...g.pods.values()].map((p) => p.pod).join(' ')}`).join(' ');
    if (query && !ns.includes(query) && !blob.toLowerCase().includes(query)) continue;
    rows.push(`<li class="pk-row lv0"><span class="lbl">${esc(ns)}</span><span class="cnt">${groups.length}</span></li>`);
    for (const g of groups) {
      rows.push(`<li class="pk-row lv1"><span class="lbl">${esc(g.workload)}</span><span class="kind">${esc(g.kind)}</span></li>`);
      for (const p of g.pods.values()) {
        rows.push(`<li class="pk-row lv2"><span class="lbl">${esc(p.pod)}</span></li>`);
        for (const [c, jvms] of p.containers) {
          rows.push(`<li class="pk-row lv3"><span class="kind">ctr</span><span class="lbl">${esc(c)}</span></li>`);
          for (const j of jvms) {
            const on = sel && jvmKey(sel) === jvmKey(j);
            rows.push(`<li class="pk-row lv4 jvm" role="option" tabindex="-1" aria-selected="${on}" data-key="${esc(jvmKey(j))}"><i class="dot" data-state="${j.st}"></i><span class="lbl mono">${esc(startLabel(j.start))}</span><span class="meta2">JDK ${esc(j.jdk)} · ${esc(j.profile)}</span>${on ? '<span class="cur">current</span>' : ''}</li>`);
          }
        }
      }
    }
  }
  $('#wlList').innerHTML = rows.join('') || '<li class="pk-empty">No match.</li>';
}
function openPicker() {
  const pop = $('#wlPop');
  pop.hidden = false;
  $('#wlSearch').value = '';
  renderPicker();
  const card = $('#identCard').getBoundingClientRect();
  pop.style.left = `${card.left}px`;
  pop.style.top = `${card.bottom + 8}px`;
  pop.style.width = 'min(520px, calc(100vw - 24px))';
  $('#wlSearch').focus();
}
function selectJvm(j) {
  state.selected = j;
  state.pinned = false;
  state.pinnedId = null;
  state.info = null;
  writeJvmUrl(j);
  $('#wlPop').hidden = true;
  bindStream();
  renderIdentity();
  renderTree();
  renderChat();
  loadJvm();
}

async function loadJvm() {
  const j = state.selected;
  if (!j || state.data === 'empty') { renderMain(); return; }
  const q = { ...state.range };
  try {
    const [info, report, timeline, incidents, charts] = await Promise.all([
      client.jvmInfo(j),
      client.report(j, q),
      client.timeline(j, q),
      client.incidents(j, q),
      client.charts(j, q),
    ]);
    if (state.selected !== j) return;
    state.info = info;
    state.report = report;
    state.timeline = timeline;
    state.incidents = incidents.incidents || [];
    state.chartList = charts.charts || [];
    renderIdentity();
    renderMain();
  } catch (err) {
    console.error(err);
    setAnalyzer('down');
    renderMain();
  }
}

function disposeCharts() {
  Object.values(state.charts).forEach((c) => c.dispose());
  state.charts = {};
  state.seek?.dispose();
  state.seek = null;
  state.pageChart?.dispose();
  state.pageChart = null;
}
function renderMain() {
  disposeCharts();
  const m = $('#main');
  if (state.svc.analyzer === 'down') { m.innerHTML = $('#tpl-no-analyzer').innerHTML; $('#retryBtn').onclick = () => boot(); return; }
  if (state.svc.analyzer === 'connecting' && !state.workloads.length) { m.innerHTML = $('#tpl-connecting').innerHTML; return; }
  if (state.data === 'empty') { m.innerHTML = $('#tpl-no-data').innerHTML; $('#refreshBtn').onclick = () => { state.data = 'data'; renderMain(); loadJvm(); }; return; }
  const j = state.selected;
  if (!j) { m.innerHTML = ''; return; }
  m.innerHTML = `<section class="ident-mobile ident glass">${identHTML(j)}</section>`;
  if (state.page === 'charts') renderChartsPage(m, j);
  else renderDashboard(m, j);
}

function healthHTML() {
  const groups = state.report?.groups || [];
  const by = Object.fromEntries(groups.map((g) => [g.group, g]));
  const order = Object.keys(GROUP_LABEL);
  const chip = (g) => {
    const row = by[g.id] || g;
    const n = (state.incidents || []).filter((x) => x.group === row.group).length;
    const gst = row.state || row.status;
    const st = gst === 'critical' ? 'crit' : gst === 'warning' ? 'warn' : gst === 'unavailable' ? 'off' : 'ok';
    const tip = gst === 'unavailable' ? `${row.reason || 'unavailable'}${row.flags?.length ? ` · ${row.flags.join(', ')}` : ''}` : `${n} incident${n === 1 ? '' : 's'}`;
    return `<button type="button" class="hchip" data-sub="${row.group}" data-st="${st}" title="${esc(tip)}"><i class="sw" style="background:${GROUP_COLOR[row.group] || '#999'}"></i>${GROUP_LABEL[row.group] || row.group}<span class="n">${gst === 'unavailable' ? '' : n}</span></button>`;
  };
  const buckets = [
    ['critical', 'Critical', groups.filter((g) => (g.state || g.status) === 'critical')],
    ['warning', 'Warning', groups.filter((g) => (g.state || g.status) === 'warning')],
    ['ok', 'OK', groups.filter((g) => { const s = g.state || g.status; return s === 'ok' || s === 'unavailable'; })],
  ];
  return buckets.map(([st, lbl, ss]) => `<div class="hbox" data-st="${st === 'critical' ? 'crit' : st === 'warning' ? 'warn' : 'ok'}"><div class="hb-h"><span>${lbl}</span><b>${ss.length}</b></div><div class="hb-chips">${ss.length ? ss.map(chip).join('') : '<span class="hb-none">None</span>'}</div></div>`).join('') || order.map(() => '').join('');
}
function headTally() {
  const open = state.incidents.filter((x) => x.status === 'open').length;
  return `<b>${open}</b> open · <b>${state.incidents.length}</b> incident${state.incidents.length === 1 ? '' : 's'} so far`;
}
function liveCtl() {
  const to = state.timeline?.window?.to;
  return `<span class="lv-state ${state.live ? 'on' : ''}"><i></i>${state.live ? `Live · ${clock(to)}` : 'Paused'}</span>
    <button type="button" class="lv-btn" data-live="toggle" aria-label="${state.live ? 'Pause' : 'Resume'}">${state.live ? 'Pause' : 'Resume'}</button>
    <button type="button" class="lv-btn" data-live="end" aria-label="Skip to live">Skip to live</button>`;
}

function renderDashboard(m) {
  const groups = [...(state.report?.groups || [])];
  const top = groups.slice(0, 4).map((g) => g.group);
  const rest = groups.slice(4).map((g) => g.group);
  m.insertAdjacentHTML('beforeend', `
    <section class="dash-head glass"><div class="row1"><h2>${icon('chart', 'width:18px;height:18px;color:var(--periwinkle-strong)')}Incident report<span class="dh-tally" id="dhTally">${headTally()}</span></h2>
      <div class="seg icon-seg" id="layoutSeg"><button type="button" data-v="grid" aria-pressed="${state.layout === 'grid'}">${icon('grid', 'width:15px;height:15px')}</button><button type="button" data-v="list" aria-pressed="${state.layout === 'list'}">${icon('list', 'width:15px;height:15px')}</button></div></div>
      <div class="health" id="health">${healthHTML()}</div></section>
    <section class="seek glass"><header><h3>Timeline</h3><span class="hint">One lane per group that has incidents</span><div class="live" id="liveCtl">${liveCtl()}</div></header><div id="seekChart"></div></section>
    <section class="inc-wrap" id="incWrap">${incidentsHTML()}</section>
    <div class="sec-head"><h3>Needs attention</h3><span class="hint">Top 4 groups from the report</span></div>
    <div class="dash-grid ${state.layout}" id="topGrid">${top.map((g, i) => cardShell(g, i + 1)).join('')}</div>
    <div class="sec-head"><h3>Healthy / other</h3></div>
    <div class="other-grid" id="otherGrid">${rest.map(otherHTML).join('')}${endpointOff()}</div>
    <div class="anomaly-pop" id="cxPop" role="dialog" hidden></div>`);
  top.forEach((g) => drawCard(g));
  drawSeek();
  loadDetail(followId());
  $('#layoutSeg').onclick = (e) => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    state.layout = b.dataset.v;
    $('#topGrid').className = `dash-grid ${state.layout}`;
  };
  $('#liveCtl').onclick = (e) => {
    const b = e.target.closest('[data-live]'); if (!b) return;
    if (b.dataset.live === 'toggle') state.live = !state.live;
    if (b.dataset.live === 'end') { state.live = true; applyBuffer(); }
    $('#liveCtl').innerHTML = liveCtl();
  };
  $('#incWrap').onclick = onIncClick;
}

function cardShell(group, rank) {
  const row = (state.report?.groups || []).find((g) => g.group === group);
  const st = row?.state || row?.status || 'ok';
  const label = st === 'critical' ? 'critical' : st === 'warning' ? 'warning' : st;
  return `<section class="dcard glass" id="card-${group}" data-sub="${group}"><header>${rank ? `<span class="rk">${rank}</span>` : ''}<div class="tt"><h4>${GROUP_LABEL[group] || group}<span class="stag" data-st="${st === 'critical' ? 'crit' : st === 'warning' ? 'warn' : 'ok'}">${label}</span></h4><div class="kpi">${esc(row?.summary || '')}</div></div></header><div class="chart" id="chart-${group}"></div><div class="srcs">From the analyzer · <code>${esc(PRIMARY[group] || group)}</code></div></section>`;
}
function otherHTML(group) {
  const row = (state.report?.groups || []).find((g) => g.group === group);
  return `<button type="button" class="ocard glass" data-sub="${group}"><div class="ob"><div class="on"><i class="sw" style="width:8px;height:8px;border-radius:50%;background:${GROUP_COLOR[group]}"></i>${GROUP_LABEL[group] || group}<span class="stag">${row?.state || row?.status || 'ok'}</span></div></div></button>`;
}
function endpointOff() {
  const ep = (state.report?.groups || []).find((g) => g.group === 'endpoint');
  if (!ep || (ep.state || ep.status) !== 'unavailable') return '';
  return `<div class="ocard glass" data-st="off"><div class="ob"><div class="on">Endpoints<span class="stag">off</span></div><p class="kpi">${esc(ep.reason || 'Not on this JDK')}</p></div></div>`;
}

async function drawCard(group) {
  const el = document.getElementById(`chart-${group}`);
  if (!el || !state.selected) return;
  const id = PRIMARY[group];
  if (!id) return;
  try {
    const body = await client.chart(state.selected, id, state.range);
    if (!document.body.contains(el)) return;
    const opt = buildOption(planFor({ id, group, metrics: body.series?.map((s) => s.metric) }, 'time'), body);
    const c = echarts.init(el, null, { renderer: 'svg' });
    c.setOption(opt);
    state.charts[group] = c;
    const pts = body.series?.[0]?.points;
    if (pts?.length) state.lastTs[id] = pts[pts.length - 1][0];
  } catch (err) { console.warn(group, err); }
}
function drawSeek() {
  const el = $('#seekChart');
  if (!el || !state.timeline) return;
  const lanes = (state.timeline.lanes || []).filter((l) => (state.incidents || []).some((x) => x.group === l.group) || (l.segments || []).some((s) => s.state === 'critical' || s.state === 'warning'));
  const incs = state.incidents || [];
  const c = echarts.init(el, null, { renderer: 'svg' });
  state.seek = c;
  const y = lanes.map((l) => GROUP_LABEL[l.group] || l.group);
  const data = [];
  lanes.forEach((l, yi) => {
    for (const inc of incs.filter((x) => x.group === l.group)) {
      data.push({
        value: [Date.parse(inc.t0), Date.parse(inc.t1 || state.timeline.window.to), yi, inc.level],
        itemStyle: { color: LVL[inc.level] || LVL.warning },
      });
    }
  });
  c.setOption({
    grid: { left: 110, right: 24, top: 12, bottom: 36 },
    tooltip: { trigger: 'item' },
    xAxis: { type: 'time', axisLabel: { formatter: (v) => new Date(v).toISOString().slice(11, 19) } },
    yAxis: { type: 'category', data: y },
    dataZoom: [{ type: 'slider', height: 16, bottom: 4 }, { type: 'inside' }],
    series: [{ type: 'custom', renderItem(params, api) {
      const start = api.coord([api.value(0), api.value(2)]);
      const end = api.coord([api.value(1), api.value(2)]);
      const h = api.size([0, 1])[1] * 0.6;
      return { type: 'rect', shape: { x: start[0], y: start[1] - h / 2, width: Math.max(3, end[0] - start[0]), height: h }, style: api.style() };
    }, encode: { x: [0, 1], y: 2 }, data }],
  });
  c.on('datazoom', () => {
    const z = c.getOption().dataZoom[0];
    Object.values(state.charts).forEach((ch) => ch.dispatchAction({ type: 'dataZoom', start: z.start, end: z.end }));
  });
}

async function loadDetail(id) {
  if (!id || !state.selected) return;
  if (state.detail?.id === id && state.detail.felt) return;
  try {
    const full = await client.incident(state.selected, id, state.range);
    if (followId() !== id) return;
    state.detail = full;
    const card = document.getElementById('incCard');
    if (card) card.outerHTML = incidentCard(full);
  } catch (err) { console.warn(err); }
}
function followId() {
  if (state.pinned && state.incidents.some((x) => x.id === state.pinnedId)) return state.pinnedId;
  const open = state.incidents.filter((x) => x.status === 'open');
  const pool = open.length ? open : state.incidents;
  const rank = { critical: 0, warning: 1, ok: 2 };
  pool.sort((a, b) => (rank[a.level] - rank[b.level]) || (Date.parse(b.t0) - Date.parse(a.t0)));
  return pool[0]?.id;
}
function incidentsHTML() {
  const list = state.incidents;
  if (!list.length) return `<div class="inc-empty glass"><div><b>No incidents yet</b><br><span>Each 5 s window is checked as it arrives. Rate incidents open after 2 bad windows.</span></div></div>`;
  const id = followId();
  const x = (state.detail?.id === id ? state.detail : null) || list.find((z) => z.id === id) || list[0];
  return `<div class="inc-list glass" role="listbox"><div class="il-head"><h3>Incidents</h3><span>${list.filter((z) => z.status === 'open').length} open · ${list.length} total</span></div>
    ${list.map((z) => `<button type="button" class="inc-row" data-inc="${esc(z.id)}" aria-selected="${z.id === x.id}"><i class="lv" style="background:${LVL[z.level]}"></i><span class="ir-b"><span class="ir-t">${esc(typeTitle(z.type))}</span><span class="ir-s">${esc(GROUP_LABEL[z.group] || z.group)} · ${clock(z.t0)}</span></span><span class="ir-st ${z.status === 'open' ? 'open' : ''}">${z.status}</span></button>`).join('')}
  </div>${incidentCard(x)}`;
}
function incidentCard(raw) {
  const x = cardModel(raw);
  const open = x.status === 'open';
  const chain = (x.together?.chain || []).map((id) => state.incidents.find((z) => z.id === id)).filter(Boolean);
  return `<article class="inc-card glass" id="incCard"><header><h3>${esc(x.title)}</h3><span class="stag" data-st="${x.level === 'critical' ? 'crit' : 'warn'}">${x.level}</span><span class="${open ? 'ir-st open' : 'ir-st'}">${open ? 'open' : 'closed'}</span></header>
    <p class="felt">${esc(x.felt || '')}</p>
    <p><b>When.</b> ${esc(x.when?.text || '')} · opened after ${x.chunks} bad chunk${x.chunks === 1 ? '' : 's'} · closes after 3 normal chunks</p>
    <p><b>How bad.</b> ${esc(x.how_bad?.headline || '')}${x.how_bad?.worst != null ? ` · worst ${esc(x.how_bad.worst)}` : ''}${x.how_bad?.latest != null ? ` · latest ${esc(x.how_bad.latest)}` : ''}</p>
    <p title="${esc(CONF_TIP[x.confidence] || '')}"><b>Confidence.</b> ${esc(x.confidence || '')}</p>
    <p><b>Together.</b> ${chain.map((z) => esc(typeTitle(z.type))).join(' → ') || (x.together?.related || []).map((r) => esc(typeTitle(r.type || r))).join(' → ') || '—'}${x.together?.groupsLine ? ` · <span class="muted">${esc(x.together.groupsLine)}</span>` : ''}</p>
    <p><b>Where.</b> ${esc(x.who?.name || '—')}${x.where[0] ? ` · ${esc(x.where[0].name || x.where[0].frame || '')}` : ''}</p>
    <ol class="todo">${x.todo.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
    <div class="row"><button type="button" class="btn" data-wic="${esc(x.id)}">Evidence</button>
      <button type="button" class="btn btn-primary" data-ask-inc="${esc(x.id)}">Ask KUSMA</button>
      <button type="button" class="btn" data-show-inc="${esc(x.id)}">Show on chart</button></div>
  </article>`;
}
function onIncClick(e) {
  const b = e.target.closest('[data-inc]');
  if (!b) return;
  state.pinned = true;
  state.pinnedId = b.dataset.inc;
  $('#incWrap').innerHTML = incidentsHTML();
  $('#incWrap').onclick = onIncClick;
  loadDetail(state.pinnedId);
}

function renderChartsPage(m, j) {
  const gc = state.info?.gc?.old || '';
  const entries = navEntries(state.chartList).filter((c) => visibleForGc(c.id, gc) || c.navId === 'flame-graph');
  if (!entries.length) { m.insertAdjacentHTML('beforeend', '<section class="empty glass"><div class="inner"><h2>No charts</h2></div></section>'); return; }
  if (!entries.some((c) => c.navId === state.chartId || c.id === state.chartId)) state.chartId = entries[0].navId;
  m.insertAdjacentHTML('beforeend', `<section class="cp glass" id="chartsPage"><div class="cp-head">
      <button type="button" class="cp-arrow" data-cpstep="-1" aria-label="Previous chart">${icon('chev', 'transform:rotate(90deg)')}</button>
      <button type="button" class="cp-sel" id="cpSel" aria-haspopup="listbox"></button>
      <button type="button" class="cp-arrow" data-cpstep="1" aria-label="Next chart">${icon('chev', 'transform:rotate(-90deg)')}</button>
      <span class="cp-count" id="cpCount"></span><span class="cp-scope">${esc(j.workload)} · JDK ${esc(j.jdk)}</span></div>
    <div class="cp-menu glass" id="cpMenu" hidden><div class="cp-list" id="cpList"></div></div>
    <div class="cp-body" id="cpBody"></div></section>
    <div class="anomaly-pop" id="cxPop" hidden></div>`);
  $('#chartsPage').onclick = (e) => {
    const s = e.target.closest('[data-cpstep]'); if (s) { stepChart(+s.dataset.cpstep, entries); return; }
    if (e.target.closest('#cpSel')) { $('#cpMenu').hidden = !$('#cpMenu').hidden; renderCpList(entries); return; }
    const it = e.target.closest('[data-cpid]'); if (it) { $('#cpMenu').hidden = true; selectChart(it.dataset.cpid, entries); return; }
    const v = e.target.closest('[data-cpview]'); if (v) { drawChartPage(entries, v.dataset.cpview); return; }
    const rg = e.target.closest('[data-cprange]'); if (rg) { state.scope = rg.dataset.cprange; drawChartPage(entries); return; }
    if (e.target.closest('#cpAsk')) openAskChart(entries);
  };
  selectChart(state.chartId, entries);
}
function currentEntry(entries) {
  return entries.find((c) => c.navId === state.chartId) || entries[0];
}
function renderCpList(entries) {
  const groups = [];
  for (const [id, label] of Object.entries(GROUP_LABEL)) {
    const its = entries.filter((c) => (c.group === id) || (c.navId === 'flame-graph' && id === 'cpu' && c.group === 'cpu'));
    const real = entries.filter((c) => c.navId === 'flame-graph' ? id === 'cpu' : c.group === id);
    if (!real.length) continue;
    groups.push(`<div class="cp-grp"><div class="cp-gh"><i class="cx-dot" style="background:${GROUP_COLOR[id]}"></i>${label}</div>${real.map((c) => `<button type="button" class="cp-it${c.navId === state.chartId ? ' on' : ''}" data-cpid="${c.navId}"><span>${esc(c.title)}</span></button>`).join('')}</div>`);
  }
  $('#cpList').innerHTML = groups.join('');
}
function selectChart(id, entries) {
  state.chartId = id;
  const u = new URL(location.href);
  u.searchParams.set('page', 'charts');
  u.searchParams.set('chart', id);
  history.replaceState(null, '', u);
  const i = entries.findIndex((c) => c.navId === id);
  const ch = entries[i];
  $('#cpSel').innerHTML = `<i class="cx-dot" style="background:${GROUP_COLOR[ch.group] || '#7C7EF5'}"></i><span class="cp-sel-t">${esc(ch.title)}</span>${icon('chev', 'width:14px;height:14px')}`;
  $('#cpCount').textContent = `${i + 1} of ${entries.length}`;
  drawChartPage(entries);
}
function stepChart(k, entries) {
  const i = entries.findIndex((c) => c.navId === state.chartId);
  selectChart(entries[(i + k + entries.length) % entries.length].navId, entries);
}
async function drawChartPage(entries, viewId) {
  const ch = currentEntry(entries);
  const body = $('#cpBody');
  const cat = ch.navId === 'flame-graph'
    ? state.chartList.find((c) => c.id === (viewId || ch.views?.[0]?.id))
    : state.chartList.find((c) => c.id === ch.id);
  if (!cat) return;
  const avail = cat.availability;
  const ph = placeholderCopy(avail);
  if (ph) {
    body.innerHTML = `<div class="cp-title"><h2>${esc(cat.title)}</h2></div><div class="cp-ph"><h3>This view needs data this JVM does not have</h3><p>${esc(ph.why)}</p><p class="ph-need"><b>Needs:</b> <code>${esc(ph.needs)}</code></p></div>`;
    return;
  }
  const views = (ch.navId === 'flame-graph' ? ch.views : cat.views) || [];
  const active = viewId || views[0]?.id;
  body.innerHTML = `<div class="cp-title"><h2>${esc(ch.navId === 'flame-graph' ? 'Flame graph' : cat.title)}</h2><p class="cp-take" id="cpTake"></p></div>
    <div class="cp-ctl">${views.length ? `<div class="seg sm">${views.map((v) => `<button type="button" data-cpview="${esc(v.id)}" aria-pressed="${v.id === active}">${esc(v.title)}</button>`).join('')}</div>` : ''}
      <span class="cp-range"><div class="seg sm"><button type="button" data-cprange="all" aria-pressed="${state.scope !== 'worst'}">Whole recording</button><button type="button" data-cprange="worst" aria-pressed="${state.scope === 'worst'}">Worst stretch</button></div></span>
      <button type="button" class="btn btn-primary sm cp-ask" id="cpAsk">${icon('sparkle', 'width:15px;height:15px')}Ask KUSMA</button></div>
    <div class="cp-chart" id="cpChart"></div><div class="cp-foot">${icon('layers', 'width:13px;height:13px')}Catalogue chart <code>${esc(cat.id)}</code></div>`;
  const q = { ...state.range };
  if (state.scope === 'worst') {
    const worst = [...state.incidents].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
    if (worst) { q.from = new Date(Date.parse(worst.t0) - 60_000).toISOString(); q.to = new Date(Date.parse(worst.t1 || worst.t0) + 60_000).toISOString(); delete q.last; }
  }
  const plan = planFor(cat, active);
  let payload;
  try {
    if (plan.source === 'flame') payload = await client.flame(state.selected, plan.group, { kind: cat.frames?.[0], ...q });
    else if (plan.source === 'query') payload = await client.query(state.selected, { metric: plan.metric, by: plan.by, ...q });
    else if (plan.source === 'events') payload = await client.events(state.selected, { type: plan.type, ...q });
    else payload = await client.chart(state.selected, cat.id, { view: active, ...q });
  } catch (err) {
    payload = { summary: err.message };
  }
  const opt = buildOption(plan, payload);
  $('#cpTake').textContent = payload.summary || '';
  const host = $('#cpChart');
  state.pageChart = echarts.init(host, null, { renderer: 'canvas' });
  state.pageChart.setOption(opt);
  const pts = payload.series?.[0]?.points;
  if (pts?.length) state.lastTs[cat.id] = pts[pts.length - 1][0];
}

function openAskChart() {
  const ch = state.chartList.find((c) => c.id === state.chartId) || { id: state.chartId, title: 'Flame graph', group: 'cpu' };
  state.draftChart = { id: ch.id, title: ch.title, group: ch.group, view: 'time', label: ch.title };
  $('#input').value = `Explain the ${ch.title || 'chart'} for this JVM.`;
  openChat(true);
  renderDraftCards();
}
function askIncident(id) {
  const raw = state.incidents.find((x) => x.id === id);
  if (!raw) return;
  const q = questionsFor(raw, state.persona)[0] || '';
  state.draftChart = { id: PRIMARY[raw.group], title: typeTitle(raw.type), group: raw.group, view: 'time', label: typeTitle(raw.type) };
  $('#input').value = q;
  openChat(true);
  renderDraftCards();
}
function showOnChart(id) {
  const raw = state.incidents.find((x) => x.id === id);
  if (!raw) return;
  state.chartId = PRIMARY[raw.group];
  state.scope = 'worst';
  setPage('charts');
}
async function openEvidence(id) {
  const raw = state.incidents.find((x) => x.id === id);
  if (!raw) return;
  let frames = { frames: [] };
  try { frames = await client.frames(state.selected, { kind: 'cpu', focus: raw.where?.[0]?.name || raw.who?.name, ...state.range }); } catch { /* empty tab */ }
  const host = document.createElement('div');
  host.className = 'ev-modal';
  host.innerHTML = `<div class="ev-sheet glass"><header style="display:flex;justify-content:space-between;align-items:center"><h3>Evidence · ${esc(typeTitle(raw.type))}</h3><button class="icon-btn" id="evClose" aria-label="Close">${icon('x')}</button></header>
    <div class="seg sm" id="evTabs"><button data-tab="stack" aria-pressed="true">Stack</button><button data-tab="flame" aria-pressed="false">Flame</button></div>
    <div id="evBody"><ol>${(frames.frames || []).slice(0, 8).map((f) => `<li><code>${esc(f.name || f.frame || '')}</code></li>`).join('') || '<li>No frames in this window.</li>'}</ol></div></div>`;
  document.body.appendChild(host);
  $('#evClose', host).onclick = () => host.remove();
  host.addEventListener('click', (e) => { if (e.target === host) host.remove(); });
  $('#evTabs', host).onclick = async (e) => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    host.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    if (b.dataset.tab === 'flame') {
      try {
        const fl = await client.flame(state.selected, raw.group === 'gc' || raw.group === 'heap' ? 'cpu' : (raw.group === 'threads' ? 'threads' : 'cpu'), state.range);
        const kids = fl.root?.children || [];
        $('#evBody', host).innerHTML = `<ul>${kids.slice(0, 12).map((k) => `<li>${esc(k.name)} · ${esc(k.total)}</li>`).join('') || '<li>No flame.</li>'}</ul>`;
      } catch (err) { $('#evBody', host).innerHTML = `<p>${esc(err.message)}</p>`; }
    }
  };
}

function bindStream() {
  state.stream?.close();
  state.stream = null;
  if (!state.selected || state.selected.st === 'ended') return;
  const connect = () => {
    state.stream = openStream(client.base, state.selected, {
      onOpen() { state.fails = 0; state.backoff = 1000; if (state.workloads.length) setAnalyzer('connected'); },
      onWindow(data) {
        if (!state.live) { state.pausedBuf.push(data); return; }
        applyWindow(data);
      },
      onError() {
        state.fails += 1;
        if (state.fails >= 3 && !qs.get('analyzer')) setAnalyzer('down');
        else setAnalyzer('connecting');
        const wait = state.backoff;
        state.backoff = Math.min(15_000, state.backoff * 2);
        state.stream?.close();
        setTimeout(connect, wait);
      },
    });
  };
  connect();
}
function applyBuffer() {
  for (const w of state.pausedBuf) applyWindow(w);
  state.pausedBuf = [];
  $('#liveCtl') && ($('#liveCtl').innerHTML = liveCtl());
}
function applyWindow(data) {
  if ($('#liveCtl')) $('#liveCtl').innerHTML = liveCtl().replace(/Live · [^<]*/, `Live · ${clock(data.window?.to)}`);
  if (data.opened) {
    for (const o of data.opened) {
      if (!state.incidents.some((x) => x.id === o.id)) state.incidents.unshift({ ...o, status: 'open', t0: data.window.from, t1: null, felt: o.headline, when: {}, how_bad: { headline: o.headline }, together: {}, who: {}, where: [], todo: [] });
    }
  }
  if (data.closed) {
    for (const c of data.closed) {
      const row = state.incidents.find((x) => x.id === c.id);
      if (row) { row.status = 'closed'; row.t1 = c.t1; }
    }
  }
  const wrap = $('#incWrap');
  if (wrap && state.page === 'incidents') {
    const sc = wrap.querySelector('.inc-list')?.scrollTop || 0;
    wrap.innerHTML = incidentsHTML();
    const list = wrap.querySelector('.inc-list');
    if (list) list.scrollTop = sc;
    wrap.onclick = onIncClick;
  }
  const tally = $('#dhTally');
  if (tally) tally.innerHTML = headTally();
  if (state.page === 'incidents') refreshVisible();
}
async function refreshVisible() {
  const ids = state.page === 'charts' && state.chartId ? [state.chartId] : Object.keys(state.charts).map((g) => PRIMARY[g]).filter(Boolean);
  for (const id of ids) {
    const since = state.lastTs[id];
    if (!since || !state.selected) continue;
    try {
      const body = await client.chart(state.selected, id, { ...state.range, since });
      const series = body.series || [];
      for (const s of series) {
        const pts = s.points || [];
        if (pts.length) state.lastTs[id] = pts[pts.length - 1][0];
      }
    } catch { /* next window */ }
  }
}

function chatId() { return state.selected ? jvmKey(state.selected) : 'none'; }
function getChat() { const id = chatId(); return state.chats[id] || (state.chats[id] = { msgs: [], queue: [] }); }
function openChat(on) {
  state.chatOpen = on;
  document.body.dataset.chat = on ? '1' : '0';
  $('#chatWrap').hidden = !on;
  $('#askBtn').setAttribute('aria-pressed', on);
}
function renderChat() {
  const j = state.selected;
  $('#ctxText').textContent = j ? `${j.pod} / ${startLabel(j.start)}` : 'no workload';
  renderMsgs();
  renderDraftCards();
  renderQueue();
  document.querySelectorAll('#persona button').forEach((b) => b.setAttribute('aria-checked', b.dataset.p === state.persona));
}
function renderMsgs() {
  const ch = getChat();
  if (!ch.msgs.length) {
    $('#msgs').innerHTML = `<div class="empty-chat"><p>Ask KUSMA about this JVM.</p>${STARTERS.map((s) => `<button type="button" class="q starter" data-starter="${esc(s)}">${esc(s)}</button>`).join('')}</div>`;
    return;
  }
  $('#msgs').innerHTML = ch.msgs.map((m) => {
    if (m.role === 'user') return `<div class="msg user">${esc(m.text)}</div>`;
    if (m.role === 'think') return `<details class="step think" open><summary>${icon('brain', 'width:14px;height:14px')}<span>Thinking</span></summary><div class="body-in">${esc(m.text)}</div></details>`;
    if (m.role === 'tool') return `<details class="step tool" open><summary><span class="tname">${esc(m.name || 'tool')}</span><span class="targs">${esc(m.args || '')}</span></summary><div class="body-in"><pre>${esc(m.result || '')}</pre></div></details>`;
    if (m.role === 'reply') return `<div class="msg reply${m.live ? ' caret' : ''}">${esc(m.text)}</div>`;
    return '';
  }).join('');
  $('#msgs').scrollTop = $('#msgs').scrollHeight;
}
function renderDraftCards() {
  const c = state.draftChart;
  $('#draftCards').innerHTML = c ? `<div class="ccard chartc"><div class="cbody"><div class="ck">${icon('chart', 'width:12px;height:12px')}${esc(c.label || c.title || c.id)}</div></div><button type="button" class="cx" id="rmDraft" aria-label="Remove">${icon('x', 'width:12px;height:12px')}</button></div>` : '';
  $('#rmDraft')?.addEventListener('click', () => { state.draftChart = null; renderDraftCards(); });
}
function renderQueue() {
  const q = getChat().queue;
  $('#queue').hidden = !q.length;
  $('#queueTitle').textContent = `Queued (${q.length})`;
  $('#queueList').innerHTML = q.map((t) => `<li>${esc(t)}</li>`).join('');
}
function currentContext(message) {
  const j = state.selected;
  const win = state.timeline?.window || state.report?.window;
  const chart = (!message || state.draftChart) && state.draftChart ? {
    id: state.draftChart.id, title: state.draftChart.title, group: state.draftChart.group, view: state.draftChart.view || null,
  } : null;
  return buildContext({
    jvm: j ? { ns: j.ns, pod: j.pod, container: j.container, start: j.start, jdk: j.jdk } : null,
    range: win ? { from: win.from, to: win.to } : null,
    chart,
    selection: null,
    summary: state.report?.headline || null,
    openIncidents: state.incidents.filter((x) => x.status === 'open').slice(0, 8).map((x) => ({ id: x.id, type: x.type, group: x.group, level: x.level, headline: x.how_bad?.headline || x.headline || '' })),
  });
}
async function submitComposer() {
  const text = $('#input').value.trim();
  if (!text) return;
  const ch = getChat();
  if (state.sending) { ch.queue.push(text); $('#input').value = ''; renderQueue(); return; }
  $('#input').value = '';
  autoGrow();
  ch.msgs.push({ role: 'user', text });
  const ctx = currentContext(text);
  state.draftChart = null;
  renderDraftCards();
  renderMsgs();
  await runTurn(text, ctx);
  if (ch.queue.length) {
    const next = ch.queue.shift();
    renderQueue();
    $('#input').value = next;
    submitComposer();
  }
}
async function runTurn(message, context) {
  state.sending = true;
  $('#stopBtn').hidden = false;
  const ch = getChat();
  const ac = new AbortController();
  state.abort = ac;
  const reply = { role: 'reply', text: '', live: true };
  try {
    const res = await fetch(`${harnessBase()}/dummy/harness/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ persona: state.persona === 'expert' ? 'expert' : 'developer', message, context }),
      signal: ac.signal,
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for (const block of parts) {
        const ev = block.match(/^event: (\S+)/m)?.[1];
        const data = block.match(/^data: (.*)$/m)?.[1];
        if (!ev || !data) continue;
        const payload = JSON.parse(data);
        if (ev === 'thought') ch.msgs.push({ role: 'think', text: payload.text });
        if (ev === 'tool_call' && payload.phase === 'start') ch.msgs.push({ role: 'tool', name: payload.tool, args: JSON.stringify(payload.args || {}), result: '' });
        if (ev === 'tool_call' && payload.phase === 'end') {
          const tool = [...ch.msgs].reverse().find((m) => m.role === 'tool' && m.name === payload.tool && !m.result);
          if (tool) tool.result = JSON.stringify(payload.result ?? payload.error ?? '', null, 1).slice(0, 2000);
        }
        if (ev === 'answer_delta') { if (!ch.msgs.includes(reply)) ch.msgs.push(reply); reply.text += payload.text || ''; }
        if (ev === 'done') reply.live = false;
        renderMsgs();
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') ch.msgs.push({ role: 'reply', text: err.message, live: false });
    reply.live = false;
  }
  state.sending = false;
  $('#stopBtn').hidden = true;
  renderMsgs();
}
function autoGrow() {
  const el = $('#input');
  el.style.height = 'auto';
  el.style.height = `${Math.min(160, el.scrollHeight)}px`;
}

async function boot() {
  setAnalyzer('connecting');
  renderMain();
  try {
    state.workloads = await client.workloads();
    state.fails = 0;
    const health = await fetch(`${harnessBase()}/dummy/harness/health`).then((r) => r.json());
    if (!qs.get('laya')) state.svc.laya = health.laya === 'connected' ? 'connected' : 'down';
    if (!qs.get('jafraz')) state.svc.jafraz = health.jafra_z === 'connected' ? 'connected' : 'down';
    state.selected = pickFromUrl();
    if (state.selected) writeJvmUrl(state.selected);
    setAnalyzer(state.selected ? 'connecting' : 'connected');
    renderChips();
    renderIdentity();
    renderTree();
    renderChat();
    bindStream();
    if (state.workloads.length) setAnalyzer('connected');
    await loadJvm();
  } catch (err) {
    console.error(err);
    setAnalyzer('down');
    renderMain();
  }
}

function wire() {
  applyTheme();
  renderChips();
  renderNav();
  openChat(state.chatOpen);
  document.body.dataset.persona = state.persona;
  $('#themeBtn').onclick = () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; applyTheme(); };
  $('#themeSeg').onclick = (e) => { if (e.target.dataset.v) { state.theme = e.target.dataset.v; applyTheme(); } };
  $('#settingsBtn').onclick = (e) => { e.stopPropagation(); $('#settingsPop').hidden = !$('#settingsPop').hidden; };
  $('#clusterBtn').onclick = (e) => { e.stopPropagation(); $('#statusPop').hidden = !$('#statusPop').hidden; };
  $('#main').addEventListener('click', (e) => {
    const a = e.target.closest('[data-ask-inc]'); if (a) { askIncident(a.dataset.askInc); return; }
    const s = e.target.closest('[data-show-inc]'); if (s) { showOnChart(s.dataset.showInc); return; }
    const w = e.target.closest('[data-wic]'); if (w) { openEvidence(w.dataset.wic); }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.popover,#settingsBtn,#clusterBtn,#wlBtn')) document.querySelectorAll('.popover').forEach((p) => { p.hidden = true; });
    const nav = e.target.closest('[data-nav]');
    if (nav) setPage(nav.dataset.nav);
    else if (!e.target.closest('#navPop,#navBtn')) $('#navPop').hidden = true;
  });
  $('#analyzerUrl').value = client.base;
  $('#analyzerUrl').addEventListener('change', () => {
    saveApiBase($('#analyzerUrl').value.trim());
    client = createClient(apiBase());
    boot();
  });
  $('#askBtn').onclick = () => openChat(!state.chatOpen);
  $('#closeChat').onclick = () => openChat(false);
  $('#drawerBtn').onclick = () => { $('#tree').hidden = !$('#tree').hidden; };
  $('#sendBtn').onclick = () => submitComposer();
  $('#stopBtn').hidden = true;
  $('#stopBtn').onclick = () => state.abort?.abort();
  $('#input').addEventListener('input', autoGrow);
  $('#input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitComposer(); }
  });
  $('#composer')?.addEventListener('submit', (e) => e.preventDefault());
  $('#persona')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]'); if (!b) return;
    state.persona = b.dataset.p;
    localStorage.setItem('jz.persona', state.persona);
    document.body.dataset.persona = state.persona;
    renderChat();
  });
  $('#msgs').addEventListener('click', (e) => {
    const s = e.target.closest('[data-starter]');
    if (!s) return;
    state.draftChart = null;
    $('#input').value = s.dataset.starter;
    submitComposer();
  });
  $('#treeSearch')?.addEventListener('input', () => renderTree());
  $('#nsBtn')?.addEventListener('click', (e) => { e.stopPropagation(); const p = $('#nsPop'); if (p) p.hidden = !p.hidden; });
  $('#nsSearch')?.addEventListener('input', () => renderTree());
  $('#nsList')?.addEventListener('click', (e) => {
    const o = e.target.closest('[data-ns]'); if (!o) return;
    state.ns = o.dataset.ns;
    $('#nsPop').hidden = true;
    renderTree();
  });
  $('#treeRoot')?.addEventListener('click', (e) => {
    const row = e.target.closest('[data-key]'); if (!row) return;
    const j = flatJvms().find((x) => jvmKey(x) === row.dataset.key);
    if (j) selectJvm(j);
  });
  $('#dataSeg')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    state.data = b.dataset.v;
    renderMain();
    if (state.data === 'data') loadJvm();
  });
  $('#wlSearch').addEventListener('input', () => renderPicker($('#wlSearch').value));
  $('#wlList').addEventListener('click', (e) => {
    const row = e.target.closest('[data-key]'); if (!row) return;
    const j = flatJvms().find((x) => jvmKey(x) === row.dataset.key);
    if (j) selectJvm(j);
  });
  $('#wlSearch').addEventListener('keydown', (e) => {
    const items = [...document.querySelectorAll('#wlList .jvm')];
    let i = items.findIndex((n) => n.classList.contains('kb'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      items.forEach((n) => n.classList.remove('kb'));
      i = e.key === 'ArrowDown' ? Math.min(items.length - 1, i + 1) : Math.max(0, i - 1);
      items[i]?.classList.add('kb');
      items[i]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && items[i]) items[i].click();
    else if (e.key === 'Escape') $('#wlPop').hidden = true;
  });
  const resizer = $('#resizer');
  resizer?.addEventListener('mousedown', (ev) => {
    ev.preventDefault();
    const move = (e) => {
      const w = Math.max(360, Math.min(window.innerWidth * 0.6, window.innerWidth - e.clientX));
      document.documentElement.style.setProperty('--chat-w', `${w}px`);
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
  document.addEventListener('selectionchange', () => {
    const sel = document.getSelection();
    const text = sel?.toString().trim();
    const ask = $('#selAsk');
    if (!ask) return;
    if (!text || text.length < 3) { ask.hidden = true; return; }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    ask.hidden = false;
    ask.style.left = `${r.left}px`;
    ask.style.top = `${r.bottom + 6}px`;
    ask.onclick = () => { $('#input').value = `About this: ${text}`; ask.hidden = true; openChat(true); };
  });
  window.addEventListener('resize', () => { Object.values(state.charts).forEach((c) => c.resize()); state.seek?.resize(); state.pageChart?.resize(); });
  window.addEventListener('keydown', (e) => {
    if (state.page === 'charts' && (e.key === '[' || e.key === ']') && !e.target.closest('input,textarea')) {
      const entries = navEntries(state.chartList);
      stepChart(e.key === '[' ? -1 : 1, entries);
    }
  });
}

wire();
boot();

export { QT };
