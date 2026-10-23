/**
 * KUSMA harness, run in the browser for now (no imports from the DOM, so it can move to a server unchanged).
 *
 *   1. Laya   POST <laya>/route {message, selection, previous, last_answer} → {route, confidence, probabilities, ms}
 *             route ≠ jafra_z → the canned reply for that route, no model call.
 *   2. Tools  GET <analyzer>/v2/tools → 8 tool schemas (contract 1.5) → OpenAI "tools".
 *   3. Jafra Z POST <jafraz>/v1/chat/completions {messages, tools, stream:true} (llama-server --jinja).
 *             tool_calls → GET <analyzer>/v2/jvms/{ns}/{pod}/{container}/tools/{tool}?<args>&start=&cluster=
 *             → role:"tool" messages → next round (max 5 rounds; the last round runs with tool_choice:"none").
 *   4. Events to the UI, same names as the old stand-in stream: route, thought, tool_call {phase:start|end}, answer_delta, done, error.
 */

export const ROUTES = ['jafra_z', 'needs_clarification', 'out_of_scope', 'unsafe'];
export const ROUTE_REPLY = {
  needs_clarification: 'I need a bit more to go on. Which part of this JVM do you mean: a chart, an incident, or a time range? You can select one on the dashboard and ask again.',
  out_of_scope: 'I can only answer questions about this JVM: its CPU, memory, GC, threads, locks, I/O, endpoints and incidents.',
  unsafe: "I can't help with that.",
};
export const MAX_ROUNDS = 5;

/**
 * Single system prompt for every KUSMA turn and every Jafra Z training row.
 * Byte-for-byte match of jafraz/system-prompt.txt with the trailing newline stripped.
 * Dataset rows must copy SYSTEM_PROMPT exactly (see jafraz/dataset-format.txt).
 */
export const SYSTEM_PROMPT = "You are KUSMA (Knowledge-driven Unified Systems Monitoring Assistant), the diagnostic assistant inside Jafra. You run on the Jafra Z model. You help people understand one Java workload running in Kubernetes or OpenShift: its CPU, memory, garbage collection, threads, locks, I/O, endpoints and incidents.\n\nEach user message starts with a <context> block. It tells you the JVM (namespace, pod, container, start time, JDK), the time range, the chart or incident the user selected, open incidents, and the persona. Use these values exactly when you call tools. Send times as full RFC 3339 values, or use \"last\" only with a value the tool accepts.\n\nHow to work:\n- Think first. Decide what the user is asking, which tool answers it, and which arguments to send.\n- Call tools to get facts. Use only numbers, names and times that come from tool results or the <context> block. Never guess a value.\n- After each result, check if it answers the question. If not, call another tool. If a tool returns an error, read its hint and fix the arguments.\n- If the data cannot answer the question, say so and say what data is missing.\n\nHow to answer:\n- Write the final answer in ASD-STE100 Simplified Technical English: short sentences, active voice, one meaning for each word, one instruction in each sentence.\n- Start with the direct answer. Then give the evidence with numbers, units and times. Then give the recommended action, if there is one.\n- If the persona is \"developer\", use plain words and point to the code: class, method, endpoint or thread.\n- If the persona is \"expert\", use precise JVM terms, for example GC phases, safepoints, TLABs, cgroup quota.\n- Do not show raw JSON in the final answer.";

/** Compact JSON: separators (",", ":") — JSON.stringify already emits no spaces. */
export function compactJson(value) {
  return JSON.stringify(value);
}

/** User turn = <context>\n + compact JSON + \n</context>\n\n + question (dataset-format.txt). */
export function userTurn(context, message) {
  return `<context>\n${compactJson(context)}\n</context>\n\n${message}`;
}

/** Laya's "selection" field: a short line built from the context block's selection (or "none"). */
export function selectionText(ctx) {
  const s = ctx?.selection;
  if (!s) return ctx?.chart ? `chart ${ctx.chart.id}` : 'none';
  const parts = [s.kind];
  if (ctx.chart?.id) parts.push(`on ${ctx.chart.id}`);
  for (const k of ['metric', 'by', 'key', 'value', 'name', 'id', 'from', 'to']) if (s[k] != null && s[k] !== '') parts.push(`${k}=${typeof s[k] === 'object' ? JSON.stringify(s[k]) : s[k]}`);
  return parts.join(' ');
}

/** /v2/tools body → OpenAI tools. Accepts {tools:[{name,description,parameters}]} or an already-OpenAI list. */
export function toOpenAiTools(body) {
  const list = Array.isArray(body) ? body : body?.tools || [];
  return list.map((t) => (t.type === 'function' && t.function ? t : { type: 'function', function: { name: t.name, description: t.description || '', parameters: t.parameters || { type: 'object', properties: {} } } }));
}

const NO_RANGE = new Set(['get_incident', 'get_jvm_info']);
const DUR = /^(\d+)(s|m|h|d)$/; const DUR_MS = { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }; const MAX_LAST_MS = 7 * 864e5;
/** Any time value (epoch ms number/string or a parseable date) → full RFC 3339 UTC with ms, e.g. 2026-10-23T04:12:00.000Z; else null. */
export function rfc3339(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : /^\d{10,}$/.test(String(v).trim()) ? +String(v).trim() : Date.parse(String(v));
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
}
/** A `last` value the analyzer accepts (90s, 5m, 15m, 1h, 1d …, max 7d), or null. Display labels like "15 min" or "Last hour" are rejected. */
export function apiLast(v) { const m = DUR.exec(String(v ?? '').trim()); return m && +m[1] > 0 && +m[1] * DUR_MS[m[2]] <= MAX_LAST_MS ? `${+m[1]}${m[2]}` : null; }
/** The range a tool should default to: the selection's own from/to (brush, whole chart, incident t0–t1), else the context range. Always RFC 3339. */
export function defaultRange(ctx) {
  const s = ctx?.selection || {};
  const sf = rfc3339(s.from ?? s.t0); const st = rfc3339(s.to ?? s.t1);
  if (sf && st) return { from: sf, to: st };
  const f = rfc3339(ctx?.range?.from); const t = rfc3339(ctx?.range?.to);
  return f && t ? { from: f, to: t } : null;
}
/**
 * Tool args → query string values, always in the exact form the analyzer API takes (never a display abbreviation):
 * from/to → full RFC 3339; last → a valid API duration (not combined with from/to); no range → the selection/context range.
 */
export function toolQuery(name, args, ctx) {
  const q = {};
  for (const [k, v] of Object.entries(args || {})) {
    if (v == null || v === '') continue;
    q[k] = typeof v === 'object' ? JSON.stringify(v) : String(v);
  }
  if (NO_RANGE.has(name)) { delete q.from; delete q.to; delete q.last; return q; }
  // A model that put a duration into from ("15m") meant last=15m.
  if (q.from && !q.to && !q.last && apiLast(q.from)) { q.last = apiLast(q.from); delete q.from; }
  if (q.from != null) { const f = rfc3339(q.from); if (f) q.from = f; else delete q.from; }
  if (q.to != null) { const t = rfc3339(q.to); if (t) q.to = t; else delete q.to; }
  if (q.last != null) { const l = apiLast(q.last); if (l && !q.from && !q.to) q.last = l; else delete q.last; }
  if (q.from && !q.to) q.to = new Date().toISOString();
  if (q.to && !q.from) delete q.to;
  if (!q.from && !q.last) { const r = defaultRange(ctx); if (r) { q.from = r.from; q.to = r.to; } }
  return q;
}

/** The context a tool ran under, in full: jvm (ns/pod/container/start/jdk/cluster), RFC 3339 range, chart id/view, selection. */
export function auditContext(ctx, jvm) {
  return {
    jvm: { ...(ctx?.jvm || {}), ...(jvm?.cluster ? { cluster: jvm.cluster } : {}) },
    range: ctx?.range || null, effective_range: defaultRange(ctx),
    chart: ctx?.chart ? { id: ctx.chart.id, title: ctx.chart.title, view: ctx.chart.view } : null,
    selection: ctx?.selection || null,
    persona: ctx?.persona === 'expert' ? 'expert' : 'developer',
  };
}

export function toolUrl(analyzer, jvm, name, query) {
  const p = `/v2/jvms/${encodeURIComponent(jvm.ns)}/${encodeURIComponent(jvm.pod)}/${encodeURIComponent(jvm.container)}/tools/${encodeURIComponent(name)}`;
  const u = new URLSearchParams();
  if (jvm.cluster) u.set('cluster', jvm.cluster);
  if (jvm.start) u.set('start', String(jvm.start));
  for (const [k, v] of Object.entries(query)) u.set(k, v);
  return `${analyzer}${p}?${u}`;
}

async function readJson(res, what) {
  const text = await res.text();
  try { return text ? JSON.parse(text) : {}; } catch { throw new Error(`${what}: HTTP ${res.status}, not JSON (${text.slice(0, 80).replace(/\s+/g, ' ')})`); }
}

/** Parse an OpenAI streaming body; calls onChunk(json) per data line. */
async function readSse(res, onChunk, signal) {
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    if (signal?.aborted) { reader.cancel().catch(() => {}); throw new DOMException('aborted', 'AbortError'); }
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try { onChunk(JSON.parse(data)); } catch { /* keep-alive or partial */ }
    }
  }
}

/**
 * Run one KUSMA turn.
 * @param o {urls:{analyzer,laya,jafraz}, jvm, message, context, persona, previous, lastAnswer, signal, onEvent(name,payload), fetch?, model?}
 * @returns {route, answer, messages}
 */
export async function runKusma(o) {
  const f = o.fetch || fetch;
  const emit = (n, p) => o.onEvent && o.onEvent(n, p);
  const persona = o.persona === 'expert' ? 'expert' : 'developer';

  // 1. Laya
  const lr = await f(`${o.urls.laya}/route`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: o.signal,
    body: JSON.stringify({ message: o.message, selection: selectionText(o.context), previous: o.previous || 'none', last_answer: o.lastAnswer || 'none' }) });
  const route = await readJson(lr, 'Laya /route');
  if (!lr.ok) throw new Error(`Laya /route: HTTP ${lr.status}${route.message ? ` ${route.message}` : ''}`);
  emit('route', route);
  if (route.route !== 'jafra_z') {
    const text = ROUTE_REPLY[route.route] || ROUTE_REPLY.out_of_scope;
    emit('answer_delta', { text }); emit('done', { route: route.route });
    return { route: route.route, answer: text, messages: [] };
  }

  // 2. Tool schemas from the analyzer
  const tr = await f(`${o.urls.analyzer}/v2/tools`, { signal: o.signal });
  const tools = toOpenAiTools(await readJson(tr, 'Analyzer /v2/tools'));
  if (!tr.ok || !tools.length) throw new Error(`Analyzer /v2/tools: HTTP ${tr.status}, ${tools.length} tools`);

  // 3. Jafra Z with the tool loop
  const ctx = { ...o.context, persona };
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userTurn(ctx, o.message) }];
  o.context = ctx;
  let answer = '';
  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    const last = round === MAX_ROUNDS;
    const res = await f(`${o.urls.jafraz}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: o.signal,
      body: JSON.stringify({ model: o.model || 'jafra-z', messages, tools, tool_choice: last ? 'none' : 'auto', stream: true }) });
    if (!res.ok) { const b = await readJson(res, 'Jafra Z').catch((e) => ({ message: e.message })); throw new Error(`Jafra Z /v1/chat/completions: HTTP ${res.status} ${b.error?.message || b.message || ''}`.trim()); }
    let content = ''; let reasoning = ''; const calls = []; let finish = null;
    // Reasoning stays ON: llama-server sends it as delta.reasoning_content (--reasoning-format deepseek/auto) or inline
    // as <think>…</think> in delta.content (--reasoning-format none). Both stream into the think step, never into the answer.
    const tk = { inThink: false, buf: '' };
    const think = (t) => { if (!t) return; reasoning += t; emit('thought_delta', { text: t }); };
    const say = (t) => { if (!t) return; content += t; emit('answer_delta', { text: t }); };
    const feed = (txt) => {
      tk.buf += txt;
      for (;;) {
        if (tk.inThink) {
          const i = tk.buf.indexOf('</think>');
          if (i < 0) { const keep = Math.max(0, tk.buf.length - 8); think(tk.buf.slice(0, keep)); tk.buf = tk.buf.slice(keep); return; }
          think(tk.buf.slice(0, i)); tk.buf = tk.buf.slice(i + 8); tk.inThink = false;
        } else {
          const i = tk.buf.indexOf('<think>');
          if (i < 0) { const keep = Math.max(0, tk.buf.length - 7); say(tk.buf.slice(0, keep)); tk.buf = tk.buf.slice(keep); return; }
          say(tk.buf.slice(0, i)); tk.buf = tk.buf.slice(i + 7); tk.inThink = true;
        }
      }
    };
    await readSse(res, (j) => {
      const ch = j.choices?.[0]; if (!ch) return;
      const d = ch.delta || ch.message || {};
      if (d.reasoning_content) think(d.reasoning_content);
      if (d.content) feed(d.content);
      for (const tc of d.tool_calls || []) {
        const k = tc.index ?? calls.length;
        const c = calls[k] || (calls[k] = { id: tc.id || `call_${round}_${k}`, type: 'function', function: { name: '', arguments: '' } });
        if (tc.id) c.id = tc.id;
        if (tc.function?.name) c.function.name += tc.function.name;
        if (tc.function?.arguments) c.function.arguments += tc.function.arguments;
      }
      if (ch.finish_reason) finish = ch.finish_reason;
    }, o.signal);
    if (tk.buf) { (tk.inThink ? think : say)(tk.buf); tk.buf = ''; }
    if (reasoning) emit('thought', { text: reasoning.trim() });
    const real = calls.filter(Boolean).filter((c) => c.function.name);
    if (!real.length || last) { answer = content; break; }
    messages.push({ role: 'assistant', content: content || null, tool_calls: real });
    for (const c of real) {
      let args = {};
      try { args = c.function.arguments ? JSON.parse(c.function.arguments) : {}; } catch { args = {}; }
      // Transparency: every tool event carries what the model asked for (args), what was actually sent (query + url),
      // and the full context it ran under (jvm, range, chart/selection ids). The UI keeps it folded inside the tool step.
      const query = toolQuery(c.function.name, args, o.context); const url = toolUrl(o.urls.analyzer, o.jvm, c.function.name, query);
      const sent = { tool: c.function.name, args, query, url, context: auditContext(o.context, o.jvm) };
      emit('tool_call', { id: c.id, name: c.function.name, args, query, url, sent, phase: 'start' });
      const t0 = Date.now(); let result;
      try {
        const r = await f(url, { signal: o.signal });
        result = await readJson(r, `tool ${c.function.name}`);
      } catch (e) { if (e.name === 'AbortError') throw e; result = { error: 'tool_failed', message: e.message }; }
      emit('tool_call', { id: c.id, name: c.function.name, args, query, url, sent, phase: 'end', result, ms: Date.now() - t0 });
      messages.push({ role: 'tool', tool_call_id: c.id, name: c.function.name, content: JSON.stringify(result) });
    }
    if (finish && finish !== 'tool_calls' && !real.length) break;
  }
  emit('done', { route: 'jafra_z' });
  return { route: 'jafra_z', answer, messages };
}
