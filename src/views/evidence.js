/**
 * EvidenceModal (mockup evEl / openEvidence / evTab / stacksHTML / drawEvFlame, 1277–1308):
 * "Where in code" for one incident. Stack frames from J/frames (paths), flame graph from J/flame/{group} over the incident window.
 * Also reused for "the call's flame graph" from the endpoint charts (openFlameModal).
 */
import { $, api, app, esc, icon, jvmRef, state } from '../app/core.js';
import { FRAME_UNIT, GROUP_KIND, INCIDENT_FLAME, flCats, flLegendHTML, renderFlame, toTree } from '../flame/flame.js';
import { clock, errHTML, groupName, incTitle, isOpen } from './shared.js';

const EVM = { tab: 'stack', fv: { zoom: null, flip: false }, ret: null, fl: null, unit: '', seq: 0 };
function evEl() {
  let m = document.getElementById('evModal'); if (m) return m;
  document.body.insertAdjacentHTML('beforeend', `<div class="ev-modal" id="evModal" hidden data-component="EvidenceModal"><div class="ev-scrim" data-evclose></div>
    <div class="ev-dlg" role="dialog" aria-modal="true" aria-labelledby="evTitle"><header class="ev-h"><div><h3 id="evTitle"></h3><div class="ev-sub" id="evSub"></div><div class="fl-legend" id="evLegend" aria-label="Colour legend"></div></div>
      <button type="button" class="ev-x" data-evclose aria-label="Close">${icon('x', 'width:16px;height:16px')}</button></header>
      <div class="ev-tabs" role="tablist" aria-label="Evidence view"><button type="button" role="tab" id="evTabStack" data-tab="stack" aria-controls="evStack">Stack frames</button><button type="button" role="tab" id="evTabFlame" data-tab="flame" aria-controls="evFlame">Flame graph</button></div>
      <div class="ev-pane" id="evStack" role="tabpanel" aria-labelledby="evTabStack"></div>
      <div class="ev-pane" id="evFlame" role="tabpanel" aria-labelledby="evTabFlame" hidden></div></div></div>`);
  m = document.getElementById('evModal');
  m.addEventListener('click', (e) => { if (e.target.closest('[data-evclose]')) { closeEvidence(); return; } const t = e.target.closest('[data-tab]'); if (t) evTab(t.dataset.tab); });
  m.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeEvidence(); }
    if (e.key === 'Tab') { const f = [...m.querySelectorAll('button:not([hidden]),canvas[tabindex],input')].filter((b) => b.offsetParent); if (!f.length) return; const a = f[0]; const z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } }
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && e.target.closest('[role=tab]')) { evTab(EVM.tab === 'stack' ? 'flame' : 'stack'); m.querySelector(`[data-tab="${EVM.tab}"]`).focus(); }
  });
  addEventListener('resize', () => { if (!m.hidden && EVM.tab === 'flame') drawEvFlame(); });
  return m;
}
function closeEvidence() { const m = document.getElementById('evModal'); if (!m || m.hidden) return; m.hidden = true; const t = $('#flTip'); if (t) t.hidden = true; document.documentElement.classList.remove('ev-open'); if (EVM.ret?.isConnected) EVM.ret.focus(); }
function evTab(t) {
  EVM.tab = t; const m = evEl();
  m.querySelectorAll('[role=tab]').forEach((b) => { const on = b.dataset.tab === t; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; b.hidden = b.dataset.tab === 'stack' && EVM.noStack; });
  $('#evStack').hidden = t !== 'stack'; $('#evFlame').hidden = t !== 'flame'; if (t === 'flame') drawEvFlame();
}
function drawEvFlame() {
  const host = $('#evFlame');
  if (EVM.flErr) { host.innerHTML = errHTML(EVM.flErr); return; }
  if (!EVM.fl) { host.innerHTML = '<p class="muted ev-note">Loading the flame graph…</p>'; return; }
  renderFlame(host, EVM.fl, { unit: EVM.unit, legend: false, st: EVM.fv, empty: "This incident's event carried no stacks in its window.",
    onSelect: EVM.onSelect });
}
function frKind(cat) { return cat === 'app' ? 'app' : cat === 'native' || cat === 'jvm' ? 'nat' : 'jdk'; }
function stacksHTML(fr, unit) {
  const paths = fr.paths || []; const cat = Object.fromEntries((fr.frames || []).map((f) => [f.frame, f.category]));
  const guess = (f) => cat[f] || (/^(java|javax|jdk|sun|com\.sun)\./.test(f) ? 'jdk' : /::|^\[|\.so\b|^lib/.test(f) ? 'native' : 'app');
  if (!paths.length) return `<p class="ev-note">No stacks for this event in the window.</p>${(fr.frames || []).length ? `<ol class="ev-frames">${fr.frames.map((f) => `<li class="fr-${frKind(f.category)}"><code>${esc(f.frame)}</code> <span class="fr-tag">${f.total_pct}%</span></li>`).join('')}</ol>` : ''}`;
  return `<p class="ev-note">The ${paths.length === 1 ? 'most common stack' : `${paths.length} most common stacks`} in this window, top frame first. ${(fr.flags || []).includes('estimate') ? 'Shares are estimates.' : ''}</p>
  ${paths.map((t, i) => `<section class="ev-stack"><div class="ev-sh"><b>Stack ${i + 1}</b><span class="ev-share"><b>${Math.round(t.share_pct)}%</b> of ${(fr.n || fr.total || 0).toLocaleString('en-US')} ${esc(unit)}</span></div>
    <ol class="ev-frames">${t.frames.map((f) => { const k = frKind(guess(f)); return `<li class="fr-${k}" title="${esc(f)}"><code>${esc(f)}</code>${k === 'nat' ? '<span class="fr-tag">native</span>' : ''}</li>`; }).join('')}</ol></section>`).join('')}`;
}

/** Incident → stack frames + flame over [t0, t1] (decision 3: "incident detail shows the flame for the incident's window"). */
export async function openEvidence(id) {
  const x = state.incidents.find((z) => z.id === id); if (!x) return;
  const group = INCIDENT_FLAME[x.group] || 'cpu'; const kind = GROUP_KIND[group]; const unit = FRAME_UNIT[kind] || 'samples';
  const from = x.t0; const to = isOpen(x) || !x.t1 ? new Date().toISOString() : x.t1;
  await open({ title: `Where in code · ${esc(incTitle(x))}`, sub: `<code>J/flame/${group}?kind=${kind}</code> · ${esc(groupName(x.group))} · ${clock(from)}–${isOpen(x) ? 'now' : clock(to)} UTC`, group, kind, unit, from, to, stacks: true });
}
app.openEvidence = openEvidence;
/** Flame for any window (endpoint slow call / wait cause). */
export async function openFlameModal({ title, group, kind, from, to, sub, onSelect }) {
  await open({ title, sub, group, kind: kind || GROUP_KIND[group], unit: FRAME_UNIT[kind || GROUP_KIND[group]] || 'samples', from, to, stacks: false, onSelect });
}
async function open(o) {
  const m = evEl(); const seq = ++EVM.seq; EVM.ret = document.activeElement; EVM.fv = { zoom: null, flip: false }; EVM.fl = null; EVM.flErr = null; EVM.unit = o.unit; EVM.noStack = !o.stacks; EVM.onSelect = o.onSelect;
  $('#evTitle').innerHTML = o.title; $('#evSub').innerHTML = o.sub; $('#evLegend').innerHTML = '';
  $('#evStack').innerHTML = '<p class="muted ev-note">Loading stacks…</p>'; $('#evFlame').innerHTML = '';
  m.hidden = false; document.documentElement.classList.add('ev-open'); evTab(o.stacks ? EVM.tab : 'flame'); m.querySelector('.ev-x').focus();
  const ref = jvmRef(state.selected); const q = { from: o.from, to: o.to };
  const [fl, fr] = await Promise.all([
    api.client.flame(ref, o.group, { ...q, kind: o.kind }).then((b) => ({ b }), (e) => ({ e: e.body || e })),
    o.stacks ? api.client.frames(ref, { ...q, kind: o.kind }).then((b) => ({ b }), (e) => ({ e: e.body || e })) : Promise.resolve(null)]);
  if (seq !== EVM.seq) return;
  if (fl.e) EVM.flErr = fl.e; else { EVM.fl = toTree(fl.b); $('#evLegend').innerHTML = EVM.fl ? flLegendHTML(flCats(EVM.fl)) : ''; $('#evSub').insertAdjacentHTML('beforeend', ` · <b>${(EVM.fl?.total || 0).toLocaleString('en-US')}</b> ${esc(o.unit)}`); }
  if (fr) $('#evStack').innerHTML = fr.e ? errHTML(fr.e) : stacksHTML(fr.b, o.unit);
  if (EVM.tab === 'flame') drawEvFlame();
}
