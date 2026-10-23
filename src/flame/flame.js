/**
 * Flame graph, ported from the v4.3 mockup (jafra-z-dashboard.html renderFlame / flTakeaway / FL_COL / FL_CAT).
 * Same canvas renderer: 20 px rows, classic bottom-up (flip = icicle), width = share of the parent, hover tip,
 * click to zoom (+ onSelect), breadcrumbs, Reset zoom, Backspace/Escape to zoom out.
 * New vs the mockup: a frame search box that highlights matching frames and shows their share.
 * Input is the analyzer Flame body ({kind, window, n, flags, root:{name, category, self, total, children}}).
 */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const FL_CAT = { app: 'Your code', jdk: 'Java / JDK', jvm: 'JVM native', sys: 'Kernel / other' };
export const FL_COL = { app: ['#F9B2D7', '#C77FA6'], jdk: ['#C9CAFF', '#7476C8'], jvm: ['#FFE7A3', '#B9A45A'], sys: ['#E4E5EE', '#5C5E80'], root: ['#ECEDF8', '#3E4070'], hit: ['#7C7EF5', '#9FA1FF'] };
/** Catalogue frame_kinds units. */
export const FRAME_UNIT = { cpu: 'CPU samples', alloc: 'bytes allocated', lock: 'ms of estimated lock wait', wall: 'wall-clock samples', socket: 'samples (slow socket ops)' };
/** Group → flame kind (contract 1.5). */
export const GROUP_KIND = { cpu: 'cpu', alloc: 'alloc', locks: 'lock', threads: 'wall', socket: 'socket', endpoint: 'wall' };
/** Incident group → which flame group answers "where in code" for it. */
export const INCIDENT_FLAME = {
  cpu: 'cpu', heap: 'alloc', gc: 'alloc', alloc: 'alloc', metaspace: 'alloc', codecache: 'cpu', nmt: 'alloc', container: 'alloc',
  threads: 'threads', locks: 'locks', vt: 'threads', safepoint: 'threads', jit: 'cpu', classes: 'cpu', socket: 'socket', file: 'threads',
  exceptions: 'cpu', endpoint: 'endpoint',
};

const CAT = { app: 'app', jdk: 'jdk', jvm: 'jvm', native: 'sys' };

/** API Flame → mockup node [display, total, children|0, cat, raw]. */
export function toTree(fl) {
  if (!fl || !fl.root) return null;
  const conv = (n, depth) => {
    const kids = depth < 64 ? (n.children || []).filter((c) => c && c.total > 0).sort((a, b) => b.total - a.total).map((c) => conv(c, depth + 1)) : [];
    return [n.name, n.total || 0, kids.length ? kids : 0, n.name === 'all' && depth === 0 ? 'root' : (CAT[n.category] || 'jdk'), n.name];
  };
  const tree = conv(fl.root, 0);
  tree[0] = 'all';
  tree[3] = 'root';
  return { tree, total: fl.root.total || 0, kind: fl.kind, n: fl.n, flags: fl.flags || [], window: fl.window };
}

export function flCat(n) { return n[0] === 'all' && n[3] === 'root' ? 'root' : n[3]; }
export function flName(n) {
  const raw = String(n[4] || n[0]);
  if (n[3] === 'sys') { const m = /^(.*?\.so(?:\.\d+)*)\.(.+)$/.exec(raw); if (m) return m[2]; }
  if (raw.includes('::')) return raw;
  const parts = raw.split('.');
  if (parts.length > 2 && n[3] !== 'sys') return parts.slice(-2).join('.');
  return raw;
}
export function flCats(fl) { const s = new Set(); (function w(n) { const c = flCat(n); if (c !== 'root') s.add(c); (n[2] || []).forEach(w); })(fl.tree); return ['app', 'jdk', 'jvm', 'sys'].filter((c) => s.has(c)); }
export function flLegendHTML(cats) { return cats.map((c) => `<span class="lg"><i class="k-${c}"></i>${FL_CAT[c]}</span>`).join(''); }
const FL_GRP = [['GC', /PSScavenge|PSParallelCompact|ParallelScavenge|PSPromotion|GCTaskThread|ParallelCompact|ZDriver|ZGeneration|ZMark|ZRelocat|ZWorker|ZDirector|G1|WorkerThread|CollectedHeap|Scavenge/],
  ['JIT compiler', /CompileBroker|C2Compiler|Compile::|Compilation::|PhaseChaitin|CompilerThread|C1_/], ['VM operations', /VMThread|VM_Operation|SafepointSynchronize/], ['profiler', /Profiler::|asyncProfiler/]];
export function flTakeaway(fl) {
  const tot = fl.total || 1; const cat = { app: 0, jdk: 0, jvm: 0, sys: 0 }; const grp = {};
  (function w(n, ctx) {
    const c = flCat(n); const raw = n[4] || n[0]; let g = ctx;
    if (!g && c !== 'root') for (const [k, re] of FL_GRP) if (re.test(raw)) { g = k; break; }
    const kids = n[2] || []; const self = n[1] - kids.reduce((a, k) => a + k[1], 0);
    if (self > 0 && c !== 'root') { cat[c] += self; const key = g && c !== 'app' ? g : c === 'app' || c === 'jdk' ? flName(n) : FL_CAT[c]; grp[c] = grp[c] || {}; grp[c][key] = (grp[c][key] || 0) + self; }
    kids.forEach((k) => w(k, g));
  })(fl.tree, null);
  const pct = (v) => Math.round(100 * v / tot); const order = Object.keys(cat).sort((a, b) => cat[b] - cat[a]); const top = order[0];
  const lead = { app: 'Mostly your code', jdk: 'Mostly Java / JDK code', jvm: 'Mostly JVM internals', sys: 'Mostly kernel / system libraries' }[top];
  const g = Object.entries(grp[top] || {}).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${esc(k)} ${pct(v)}%`).join(', ');
  const rest = order.slice(1).filter((c) => pct(cat[c]) >= 1).map((c) => `${({ app: 'your code', jdk: 'Java / JDK', jvm: 'JVM native', sys: 'kernel / other' })[c]} ${pct(cat[c])}%`).join(', ');
  return { html: `<b>${lead} (${pct(cat[top])}%)</b>${g ? `: ${g}` : ''}${rest ? `; ${rest}` : ''}.`, cat, top, pct, text: `${lead} (${pct(cat[top])}%)${g ? `: ${g.replace(/&amp;/g, '&')}` : ''}${rest ? `; ${rest}` : ''}.` };
}
function flFind(tree, path) { let n = tree; for (const p of path || []) { const c = (n[2] || []).find((k) => k[0] === p); if (!c) return null; n = c; } return n; }
/** Share of the root whose frame (or any ancestor frame) matches q; counted once per path. */
function matchShare(tree, q) {
  let hit = 0;
  (function w(n, inHit) { const m = !inHit && String(n[4] || n[0]).toLowerCase().includes(q); if (m) { hit += n[1]; return; } (n[2] || []).forEach((c) => w(c, inHit)); })(tree, false);
  return hit;
}
const FLH = 20;

/**
 * renderFlame(host, fl, o): fl = toTree(api) result.
 * o = {unit, legend, st:{zoom, flip, q}, empty, onSelect(q, event, fl)}
 */
export function renderFlame(host, fl, o) {
  const st = o.st || (o.st = {});
  if (!fl || !fl.total) {
    host.innerHTML = `<div class="fl-empty"><svg viewBox="0 0 64 40" width="64" height="40" aria-hidden="true"><rect x="6" y="25" width="52" height="7" rx="3.5" fill="#9FA1FF" opacity=".35"/><rect x="6" y="15" width="30" height="7" rx="3.5" fill="#F9B2D7" opacity=".45"/><rect x="38" y="15" width="14" height="7" rx="3.5" fill="#FFF0BE"/></svg><div><b>No samples for a flame graph</b><br><span>${esc(o.empty || 'No stacks recorded for this event.')}</span></div></div>`;
    return;
  }
  const path = st.zoom || []; const z = flFind(fl.tree, path) || fl.tree; const crumbs = ['all', ...path.map((p) => flName([p, 0, 0, '', p]) || p)];
  if (!host.querySelector('canvas')) {
    const tk = flTakeaway(fl);
    host.innerHTML = `${o.legend !== false ? `<div class="fl-legend">${flLegendHTML(flCats(fl))}</div>` : ''}${o.take !== false ? `<p class="fl-take">${tk.html}</p>` : ''}
    <div class="fl-bar"><nav class="fl-crumbs" aria-label="Zoom path"></nav>
      <label class="fl-search search" title="Highlight frames whose name contains this text"><svg class="icon" aria-hidden="true"><use href="#i-search"/></svg><input type="search" data-flq placeholder="Search frames" autocomplete="off" aria-label="Search frames" value="${esc(st.q || '')}"></label><span class="fl-match" aria-live="polite"></span>
      <span class="fl-hint">Hover for details · click a frame to zoom</span>
      <button type="button" class="fl-flip" data-flflip aria-pressed="false" title="Flip: root at the top (icicle)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/></svg><span></span></button>
      <button type="button" class="btn sm" data-flreset>Reset zoom</button></div><div class="fl-wrap"><canvas class="fl-c" tabindex="0" role="img"></canvas></div>`;
    host.onclick = (e) => {
      if (e.target.closest('[data-flreset]')) { st.zoom = null; renderFlame(host, fl, o); host.querySelector('canvas').focus(); return; }
      if (e.target.closest('[data-flflip]')) { st.flip = !st.flip; st._scrolled = false; renderFlame(host, fl, o); const w = host.querySelector('.fl-wrap'); w.scrollTop = st.flip ? 0 : w.scrollHeight; return; }
      const c = e.target.closest('[data-flcrumb]'); if (c) { st.zoom = c.dataset.flcrumb === '' ? null : c.dataset.flcrumb.split('\u0001'); renderFlame(host, fl, o); }
    };
    host.querySelector('[data-flq]').addEventListener('input', (e) => { st.q = e.target.value; renderFlame(host, fl, o); });
    host.querySelector('canvas').addEventListener('keydown', (e) => {
      if ((e.key === 'Backspace' || e.key === 'Escape') && (st.zoom || []).length) { e.preventDefault(); e.stopPropagation(); st.zoom = st.zoom.slice(0, -1); if (!st.zoom.length) st.zoom = null; renderFlame(host, fl, o); }
    });
  }
  host.querySelector('.fl-crumbs').innerHTML = crumbs.map((c, i) => (i === crumbs.length - 1 ? `<span aria-current="true">${esc(c)}</span>` : `<button type="button" data-flcrumb="${esc(path.slice(0, i).join('\u0001'))}">${esc(c)}</button>`)).join('<i>›</i>');
  host.querySelector('[data-flreset]').disabled = !path.length;
  const fb = host.querySelector('[data-flflip]'); fb.setAttribute('aria-pressed', !!st.flip); fb.querySelector('span').textContent = st.flip ? 'Icicle' : 'Flame'; fb.title = st.flip ? 'Flip: root at the bottom (flame graph)' : 'Flip: root at the top (icicle)';
  const q = (st.q || '').trim().toLowerCase();
  const mEl = host.querySelector('.fl-match');
  if (mEl) mEl.textContent = q ? `${Math.round(1000 * matchShare(fl.tree, q) / fl.total) / 10}% matched` : '';
  const cv = host.querySelector('canvas'); const wrap = host.querySelector('.fl-wrap'); const W = Math.max(200, wrap.clientWidth - 8); const dpr = globalThis.devicePixelRatio || 1;
  let depth = 0; (function dd(n, k) { depth = Math.max(depth, k); (n[2] || []).forEach((c) => dd(c, k + 1)); })(z, 0);
  const rows = path.length + depth + 1; const H = rows * FLH + 2; cv.width = W * dpr; cv.height = H * dpr; cv.style.width = `${W}px`; cv.style.height = `${H}px`;
  cv.setAttribute('aria-label', `Flame graph of ${fl.total} ${o.unit || 'samples'}`);
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const dark = document.documentElement.dataset.theme === 'dark'; const ink = dark ? '#F2F2FF' : '#2A2B45'; const ci = dark ? 1 : 0;
  g.font = '11px "JetBrains Mono",ui-monospace,monospace'; g.textBaseline = 'middle'; const rects = [];
  const Y = (k) => (st.flip ? k * FLH : H - 2 - (k + 1) * FLH);
  const box = (x, k, w, n, p, dim) => {
    const y = Y(k); const cat = flCat(n); const hit = q && String(n[4] || n[0]).toLowerCase().includes(q);
    g.globalAlpha = dim || (q && !hit) ? 0.45 : 1; g.fillStyle = (hit ? FL_COL.hit : FL_COL[cat] || FL_COL.jdk)[ci];
    g.beginPath(); const r = Math.min(4, w / 2); if (g.roundRect) g.roundRect(x + 0.5, y + 1, Math.max(w - 1, 0.5), FLH - 2, r); else g.rect(x + 0.5, y + 1, Math.max(w - 1, 0.5), FLH - 2); g.fill();
    if (w > 34) { g.fillStyle = hit ? '#fff' : ink; let t = flName(n); const mx = w - 10; if (g.measureText(t).width > mx) { while (t.length > 1 && g.measureText(`${t}…`).width > mx) t = t.slice(0, -1); t += '…'; } g.fillText(t, x + 5, y + FLH / 2 + 0.5); }
    g.globalAlpha = 1; rects.push({ x, y, w, n, p, cat });
  };
  let a = fl.tree; box(0, 0, W, a, [], path.length > 0);
  for (let i = 0; i < path.length; i++) { a = (a[2] || []).find((k) => k[0] === path[i]); box(0, i + 1, W, a, path.slice(0, i + 1), true); }
  (function lay(n, x, w, k, p) { (n[2] || []).reduce((xx, c) => { const cw = w * c[1] / n[1]; if (cw >= 0.6) { const cp = [...p, c[0]]; box(xx, k, cw, c, cp, false); lay(c, xx, cw, k + 1, cp); } return xx + cw; }, x); })(z, 0, W, path.length + 1, path);
  if (!st.flip && !st._scrolled) { wrap.scrollTop = wrap.scrollHeight; st._scrolled = true; }
  let tip = document.getElementById('flTip'); if (!tip) { document.body.insertAdjacentHTML('beforeend', '<div class="fl-tip" id="flTip" hidden></div>'); tip = document.getElementById('flTip'); }
  const hitAt = (e) => { const r = cv.getBoundingClientRect(); const mx = e.clientX - r.left; const my = e.clientY - r.top; for (let i = rects.length - 1; i >= 0; i--) { const qq = rects[i]; if (mx >= qq.x && mx < qq.x + qq.w && my >= qq.y && my < qq.y + FLH) return qq; } return null; };
  cv.onmousemove = (e) => {
    const qq = hitAt(e); if (!qq) { tip.hidden = true; cv.style.cursor = 'default'; return; }
    cv.style.cursor = 'pointer'; const raw = qq.n[4] || qq.n[0]; const nm = flName(qq.n); const pct = 100 * qq.n[1] / fl.total;
    const self = qq.n[1] - (qq.n[2] || []).reduce((s, c) => s + c[1], 0);
    tip.innerHTML = `<b>${esc(raw)}</b><span class="lg"><i class="k-${qq.cat === 'root' ? 'jdk' : qq.cat}" style="width:10px;height:10px;border-radius:3px;display:inline-block"></i>${esc(FL_CAT[qq.cat] || 'all frames')}</span><br>${(Math.round(pct * 10) / 10).toLocaleString('en-US')}% · ${qq.n[1].toLocaleString('en-US')} ${esc(o.unit || 'samples')}${self > 0 ? ` · self ${self.toLocaleString('en-US')}` : ''}${nm !== raw ? '' : ''}`;
    tip.hidden = false; const tw = tip.offsetWidth; const th = tip.offsetHeight;
    tip.style.left = `${Math.min(innerWidth - tw - 8, e.clientX + 14)}px`; tip.style.top = `${e.clientY + 16 + th > innerHeight ? e.clientY - th - 10 : e.clientY + 16}px`;
  };
  cv.onmouseleave = () => { tip.hidden = true; };
  cv.onclick = (e) => {
    const qq = hitAt(e); if (!qq) return; tip.hidden = true;
    if (qq.p.length && (qq.n[2] || []).length) { st.zoom = qq.p; renderFlame(host, fl, o); }
    if (qq.p.length && o.onSelect) o.onSelect(qq, e, fl);
  };
}
