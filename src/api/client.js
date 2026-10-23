/**
 * Analyzer v2 client (contract shapes). The base URL comes from Settings (src/services/config.js); '' = not configured.
 * Every response body is parsed defensively: a non-JSON body (e.g. an HTML 404 page) becomes ApiError bad_json.
 */
import { baseFor } from '../services/config.js';

export function apiBase() { return baseFor('analyzer'); }

export class ApiError extends Error {
  constructor(body, status) {
    super(body.message || body.error || 'request failed');
    this.error = body.error;
    this.hint = body.hint;
    this.valid = body.valid || [];
    this.status = status;
  }
}

export function jvmPath(jvm, rest) {
  const p = `/v2/jvms/${encodeURIComponent(jvm.ns)}/${encodeURIComponent(jvm.pod)}/${encodeURIComponent(jvm.container)}${rest}`;
  const q = new URLSearchParams();
  if (jvm.cluster) q.set('cluster', jvm.cluster);
  if (jvm.start) q.set('start', String(jvm.start));
  const s = q.toString();
  return s ? `${p}?${s}` : p;
}

export function withQuery(path, extra) {
  const u = new URL(path, 'http://local');
  for (const [k, v] of Object.entries(extra || {})) {
    if (v != null && v !== '') u.searchParams.set(k, String(v));
  }
  return u.pathname + u.search;
}

export function createClient(base = apiBase()) {
  async function get(path, init) {
    if (!base) throw new ApiError({ error: 'not_configured', message: 'Analyzer not configured', hint: 'Set the Analyzer URL in Settings.' }, 0);
    const res = await fetch(base + path, init);
    const text = await res.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { error: 'bad_json', message: `${res.status}: the analyzer did not return JSON`, hint: 'Check the Analyzer URL in Settings (it must be the v2 API base).', valid: [] }; }
    if (!res.ok || body?.error === 'bad_json') throw new ApiError(body, res.status);
    return body;
  }
  const jget = (jvm, rest, q, init) => get(withQuery(jvmPath(jvm, rest), q), init);
  return {
    base,
    get,
    workloads: () => get('/v2/workloads'),
    metrics: (q) => get(withQuery('/v2/metrics', q)),
    tools: () => get('/v2/tools'),
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
    /** J/tools/{tool}?<args> (contract 1.5 harness extras): runs one tool, returns its result or its error body. */
    tool: (jvm, name, args, init) => jget(jvm, `/tools/${encodeURIComponent(name)}`, args, init),
    jvmInfo: (jvm) => jget(jvm, '/tools/get_jvm_info'),
  };
}
