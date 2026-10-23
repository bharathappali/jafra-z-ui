/**
 * Runs src/kusma/harness.js (Laya → Jafra Z → J/tools) end to end against real or fake services.
 * VITE_ANALYZER_URL, VITE_LAYA_URL, VITE_JAFRAZ_URL must point at running services.
 */
import { buildContext } from '../src/chat/context.js';
import { runKusma, toolQuery, SYSTEM_PROMPT, userTurn, compactJson } from '../src/kusma/harness.js';

const trim = (u) => String(u || '').replace(/\/+$/, '');
const urls = { analyzer: trim(process.env.VITE_ANALYZER_URL), laya: trim(process.env.VITE_LAYA_URL), jafraz: trim(process.env.VITE_JAFRAZ_URL) };
for (const [k, v] of Object.entries(urls)) if (!v) throw new Error(`set ${k} URL (VITE_${k === 'jafraz' ? 'JAFRAZ' : k.toUpperCase()}_URL)`);

// SYSTEM_PROMPT is one identical string (KUSMA on Jafra Z); must mention ASD-STE100 and persona.
if (typeof SYSTEM_PROMPT !== 'string' || !SYSTEM_PROMPT.startsWith('You are KUSMA')) throw new Error('SYSTEM_PROMPT must be the KUSMA system prompt string');
if (!SYSTEM_PROMPT.includes('ASD-STE100')) throw new Error('SYSTEM_PROMPT missing ASD-STE100');
if (SYSTEM_PROMPT.endsWith('\n')) throw new Error('SYSTEM_PROMPT must have trailing newline stripped');

const workloads = await fetch(`${urls.analyzer}/v2/workloads`).then((r) => r.json());
const w = workloads.find((x) => x.pod === 'orders-worker-0') || workloads[0];
const live = w.jvms[0];
const jvm = { ns: w.ns, pod: w.pod, container: w.container, cluster: w.cluster, start: Date.parse(live.start), jdk: live.jdk };
const to = Date.now(); const range = { from: new Date(to - 15 * 60_000).toISOString(), to: new Date(to).toISOString() };
const list = await fetch(`${urls.analyzer}/v2/jvms/${encodeURIComponent(w.ns)}/${encodeURIComponent(w.pod)}/${encodeURIComponent(w.container)}/incidents?cluster=${encodeURIComponent(w.cluster)}&start=${jvm.start}&last=15m`).then((r) => r.json());
const iid = list.incidents?.[0]?.id;
const ctxJvm = { ns: w.ns, pod: w.pod, container: w.container, start: live.start, jdk: live.jdk };

// Context block shape + userTurn format (dataset-format.txt).
const sample = buildContext({ jvm: ctxJvm, range, chart: null, selection: null, summary: null, openIncidents: [], persona: 'developer' });
const keys = Object.keys(sample);
if (keys.join(',') !== 'jvm,range,chart,selection,summary,open_incidents,persona') throw new Error(`context key order: ${keys.join(',')}`);
if (sample.persona !== 'developer') throw new Error('persona missing on context');
const ut = userTurn(sample, 'Is this JVM healthy right now?');
if (!ut.startsWith('<context>\n') || !ut.includes('\n</context>\n\nIs this JVM healthy right now?')) throw new Error(`userTurn shape: ${ut.slice(0, 120)}`);
if (ut.includes('Context:') || ut.includes('Question:')) throw new Error('old Context:/Question: format still in use');
if (compactJson(sample) !== JSON.stringify(sample)) throw new Error('compactJson mismatch');

async function turn(context, message, persona = 'developer') {
  const ev = []; const calls = []; let thought = '';
  const r = await runKusma({ urls, jvm, message, context, persona, onEvent: (n, p) => {
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

const a = await turn(buildContext({ jvm: ctxJvm, range, chart: null, selection: null, summary: null, openIncidents: [], persona: 'developer' }), 'Is this JVM healthy right now?');
if (a.route !== 'jafra_z' || !a.answer || !a.ev.includes('tool_call:end') || a.ev.indexOf('answer_delta') < a.ev.indexOf('tool_call:end')) throw new Error(`starter turn: ${a.route} ${a.ev.join(',')}`);
// Reasoning ON: thinking streams before the tool calls and never leaks into the answer; tool events carry the full context.
if (!a.thought || a.ev.indexOf('thought_delta') > a.ev.indexOf('tool_call:start')) throw new Error(`no streamed thinking before tools: ${a.ev.join(',')}`);
if (/<\/?think>/.test(a.answer) || (a.thought && a.answer.includes(a.thought.slice(0, 20)))) throw new Error('thinking leaked into the answer');
for (const c of a.calls) { const cx = c.sent?.context; if (!cx?.jvm?.pod || !cx?.jvm?.start || !RFC.test(cx.range?.from || '') || !c.url) throw new Error(`tool call without full context: ${JSON.stringify(c.sent)}`);
  if (cx.persona !== 'developer') throw new Error(`tool audit missing persona: ${JSON.stringify(cx)}`);
  if (!['get_incident', 'get_jvm_info'].includes(c.name) && !(RFC.test(c.query.from || '') || c.query.last)) throw new Error(`tool call without exact range: ${JSON.stringify(c.query)}`); }
// Messages sent to Jafra Z: one system prompt, user turn with <context> and persona.
const sys = a.messages?.find?.((m) => m.role === 'system') || null;
// runKusma returns messages after the loop; system is first
if (a.messages?.[0]?.role === 'system') {
  if (a.messages[0].content !== SYSTEM_PROMPT) throw new Error('system prompt not identical to SYSTEM_PROMPT');
  if (!a.messages[1]?.content?.startsWith('<context>\n')) throw new Error('user turn missing <context>');
  if (!a.messages[1].content.includes('"persona":"developer"')) throw new Error('persona not in context JSON');
}
if (iid) {
  const b = await turn(buildContext({ jvm: ctxJvm, range, chart: null, selection: { kind: 'incident', id: iid }, summary: null, openIncidents: [], persona: 'expert' }), 'Explain this incident please', 'expert');
  if (!b.answer) throw new Error('incident turn: no answer');
  if (b.calls[0] && b.calls[0].sent?.context?.persona !== 'expert') throw new Error('expert persona not audited');
}
const c = await turn(buildContext({ jvm: ctxJvm, range, chart: null, selection: null, summary: null, openIncidents: [], persona: 'developer' }), 'what is the weather today');
if (c.route === 'jafra_z') console.warn('note: Laya routed an off-topic question to jafra_z');
console.log(`check-chat ok route=${a.route} events=${a.ev.join(',')} answer="${a.answer.slice(0, 70)}"`);
