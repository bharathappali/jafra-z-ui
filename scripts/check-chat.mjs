/**
 * Runs src/kusma/harness.js (Laya → Jafra Z → J/tools) end to end against real or fake services.
 * VITE_ANALYZER_URL, VITE_LAYA_URL, VITE_JAFRAZ_URL must point at running services.
 */
import { buildContext } from '../src/chat/context.js';
import { runKusma, toolQuery } from '../src/kusma/harness.js';

const trim = (u) => String(u || '').replace(/\/+$/, '');
const urls = { analyzer: trim(process.env.VITE_ANALYZER_URL), laya: trim(process.env.VITE_LAYA_URL), jafraz: trim(process.env.VITE_JAFRAZ_URL) };
for (const [k, v] of Object.entries(urls)) if (!v) throw new Error(`set ${k} URL (VITE_${k === 'jafraz' ? 'JAFRAZ' : k.toUpperCase()}_URL)`);

const workloads = await fetch(`${urls.analyzer}/v2/workloads`).then((r) => r.json());
const w = workloads.find((x) => x.pod === 'orders-worker-0') || workloads[0];
const live = w.jvms[0];
const jvm = { ns: w.ns, pod: w.pod, container: w.container, cluster: w.cluster, start: Date.parse(live.start), jdk: live.jdk };
const to = Date.now(); const range = { from: new Date(to - 15 * 60_000).toISOString(), to: new Date(to).toISOString() };
const list = await fetch(`${urls.analyzer}/v2/jvms/${encodeURIComponent(w.ns)}/${encodeURIComponent(w.pod)}/${encodeURIComponent(w.container)}/incidents?cluster=${encodeURIComponent(w.cluster)}&start=${jvm.start}&last=15m`).then((r) => r.json());
const iid = list.incidents?.[0]?.id;
const ctxJvm = { ns: w.ns, pod: w.pod, container: w.container, start: live.start, jdk: live.jdk };

async function turn(context, message) {
  const ev = []; const calls = []; let thought = '';
  const r = await runKusma({ urls, jvm, message, context, persona: 'developer', onEvent: (n, p) => {
    if (n === 'thought_delta') thought += p.text; if (n === 'tool_call' && p.phase === 'start') calls.push(p);
    if (ev.at(-1) !== n || p?.phase) ev.push(p?.phase ? `${n}:${p.phase}` : n);
  } });
  return { ...r, ev, calls, thought };
}

// Exact API arguments, never a display label (Stark lock).
const RFC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const q1 = toolQuery('get_overview', { last: '15 min' }, { range, selection: null });
if (!RFC.test(q1.from) || !RFC.test(q1.to) || q1.last) throw new Error(`display label leaked: ${JSON.stringify(q1)}`);
const q2 = toolQuery('query_metric', { metric: 'cpu.process.pct', from: '15m' }, { range });
if (q2.last !== '15m' || q2.from) throw new Error(`last not mapped: ${JSON.stringify(q2)}`);
const sel = { kind: 'range', from: new Date(to - 300_000).toISOString(), to: new Date(to - 120_000).toISOString() };
const q3 = toolQuery('get_overview', {}, { range, selection: sel });
if (q3.from !== sel.from || q3.to !== sel.to) throw new Error(`selection range not used: ${JSON.stringify(q3)}`);

const a = await turn(buildContext({ jvm: ctxJvm, range, chart: null, selection: null, summary: null, openIncidents: [] }), 'Is this JVM healthy right now?');
if (a.route !== 'jafra_z' || !a.answer || !a.ev.includes('tool_call:end') || a.ev.indexOf('answer_delta') < a.ev.indexOf('tool_call:end')) throw new Error(`starter turn: ${a.route} ${a.ev.join(',')}`);
// Reasoning ON: thinking streams before the tool calls and never leaks into the answer; tool events carry the full context.
if (!a.thought || a.ev.indexOf('thought_delta') > a.ev.indexOf('tool_call:start')) throw new Error(`no streamed thinking before tools: ${a.ev.join(',')}`);
if (/<\/?think>/.test(a.answer) || (a.thought && a.answer.includes(a.thought.slice(0, 20)))) throw new Error('thinking leaked into the answer');
for (const c of a.calls) { const cx = c.sent?.context; if (!cx?.jvm?.pod || !cx?.jvm?.start || !RFC.test(cx.range?.from || '') || !c.url) throw new Error(`tool call without full context: ${JSON.stringify(c.sent)}`);
  if (!['get_incident', 'get_jvm_info'].includes(c.name) && !(RFC.test(c.query.from || '') || c.query.last)) throw new Error(`tool call without exact range: ${JSON.stringify(c.query)}`); }
if (iid) {
  const b = await turn(buildContext({ jvm: ctxJvm, range, chart: null, selection: { kind: 'incident', id: iid }, summary: null, openIncidents: [] }), 'Explain this incident please');
  if (!b.answer) throw new Error('incident turn: no answer');
}
const c = await turn(buildContext({ jvm: ctxJvm, range, chart: null, selection: null, summary: null, openIncidents: [] }), 'what is the weather today');
if (c.route === 'jafra_z') console.warn('note: Laya routed an off-topic question to jafra_z');
console.log(`check-chat ok route=${a.route} events=${a.ev.join(',')} answer="${a.answer.slice(0, 70)}"`);
