/**
 * Top bar (mockup 850–892): brand · ViewNav · WorkloadIdentityCard with the picker (no sidebar) · Ask KUSMA ·
 * three-service chips · theme · Settings (three service URLs). Plus MainArea gating and the per-JVM data load + SSE.
 */
import { $, $$, api, app, esc, flatJvms, icon, jvmKey, jvmRef, qs, rangeQ, rebuildClient, startClock, state } from './core.js';
import { DOT, SERVICES, STATE_LABEL, allStatus, check, checkAll, getStatus, getUrl, onStatus, proxyAvailable, pushProxyConfig, setProxy, setUrl, useProxy, baseFor, kusmaBlockers } from '../services/config.js';
import { openStream } from '../api/stream.js';

/* ===================================================================== Theme */
export function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  try { localStorage.setItem('jz-theme', state.theme); } catch { /* ignore */ }
  const dark = state.theme === 'dark';
  $('#themeBtn').innerHTML = icon(dark ? 'sun' : 'moon');
  $('#themeBtn').setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  $$('#themeSeg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === state.theme));
}

/* ===================================================================== <StatusChips> (three-service indicator; click → Settings) */
const DETAIL = { analyzer: 'Workloads, incidents and charts.', laya: 'Routes each question.', jafraz: 'Writes the answer.' };
const when = (t) => (t ? new Date(t).toISOString().slice(11, 19) : '');
export function renderChips() {
  const st = allStatus();
  $('#chips').innerHTML = SERVICES.map((s) => {
    const x = st[s.id]; const d = DOT[x.state];
    const extra = x.state === 'unset' ? '<br>Set its URL in Settings.' : x.state === 'unhealthy' ? `<br>${esc(x.error || '')}<br>Last checked ${when(x.checkedAt)}Z` : '';
    const impact = x.state === 'healthy' || x.state === 'checking' ? '' : s.id === 'analyzer' ? '<br>Dashboard cannot load.' : '<br>KUSMA chat is paused.';
    return `<button class="chip" type="button" data-open-settings aria-describedby="tip-${s.id}" aria-label="${s.label}: ${STATE_LABEL[x.state]}. Open settings">
      <i class="dot" data-state="${d}"></i><span class="brand">${s.label}</span>
      <span class="tooltip" role="tooltip" id="tip-${s.id}"><strong><i class="dot" data-state="${d}"></i>${STATE_LABEL[x.state]}</strong>${DETAIL[s.id]}${extra}${impact}</span>
    </button>`;
  }).join('');
  $('#clusterBtn').innerHTML = SERVICES.map((s) => `<i class="dot" data-state="${DOT[st[s.id].state]}"></i>`).join('');
  $('#clusterBtn').setAttribute('aria-label', `Services: ${SERVICES.map((s) => `${s.label} ${STATE_LABEL[st[s.id].state]}`).join(', ')}. Open settings`);
  renderSvcStatus();
}

export function togglePop(pop, btn, force) {
  const open = force !== undefined ? force : pop.hidden;
  $$('.popover').forEach((p) => { if (p !== pop) p.hidden = true; });
  pop.hidden = !open; if (btn) btn.setAttribute('aria-expanded', open);
}
export function openSettings(focusId) {
  togglePop($('#settingsPop'), $('#settingsBtn'), true);
  renderSvcRows();
  const id = focusId || SERVICES.find((s) => getStatus(s.id).state !== 'healthy')?.id;
  if (id) setTimeout(() => $(`#svc-${id}`)?.focus(), 0);
}

/* ===================================================================== <SettingsPane> */
function renderSvcRows() {
  $('#svcRows').innerHTML = SERVICES.map((s) => `<div class="svc-row" data-svc="${s.id}">
    <div class="svc-top"><i class="dot" data-state="unset"></i><b class="brand">${s.label}</b><small>${esc(s.what)}</small><span class="svc-st" data-st="unset">Not configured</span></div>
    <label class="sr-only" for="svc-${s.id}">${s.label} URL</label>
    <input id="svc-${s.id}" type="url" inputmode="url" spellcheck="false" placeholder="${s.example}" value="${esc(getUrl(s.id))}">
    <div class="svc-err" hidden></div></div>`).join('');
  $('#svcProxyRow').hidden = !proxyAvailable();
  $('#svcProxy').checked = useProxy();
  renderSvcStatus();
}
function renderSvcStatus() {
  const st = allStatus();
  for (const s of SERVICES) {
    const row = document.querySelector(`.svc-row[data-svc="${s.id}"]`); if (!row) continue;
    const x = st[s.id];
    row.querySelector('.dot').dataset.state = DOT[x.state];
    const p = row.querySelector('.svc-st'); p.dataset.st = x.state; p.textContent = STATE_LABEL[x.state];
    const e = row.querySelector('.svc-err');
    e.hidden = x.state !== 'unhealthy';
    e.innerHTML = x.state === 'unhealthy' ? `${esc(x.error || 'unreachable')} <small>· checked ${when(x.checkedAt)}Z</small>` : '';
  }
  const last = Math.max(0, ...SERVICES.map((s) => st[s.id].checkedAt || 0));
  const c = $('#svcChecked'); if (c) c.textContent = last ? `checked ${when(last)}Z · every 15 s` : 'checked every 15 s';
}
async function saveServices(e) {
  e && e.preventDefault();
  const before = baseFor('analyzer');
  for (const s of SERVICES) setUrl(s.id, $(`#svc-${s.id}`).value);
  if (proxyAvailable()) setProxy($('#svcProxy').checked);
  // a one-off ?analyzer_url= / ?api= override would shadow the saved value: drop it from the URL
  const u = new URL(location.href); let changed = false;
  for (const k of ['api', 'analyzer_url', 'laya_url', 'jafraz_url']) if (u.searchParams.has(k)) { u.searchParams.delete(k); changed = true; }
  if (changed) history.replaceState(null, '', u);
  await pushProxyConfig();
  rebuildClient();
  const btn = $('#svcSave'); btn.disabled = true; btn.textContent = 'Checking…';
  await checkAll();
  btn.disabled = false; btn.textContent = 'Save';
  if (baseFor('analyzer') !== before || state.workloads == null) loadWorkloads();
}
async function testServices() {
  const b = $('#svcTest'); b.disabled = true;
  await Promise.all(SERVICES.map((s) => check(s.id, $(`#svc-${s.id}`).value)));
  b.disabled = false;
}

/* ===================================================================== <ViewNav> (mockup 2183–2207) */
const NAV_IC = {
  incidents: '<path d="M3 3h7v8H3zM12 3h9v5h-9zM12 10h9v11h-9zM3 13h7v8H3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  charts: '<path d="M3 20h18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="5" y="11" width="3" height="7" rx="1" fill="currentColor" opacity=".55"/><rect x="10.5" y="6" width="3" height="12" rx="1" fill="currentColor"/><rect x="16" y="9" width="3" height="9" rx="1" fill="currentColor" opacity=".75"/>',
};
const NAV_T = { incidents: ['Incidents', 'What went wrong and why'], charts: ['Charts', 'Every JFR view, one at a time'] };
const navSvg = (p) => `<svg viewBox="0 0 24 24" class="nav-ic" aria-hidden="true">${NAV_IC[p]}</svg>`;
export function renderNav() {
  const c = $('#navCard'); const pop = $('#navPop'); const p = state.page;
  c.innerHTML = `<button type="button" class="nav-btn" id="navBtn" aria-haspopup="menu" aria-expanded="${!pop.hidden}" aria-label="Switch view (now ${NAV_T[p][0]})">${navSvg(p)}<span class="nav-chev" aria-hidden="true"><svg viewBox="0 0 12 12"><circle cx="6" cy="6" r="5.2" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M3.8 5.2L6 7.4l2.2-2.2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg></span></button>`;
  pop.innerHTML = Object.keys(NAV_T).map((k) => `<button type="button" class="nav-it${k === p ? ' on' : ''}" role="menuitemradio" aria-checked="${k === p}" data-nav="${k}">${navSvg(k)}<span><b>${NAV_T[k][0]}</b><small>${NAV_T[k][1]}</small></span>${k === p ? `${icon('chev', 'transform:rotate(-90deg);width:12px;height:12px;opacity:0')}<i class="nav-on"></i>` : ''}</button>`).join('');
}
function openNav(open) {
  const pop = $('#navPop'); const b = $('#navBtn'); open = open == null ? pop.hidden : open; pop.hidden = !open; if (b) b.setAttribute('aria-expanded', open); navTip(false);
  if (open) { const r = $('#navCard').getBoundingClientRect(); const tb = pop.offsetParent ? pop.offsetParent.getBoundingClientRect() : { left: 0, top: 0 }; pop.style.left = `${r.left - tb.left}px`; pop.style.top = `${r.bottom - tb.top + 8}px`; (pop.querySelector('.on') || pop.querySelector('.nav-it')).focus(); }
}
let NTIP = null;
function navTip(on) {
  if (!NTIP) { NTIP = document.createElement('div'); NTIP.className = 'wl-tip'; NTIP.setAttribute('role', 'tooltip'); NTIP.textContent = 'Switch view'; NTIP.hidden = true; document.body.appendChild(NTIP); }
  if (!on || !$('#navPop').hidden) { NTIP.hidden = true; return; }
  const r = $('#navCard').getBoundingClientRect(); NTIP.hidden = false; NTIP.style.left = `${r.left}px`; NTIP.style.top = `${r.bottom + 8}px`;
}
export function setPage(pg) {
  if (pg === state.page) { openNav(false); return; }
  state.page = pg; const u = new URL(location.href);
  if (pg === 'charts') u.searchParams.set('page', 'charts'); else { u.searchParams.delete('page'); u.searchParams.delete('chart'); }
  history.replaceState(null, '', u); openNav(false); app.hidePops?.(); renderNav(); renderMain();
}

/* ===================================================================== <WorkloadPicker> (mockup 1102–1157; replaces the sidebar) */
const PK = { kb: -1 };
const hl = (s, q) => { s = String(s); if (!q) return esc(s); const i = s.toLowerCase().indexOf(q); return i < 0 ? esc(s) : `${esc(s.slice(0, i))}<mark>${esc(s.slice(i, i + q.length))}</mark>${esc(s.slice(i + q.length))}`; };
function grouped() {
  const ns = new Map();
  for (const j of flatJvms()) {
    if (!ns.has(j.ns)) ns.set(j.ns, new Map());
    const g = ns.get(j.ns); const gk = `${j.workload}|${j.kind}`;
    if (!g.has(gk)) g.set(gk, { base: j.workload, kind: j.kind, pods: new Map() });
    const p = g.get(gk).pods; if (!p.has(j.pod)) p.set(j.pod, { pod: j.pod, suffix: j.suffix, ctrs: new Map() });
    const c = p.get(j.pod).ctrs; if (!c.has(j.container)) c.set(j.container, []);
    c.get(j.container).push(j);
  }
  return ns;
}
function renderPicker() {
  const q = $('#wlSearch').value.trim().toLowerCase(); const m = (s) => !q || String(s).toLowerCase().includes(q); let html = '';
  for (const [ns, groups] of grouped()) {
    let body = ''; let nPods = 0; let nJvms = 0;
    for (const g of groups.values()) {
      let gb = '';
      for (const p of g.pods.values()) {
        nPods += 1; let pb = '';
        for (const [c, jvms] of p.ctrs) {
          nJvms += jvms.length;
          const js = jvms.filter((j) => m(ns) || m(g.base) || m(p.pod) || m(c) || m(j.start)).sort((a, b) => b.startMs - a.startMs);
          if (!js.length) continue;
          pb += `<li class="pk-row lv3"><span class="kind">ctr</span><span class="lbl">${hl(c, q)}</span></li>${js.map((j) => {
            const sel = state.selected && jvmKey(state.selected) === jvmKey(j); const id = `pk-${btoa(jvmKey(j)).replace(/[^a-z0-9]/gi, '')}`;
            const hasChat = (state.chats[jvmKey(j)]?.msgs || []).some((x) => x.role === 'user');
            return `<li class="pk-row lv4 jvm" role="option" id="${id}" data-jvm="${esc(jvmKey(j))}" aria-selected="${!!sel}"><span class="kind">jvm</span><i class="dot" data-state="${j.st}" aria-label="${j.st}"></i><span class="lbl mono" title="JVM started ${esc(j.start)}">${hl(startClock(j.start), q)}</span>${hasChat ? icon('q', 'width:12px;height:12px;color:var(--periwinkle-strong)') : ''}${sel ? '<span class="cur">current</span>' : ''}<span class="meta2">JDK ${esc(j.jdk)}</span></li>`;
          }).join('')}`;
        }
        if (pb) gb += `<li class="pk-row lv2"><i class="dot" data-state="ended"></i><span class="lbl" title="${esc(p.pod)}">${p.suffix ? `<span class="muted">…-</span>${hl(p.suffix, q)}` : hl(p.pod, q)}</span><span class="pod-full">${hl(p.pod, q)}</span></li>${pb}`;
      }
      if (gb) body += `<li class="pk-row lv1"><span class="lbl">${hl(g.base, q)}</span><span class="kindhint" title="Inferred from pod name">${g.kind === 'Pod' ? 'Pod' : `${g.kind}?`}</span></li>${gb}`;
    }
    if (body) html += `<li class="pk-row lv0">${icon('layers', 'width:14px;height:14px;color:var(--periwinkle-strong)')}<span class="lbl">${hl(ns, q)}</span><span class="cnt">${groups.size} wl · ${nPods} pods · ${nJvms} JVMs</span></li>${body}`;
  }
  $('#wlList').innerHTML = html || `<li class="pk-empty">No workload matches “${esc(q)}”.</li>`;
  const opts = $$('#wlList .jvm'); if (PK.kb >= opts.length) PK.kb = opts.length - 1;
  if (PK.kb < 0) { const s = opts.findIndex((o) => o.getAttribute('aria-selected') === 'true'); PK.kb = q ? 0 : Math.max(0, s); }
  opts.forEach((o, i) => o.classList.toggle('kb', i === PK.kb)); const k = opts[PK.kb];
  if (k) { k.scrollIntoView({ block: 'nearest' }); $('#wlSearch').setAttribute('aria-activedescendant', k.id); }
}
export function openPicker(open, anchor) {
  const p = $('#wlPop'); p.hidden = !open; $$('.wl-btn').forEach((x) => x.setAttribute('aria-expanded', open));
  if (open) {
    const a = (anchor || $('#identCard')).getBoundingClientRect(); const tb = $('.topbar').getBoundingClientRect(); const W = Math.min(420, innerWidth - 16);
    p.style.width = `${W}px`; p.style.left = `${Math.max(8, Math.min(innerWidth - W - 8, a.left)) - tb.left}px`; p.style.top = `${a.bottom - tb.top + 8}px`;
    $('#wlSearch').value = ''; PK.kb = -1; renderPicker(); setTimeout(() => $('#wlSearch').focus(), 0);
  }
}

/* ===================================================================== <WorkloadIdentityCard> (mockup identHTML) */
const WL_BTN = (dis) => `<button type="button" class="wl-btn" aria-label="Select workload" aria-haspopup="dialog" aria-controls="wlPop" aria-expanded="false"${dis ? ' disabled' : ''}><svg viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></svg></button>`;
export function identHTML(j) {
  const gc = state.info?.gc?.old || state.info?.gc?.young || '';
  return `<div class="id-main"><div class="crumb">${icon('pod', 'width:12px;height:12px')}<span title="Namespace">${esc(j.ns)}</span><i class="sep">›</i><span title="Workload (inferred)">${esc(j.workload)}</span><i class="sep c-pod">›</i><span class="c-pod" title="${esc(j.pod)}">${esc(j.suffix || j.pod)}</span><i class="sep">›</i><span title="Container">${esc(j.container)}</span>${WL_BTN(false)}</div>
    <div class="id-title"><i class="dot" data-state="${j.st}" aria-hidden="true"></i><b>${esc(startClock(j.start))}Z</b><span class="pidtag">${esc(j.profile || 'jvm')}</span><span class="pidtag">${gc ? `${esc(gc.replace(/Old$|New$/, ''))} · ` : ''}JDK ${esc(j.jdk)}</span></div></div>
    <div class="id-meta">
      <div class="meta m-ns"><small>Namespace</small><span>${esc(j.ns)}</span></div>
      <div class="meta m-pod"><small>Pod</small><span title="${esc(j.pod)}">${esc(j.pod)}</span></div>
      <div class="meta m-ctr"><small>Container</small><span>${esc(j.container)}</span></div>
      <div class="meta m-jvm"><small>JVM · started</small><span title="${esc(j.start)}">${esc(startClock(j.start).slice(11))}Z · JDK ${esc(j.jdk)}</span></div>
    </div>`;
}
export function renderIdentity() {
  const c = $('#identCard'); const a = getStatus('analyzer').state; const j = state.selected;
  if (a !== 'healthy' || !j) {
    const t = a === 'unset' ? 'Analyzer not configured' : a === 'unhealthy' ? 'Analyzer unreachable' : a === 'checking' ? 'Connecting…' : state.workloads && !state.workloads.length ? 'No JVMs yet' : 'No workload selected';
    c.innerHTML = `<div class="id-main"><div class="crumb id-empty">${icon('pod', 'width:14px;height:14px')}<span>${t}</span>${WL_BTN(a !== 'healthy' || !state.workloads?.length)}</div>${a === 'unset' || a === 'unhealthy' ? '<div class="id-title"><button type="button" class="linkish" data-open-settings>Open settings</button></div>' : ''}</div>`;
    return;
  }
  c.innerHTML = identHTML(j);
}

/* ===================================================================== <MainArea> gating (NOT CONFIGURED / UNREACHABLE / HEALTHY) */
function emptyState(kind) {
  const m = $('#main'); const a = getStatus('analyzer');
  m.innerHTML = $('#tpl-no-analyzer').innerHTML;
  if (kind === 'unset') {
    $('#naTitle').textContent = 'Analyzer not configured';
    $('#naText').textContent = 'Set the Analyzer URL (the jafra-analyzer v2 API base) in Settings to load workloads, incidents and charts.';
    $('#naDetail').innerHTML = `Example: <code>http://localhost:8080</code>${proxyAvailable() ? ' · same-origin dev proxy available' : ''}`;
    $('#retryBtn').remove();
    $('#naSettings').classList.add('btn-primary');
  } else {
    $('#naTitle').textContent = 'Analyzer unreachable';
    $('#naText').textContent = 'Jafra Z needs the analyzer to show incidents and charts.';
    $('#naDetail').innerHTML = `Tried <code>${esc(getUrl('analyzer'))}/v2/workloads</code>${useProxy() ? ' via the dev proxy' : ''} · ${esc(a.error || state.wlError || 'no answer')} · last checked ${when(a.checkedAt)}Z`;
    $('#retryBtn').textContent = 'Retry';
    $('#retryBtn').onclick = async () => { $('#retryBtn').disabled = true; await check('analyzer'); if (getStatus('analyzer').state === 'healthy') loadWorkloads(); else renderMain(); };
  }
}
export function renderMain() {
  app.hidePops?.();
  app.disposeCharts?.();
  const m = $('#main'); const a = getStatus('analyzer').state;
  if (a === 'unset') return emptyState('unset');
  if (a === 'unhealthy' || (a === 'healthy' && state.wlError)) return emptyState('unhealthy');
  if (a === 'checking' || state.workloads == null) { m.innerHTML = $('#tpl-connecting').innerHTML; return; }
  if (!state.workloads.length) { m.innerHTML = $('#tpl-no-data').innerHTML; $('#refreshBtn').onclick = () => loadWorkloads(); return; }
  const j = state.selected; if (!j) { m.innerHTML = ''; return; }
  m.innerHTML = `<section class="ident-mobile ident glass" data-component="WorkloadIdentityCard.mobile">${identHTML(j)}</section>`;
  if (!state.report && !state.loadError) { m.insertAdjacentHTML('beforeend', $('#tpl-connecting').innerHTML.replace('Connecting to Jafra Analyzer…', 'Loading this JVM…')); return; }
  if (state.loadError) { m.insertAdjacentHTML('beforeend', `<section class="empty glass"><div class="inner"><h2>Could not load this JVM</h2>${app.errHTML(state.loadError)}<div class="na-btns"><button class="btn btn-primary" id="reloadJvm">Retry</button></div></div></section>`); $('#reloadJvm').onclick = () => loadJvm(); return; }
  (state.page === 'charts' ? app.renderCharts : app.renderDashboard)(m, j);
}

/* ===================================================================== data: workloads, JVM, SSE */
let wlSeq = 0;
export async function loadWorkloads() {
  const seq = ++wlSeq; state.wlError = null;
  if (getStatus('analyzer').state !== 'healthy') { state.workloads = getStatus('analyzer').state === 'unset' ? [] : null; closeStream(); renderAll(); return; }
  state.workloads = null; renderAll();
  try {
    const w = await api.client.workloads();
    if (seq !== wlSeq) return;
    state.workloads = Array.isArray(w) ? w : [];
  } catch (e) { if (seq !== wlSeq) return; state.workloads = []; state.wlError = e.message; }
  const all = flatJvms();
  const keep = state.selected && all.find((j) => jvmKey(j) === jvmKey(state.selected));
  const pick = keep || pickFromUrl(all);
  if (pick && (!state.selected || jvmKey(pick) !== jvmKey(state.selected) || !state.report)) { selectJvm(pick); return; }
  if (!pick) { state.selected = null; closeStream(); }
  renderAll();
}
function pickFromUrl(all) {
  const spec = qs.get('jvm');
  if (spec) {
    const [ns, pod, container] = spec.split('/'); const start = qs.get('start');
    const hit = all.find((j) => j.ns === ns && j.pod === pod && j.container === container && (!start || String(j.startMs) === start || j.start === start));
    if (hit) return hit;
  }
  return all.find((j) => j.st === 'live') || all[0] || null;
}
function writeJvmUrl(j) {
  const u = new URL(location.href);
  u.searchParams.set('jvm', `${j.ns}/${j.pod}/${j.container}`); u.searchParams.set('start', String(j.startMs));
  if (j.cluster) u.searchParams.set('cluster', j.cluster);
  history.replaceState(null, '', u);
}
export function selectJvm(j) {
  app.saveDraft?.();
  state.selected = j; state.report = null; state.timeline = null; state.incidents = []; state.chartList = []; state.starters = null; state.info = null; state.loadError = null;
  writeJvmUrl(j);
  renderAll();
  loadJvm();
}
let jvmSeq = 0;
export async function loadJvm() {
  const j = state.selected; if (!j) return; const seq = ++jvmSeq; const ref = jvmRef(j); const c = api.client;
  state.loadError = null;
  try {
    const [report, timeline, incs, charts, info, starters] = await Promise.all([
      c.report(ref, rangeQ()), c.timeline(ref, rangeQ()), c.incidents(ref, rangeQ()), c.charts(ref), c.jvmInfo(ref).catch(() => null),
      c.starters(ref).catch(() => null)]);
    if (seq !== jvmSeq) return;
    Object.assign(state, { report, timeline, incidents: incs.incidents || [], chartList: charts.charts || [], info,
      starters: starters && (starters.developer || starters.expert) ? starters : null });
  } catch (e) { if (seq !== jvmSeq) return; state.loadError = e; }
  renderIdentity(); renderMain(); app.renderChat?.();
  openJvmStream();
}

let STREAM = null; let refreshTimer = null;
export function closeStream() { if (STREAM) { STREAM.close(); STREAM = null; } }
function openJvmStream() {
  closeStream();
  const j = state.selected; if (!j || getStatus('analyzer').state !== 'healthy') return;
  STREAM = openStream(baseFor('analyzer'), jvmRef(j), {
    onWindow: () => { if (!state.live) { state.pending = true; app.syncLive?.(); return; } clearTimeout(refreshTimer); refreshTimer = setTimeout(refreshLive, 250); },
  });
}
/** One SSE window (5 s): timeline, incidents and report again, then the visible charts (decision 10). */
export async function refreshLive() {
  const j = state.selected; if (!j) return; const ref = jvmRef(j); const c = api.client; const seq = jvmSeq;
  try {
    const [report, timeline, incs] = await Promise.all([c.report(ref, rangeQ()), c.timeline(ref, rangeQ()), c.incidents(ref, rangeQ())]);
    if (seq !== jvmSeq) return;
    Object.assign(state, { report, timeline, incidents: incs.incidents || [], lastWindow: Date.now(), pending: false });
    app.liveUpdate?.();
  } catch { /* keep the last good data; the health check reports the analyzer */ }
}

/* ===================================================================== render all + wiring */
export function renderAll() {
  renderChips(); renderIdentity(); renderNav(); renderMain(); app.renderChat?.();
}

let lastAnalyzerState = getStatus('analyzer').state;
export function wireShell() {
  $('#themeBtn').onclick = () => { state.theme = state.theme === 'dark' ? 'light' : 'dark'; applyTheme(); renderMain(); };
  $('#themeSeg').onclick = (e) => { if (e.target.dataset.v) { state.theme = e.target.dataset.v; applyTheme(); renderMain(); } };
  $('#settingsBtn').onclick = (e) => { e.stopPropagation(); if ($('#settingsPop').hidden) openSettings(); else togglePop($('#settingsPop'), $('#settingsBtn'), false); };
  $('#clusterBtn').onclick = (e) => { e.stopPropagation(); openSettings(); };
  $('#svcForm').addEventListener('submit', saveServices);
  $('#svcTest').onclick = testServices;
  document.addEventListener('click', (e) => {
    const os = e.target.closest('[data-open-settings]');
    if (os) { e.stopPropagation(); openSettings(); return; }
    if (!e.target.closest('.popover,#settingsBtn,#clusterBtn,.chip')) $$('.popover').forEach((p) => { p.hidden = true; });
    const b = e.target.closest('.wl-btn');
    if (b) { e.stopPropagation(); if (!b.disabled) openPicker($('#wlPop').hidden, b.closest('.ident') || b); return; }
    const p = $('#wlPop'); if (p && !p.hidden && !e.target.closest('#wlPop')) openPicker(false);
    if (e.target.closest('#navBtn')) { openNav(); return; }
    const it = e.target.closest('[data-nav]'); if (it) { setPage(it.dataset.nav); return; }
    if (!e.target.closest('#navPop')) openNav(false);
  });
  document.addEventListener('keydown', (e) => {
    const pop = $('#navPop');
    if (e.key === 'Escape') { $$('.popover').forEach((p) => { p.hidden = true; }); if (!pop.hidden) { openNav(false); $('#navBtn')?.focus(); } }
    if (!pop.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); const its = $$('.nav-it', pop); const i = its.indexOf(document.activeElement); its[(i + (e.key === 'ArrowDown' ? 1 : -1) + its.length) % its.length].focus(); }
  });
  document.addEventListener('mouseover', (e) => { if (e.target.closest('#navCard')) navTip(true); });
  document.addEventListener('mouseout', (e) => { if (e.target.closest('#navCard') && !e.relatedTarget?.closest?.('#navCard')) navTip(false); });
  $('#wlSearch').oninput = () => { PK.kb = -1; renderPicker(); };
  $('#wlSearch').onkeydown = (e) => {
    const o = $$('#wlList .jvm');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); PK.kb = Math.max(0, Math.min(o.length - 1, PK.kb + (e.key === 'ArrowDown' ? 1 : -1))); renderPicker(); }
    else if (e.key === 'Enter') { e.preventDefault(); const k = o[PK.kb]; if (k) { openPicker(false); const j = flatJvms().find((x) => jvmKey(x) === k.dataset.jvm); if (j) selectJvm(j); } }
    else if (e.key === 'Escape') { e.stopPropagation(); openPicker(false); $('#identCard .wl-btn')?.focus(); }
  };
  $('#wlList').onclick = (e) => { const r = e.target.closest('.jvm'); if (r) { openPicker(false); const j = flatJvms().find((x) => jvmKey(x) === r.dataset.jvm); if (j) selectJvm(j); } };
  window.addEventListener('resize', () => { openPicker(false); openNav(false); });
  // mockup wl-tip "Select workload"
  const t = document.createElement('div'); t.className = 'wl-tip'; t.setAttribute('role', 'tooltip'); t.hidden = true; t.textContent = 'Select workload'; document.body.appendChild(t);
  const show = (b) => { const r = b.getBoundingClientRect(); t.hidden = false; t.style.left = `${Math.max(8, r.left + r.width / 2 - t.offsetWidth / 2)}px`; t.style.top = `${r.bottom + 8}px`; };
  document.addEventListener('mouseover', (e) => { const b = e.target.closest?.('.wl-btn'); if (b && $('#wlPop').hidden && !b.disabled) show(b); });
  document.addEventListener('mouseout', (e) => { if (e.target.closest?.('.wl-btn')) t.hidden = true; });
  document.addEventListener('click', () => { t.hidden = true; }, true);

  onStatus((id) => {
    renderChips();
    if (id === 'analyzer') {
      const s = getStatus('analyzer').state;
      if (s !== lastAnalyzerState) {
        lastAnalyzerState = s;
        if (s === 'healthy') loadWorkloads();
        else if (s !== 'checking' && s !== 'healthy') { closeStream(); renderIdentity(); renderMain(); }
        else if (s === 'checking' && state.workloads == null) renderMain();
      }
    }
    app.renderChatState?.();
  });
  void kusmaBlockers;
}
