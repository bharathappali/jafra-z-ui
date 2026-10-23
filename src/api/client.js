const DEFAULT_API = 'http://127.0.0.1:8787';

export function apiBase(search = '') {
  const q = new URLSearchParams(search.startsWith('?') || search === '' ? search : `?${search}`);
  if (typeof location !== 'undefined' && !search) {
    const live = new URLSearchParams(location.search);
    if (live.get('api')) return live.get('api').replace(/\/$/, '');
  }
  if (q.get('api')) return q.get('api').replace(/\/$/, '');
  try {
    const saved = localStorage.getItem('jz.api');
    if (saved) return saved.replace(/\/$/, '');
  } catch { /* node */ }
  const env = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_JAFRA_API;
  return (env || DEFAULT_API).replace(/\/$/, '');
}

export function harnessBase(search = '') {
  const q = new URLSearchParams(search.startsWith('?') || search === '' ? search : `?${search}`);
  if (typeof location !== 'undefined' && !search) {
    const live = new URLSearchParams(location.search);
    if (live.get('harness')) return live.get('harness').replace(/\/$/, '');
  }
  if (q.get('harness')) return q.get('harness').replace(/\/$/, '');
  try {
    const saved = localStorage.getItem('jz.harness');
    if (saved) return saved.replace(/\/$/, '');
  } catch { /* node */ }
  const env = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_JAFRA_HARNESS;
  return (env || apiBase(search)).replace(/\/$/, '');
}

export function saveApiBase(url) {
  localStorage.setItem('jz.api', url.replace(/\/$/, ''));
}

export class ApiError extends Error {
  constructor(body, status) {
    super(body.message || body.error || 'request failed');
    this.error = body.error;
    this.hint = body.hint;
    this.valid = body.valid || [];
    this.status = status;
  }
}

function jvmPath(jvm, rest) {
  const p = `/v2/jvms/${encodeURIComponent(jvm.ns)}/${encodeURIComponent(jvm.pod)}/${encodeURIComponent(jvm.container)}${rest}`;
  const q = new URLSearchParams();
  if (jvm.cluster) q.set('cluster', jvm.cluster);
  if (jvm.start) q.set('start', String(jvm.start));
  const s = q.toString();
  return s ? `${p}?${s}` : p;
}

function withQuery(path, extra) {
  const u = new URL(path, 'http://local');
  for (const [k, v] of Object.entries(extra || {})) {
    if (v != null && v !== '') u.searchParams.set(k, String(v));
  }
  return u.pathname + u.search;
}

export function createClient(base = apiBase()) {
  async function get(path) {
    const res = await fetch(base + path);
    const text = await res.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { error: 'bad_json', message: text, hint: '', valid: [] }; }
    if (!res.ok) throw new ApiError(body, res.status);
    return body;
  }
  const jget = (jvm, rest, q) => get(withQuery(jvmPath(jvm, rest), q));
  return {
    base,
    get,
    workloads: () => get('/v2/workloads'),
    metrics: (q) => get(withQuery('/v2/metrics', q)),
    report: (jvm, q) => jget(jvm, '/report', q),
    timeline: (jvm, q) => jget(jvm, '/timeline', q),
    incidents: (jvm, q) => jget(jvm, '/incidents', q),
    incident: (jvm, id, q) => jget(jvm, `/incidents/${encodeURIComponent(id)}`, q),
    charts: (jvm, q) => jget(jvm, '/charts', q),
    chart: (jvm, id, q) => jget(jvm, `/charts/${encodeURIComponent(id)}`, q),
    flame: (jvm, group, q) => jget(jvm, `/flame/${encodeURIComponent(group)}`, q),
    query: (jvm, q) => jget(jvm, '/query', q),
    frames: (jvm, q) => jget(jvm, '/frames', q),
    events: (jvm, q) => jget(jvm, '/events', q),
    trend: (jvm, q) => jget(jvm, '/trend', q),
    tool: (jvm, name, q) => jget(jvm, `/tools/${encodeURIComponent(name)}`, q),
    jvmInfo: (jvm) => jget(jvm, '/tools/get_jvm_info'),
  };
}
