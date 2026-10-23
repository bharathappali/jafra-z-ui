import { buildContext } from '../src/chat/context.js';

const base = (process.env.VITE_JAFRA_HARNESS || process.env.VITE_JAFRA_API || 'http://127.0.0.1:8787').replace(/\/$/, '');
const workloads = await fetch(`${base}/v2/workloads`).then((r) => r.json());
const w = workloads.find((x) => x.pod === 'orders-worker-0');
const live = w.jvms.find((j) => Date.now() - Date.parse(j.last) < 60_000) || w.jvms[0];
const jvm = { ns: w.ns, pod: w.pod, container: w.container, start: live.start, jdk: live.jdk };
const range = { from: new Date(Date.now() - 15 * 60_000).toISOString(), to: new Date().toISOString() };

const list = await fetch(`${base}/v2/jvms/${encodeURIComponent(w.ns)}/${encodeURIComponent(w.pod)}/${encodeURIComponent(w.container)}/incidents?cluster=${encodeURIComponent(w.cluster)}&start=${encodeURIComponent(String(Date.parse(live.start)))}&last=15m`).then((r) => r.json());
const iid = list.incidents?.[0]?.id || 'heap_near_full-1';
const cases = [
  buildContext({ jvm, range, chart: null, selection: null, summary: 'starter', openIncidents: [] }),
  buildContext({
    jvm, range,
    chart: { id: 'cpu-limit', title: 'CPU limit', group: 'cpu', view: 'time' },
    selection: { kind: 'bar', key: 'b0', label: 'executor-thread' },
    summary: null,
    openIncidents: [],
  }),
  buildContext({
    jvm, range,
    chart: { id: 'heap-used', title: 'Heap used', group: 'heap', view: 'time' },
    selection: { kind: 'incident', id: iid, key: iid },
    summary: null,
    openIncidents: [{ id: iid, type: 'heap_near_full', group: 'heap', level: 'critical', headline: 'Heap near full' }],
  }),
];

async function readOrder(context, message) {
  const res = await fetch(`${base}/dummy/harness/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ persona: 'developer', message, context }),
  });
  const text = await res.text();
  const events = [...text.matchAll(/^event: (\S+)/gm)].map((m) => m[1]);
  const thought = events.indexOf('thought');
  const tool = events.indexOf('tool_call');
  const delta = events.indexOf('answer_delta');
  const done = events.lastIndexOf('done');
  if (!(thought >= 0 && tool > thought && delta > tool && done > delta)) {
    throw new Error(`bad order ${events.slice(0, 8).join(',')}`);
  }
}

await readOrder(cases[0], 'Is this JVM healthy right now?');
await readOrder(cases[1], 'Why is this bar the top?');
await readOrder(cases[2], 'Explain this incident');
console.log('check-chat ok');
