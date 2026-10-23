/**
 * The three service URLs (Settings pane): Analyzer (jafra-analyzer v2), Laya (router), Jafra Z (llama-server, OpenAI API).
 * Values live in localStorage; build-time env (VITE_ANALYZER_URL, VITE_LAYA_URL, VITE_JAFRAZ_URL) only prefills an empty setting.
 * States per service: unset (no URL) · checking · healthy · unhealthy {error, checkedAt}.
 * Health: analyzer GET <url>/v2/workloads → 200 (the contract has no health route; the real analyzer has no /dummy routes),
 *         Laya GET <url>/healthz → 200, Jafra Z GET <url>/health → 200 {status:"ok"}.
 * Dev proxy (same origin, `npm run dev` only): requests go to /__jz/<service>/… and vite.config.js forwards them to the
 * configured URL, so the browser needs no CORS from any of the three services.
 */

export const SERVICES = [
  { id: 'analyzer', label: 'Analyzer', what: 'Workloads, incidents and charts (jafra-analyzer v2 API).', example: 'http://localhost:8080', health: '/v2/workloads' },
  { id: 'laya', label: 'Laya', what: 'Routes each question (CPU router).', example: 'http://localhost:8000', health: '/healthz' },
  { id: 'jafraz', label: 'Jafra Z', what: 'Writes the answer (llama-server, OpenAI-compatible).', example: 'http://localhost:8081', health: '/health' },
];
export const STATE_LABEL = { unset: 'Not configured', checking: 'Checking…', healthy: 'Healthy', unhealthy: 'Unreachable' };
/** Map to the mockup's dot states (shell.css .dot[data-state]). */
export const DOT = { unset: 'unset', checking: 'connecting', healthy: 'connected', unhealthy: 'down' };

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
const ENV_DEFAULT = {
  analyzer: env.VITE_ANALYZER_URL || env.VITE_JAFRA_API || '',
  laya: env.VITE_LAYA_URL || '',
  jafraz: env.VITE_JAFRAZ_URL || '',
};
const KEY = (id) => `jz.url.${id}`;
const trim = (u) => String(u || '').trim().replace(/\/+$/, '');

/** One-off overrides for demos/screenshots: ?analyzer_url= ?laya_url= ?jafraz_url= (and the old ?api=). Not persisted. */
function urlOverride(id) {
  if (typeof location === 'undefined') return null;
  const q = new URLSearchParams(location.search);
  if (q.has(`${id}_url`)) return trim(q.get(`${id}_url`));
  if (id === 'analyzer' && q.get('api')) return trim(q.get('api'));
  return null;
}

export function getUrl(id) {
  const o = urlOverride(id);
  if (o != null) return o;
  try {
    const v = localStorage.getItem(KEY(id));
    if (v != null) return trim(v);
    if (id === 'analyzer' && localStorage.getItem('jz.api')) return trim(localStorage.getItem('jz.api')); // pre-Settings key
  } catch { /* node */ }
  return trim(ENV_DEFAULT[id]);
}
export function envDefault(id) { return trim(ENV_DEFAULT[id]); }
export function setUrl(id, url) {
  try { localStorage.setItem(KEY(id), trim(url)); if (id === 'analyzer') localStorage.removeItem('jz.api'); } catch { /* ignore */ }
}

/** Dev proxy: only offered when served by the Vite dev server (import.meta.env.DEV). */
export const proxyAvailable = () => !!env.DEV;
export function useProxy() {
  if (!proxyAvailable()) return false;
  try { const v = localStorage.getItem('jz.proxy'); if (v != null) return v === '1'; } catch { /* ignore */ }
  return env.VITE_JZ_PROXY === '1';
}
export function setProxy(on) { try { localStorage.setItem('jz.proxy', on ? '1' : '0'); } catch { /* ignore */ } }

/** Base the browser should call for a service ('' when not configured). */
export function baseFor(id) {
  const u = getUrl(id);
  if (!u) return '';
  return useProxy() ? `${typeof location !== 'undefined' ? location.origin : ''}/__jz/${id}` : u;
}

/** Tell the dev proxy where to forward (it keeps the targets in memory). */
export async function pushProxyConfig() {
  if (!useProxy()) return;
  const body = Object.fromEntries(SERVICES.map((s) => [s.id, getUrl(s.id)]));
  try { await fetch('/__jz/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); } catch { /* reported by health */ }
}

/** fetch → JSON, never throws on a non-JSON body (an HTML 404 page becomes {error:'bad_json'}). */
export async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { error: 'bad_json', message: `${res.status} ${res.statusText}: not JSON (${text.slice(0, 80).replace(/\s+/g, ' ')})` }; }
  return { ok: res.ok, status: res.status, body };
}

const status = Object.fromEntries(SERVICES.map((s) => [s.id, { state: getUrl(s.id) ? 'checking' : 'unset', error: null, checkedAt: null }]));
const subs = new Set();
export const getStatus = (id) => status[id];
export const allStatus = () => status;
export function onStatus(fn) { subs.add(fn); return () => subs.delete(fn); }
function emit(id) { subs.forEach((fn) => fn(id, status[id])); }

/** Health check for one service. Optional `url` tests a value not saved yet (Settings "Test"). */
export async function check(id, url) {
  const svc = SERVICES.find((s) => s.id === id);
  const target = url != null ? trim(url) : getUrl(id);
  if (!target) { status[id] = { state: 'unset', error: null, checkedAt: null }; emit(id); return status[id]; }
  if (!/^https?:\/\//i.test(target)) { status[id] = { state: 'unhealthy', error: 'URL must start with http:// or https://', checkedAt: Date.now() }; emit(id); return status[id]; }
  const prev = status[id];
  if (prev.state !== 'healthy' || url != null) { status[id] = { ...prev, state: 'checking' }; emit(id); }
  const base = url != null && trim(url) !== getUrl(id) ? (useProxy() ? null : target) : baseFor(id);
  let st;
  try {
    if (base == null) throw new Error('Save first to test through the dev proxy');
    const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 5000);
    const r = await fetchJson(base + svc.health, { signal: ac.signal, cache: 'no-store' });
    clearTimeout(tm);
    if (!r.ok) throw new Error(`HTTP ${r.status}${r.body?.message ? `: ${r.body.message}` : r.body?.error ? `: ${r.body.error}` : ''}`);
    if (r.body?.error === 'bad_json') throw new Error(r.body.message);
    if (id === 'jafraz' && r.body?.status && r.body.status !== 'ok') throw new Error(`status ${r.body.status}`);
    if (id === 'analyzer' && !Array.isArray(r.body)) throw new Error('GET /v2/workloads did not return a JSON array');
    st = { state: 'healthy', error: null, checkedAt: Date.now() };
  } catch (e) {
    const msg = e.name === 'AbortError' ? 'timed out after 5 s' : /Failed to fetch|NetworkError|Load failed/i.test(e.message) ? `${e.message} (unreachable, or no CORS — try the dev proxy)` : e.message;
    st = { state: 'unhealthy', error: msg, checkedAt: Date.now() };
  }
  status[id] = st; emit(id);
  return st;
}
export const checkAll = () => Promise.all(SERVICES.map((s) => check(s.id)));

let timer = null;
export function startPolling(ms = 15000) { clearInterval(timer); timer = setInterval(checkAll, ms); }

/** Kusma needs all three healthy. Returns [] when ready, else [{id,label,state}]. */
export function kusmaBlockers() {
  return SERVICES.filter((s) => status[s.id].state !== 'healthy').map((s) => ({ id: s.id, label: s.label, state: status[s.id].state, error: status[s.id].error }));
}
