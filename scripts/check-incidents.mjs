import { ALL_TYPES, TYPE_TITLE, cardModel } from '../src/incidents/model.js';

const base = (process.env.VITE_JAFRA_API || 'http://127.0.0.1:8787').replace(/\/$/, '');
const workloads = await fetch(`${base}/v2/workloads`).then((r) => r.json());
const w = workloads.find((x) => x.pod === 'orders-worker-0');
const j = w.jvms.find((x) => !x.end) || w.jvms[0];
const q = `start=${encodeURIComponent(String(Date.parse(j.start)))}&cluster=${encodeURIComponent(w.cluster)}&last=15m`;
const root = `${base}/v2/jvms/${encodeURIComponent(w.ns)}/${encodeURIComponent(w.pod)}/${encodeURIComponent(w.container)}`;
const stream = await fetch(`${root}/stream?${q}`, { headers: { accept: 'text/event-stream' } });
const reader = stream.body.getReader();
const dec = new TextDecoder();
let buf = '';
const started = Date.now();
let saw = false;
while (Date.now() - started < 7000) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  if (buf.includes('event: window')) { saw = true; break; }
}
reader.cancel();
if (!saw) throw new Error('no SSE window');
const list = await fetch(`${root}/incidents?${q}`).then((r) => r.json());
const full = await fetch(`${root}/incidents/${encodeURIComponent(list.incidents[0].id)}?${q}`).then((r) => r.json());
const card = cardModel(full);
for (const k of ['felt', 'when', 'how_bad', 'together', 'who', 'where', 'todo']) {
  if (card[k] == null) throw new Error(`missing ${k}`);
}
if (card.where.length > 5) throw new Error('where > 5');
if (card.todo.length > 3) throw new Error('todo > 3');
for (const t of ALL_TYPES) {
  if (!TYPE_TITLE[t]) throw new Error(`no title ${t}`);
}
console.log(`check-incidents ok types=${ALL_TYPES.length} card=${card.id}`);
