/**
 * Fetches /v2/workloads and one J/report. No imports from src.
 * Base URL: ?api= on argv URL, else VITE_JAFRA_API, else http://127.0.0.1:8787.
 */
const arg = process.argv[2] || '';
const q = arg.includes('?') ? new URL(arg).searchParams : new URLSearchParams();
const base = (q.get('api') || process.env.VITE_JAFRA_API || 'http://127.0.0.1:8787').replace(/\/$/, '');
const workloads = await fetch(`${base}/v2/workloads`).then((r) => r.json());
if (!Array.isArray(workloads) || !workloads.length) throw new Error('workloads empty');
const w = workloads.find((x) => x.pod === 'orders-worker-0') || workloads[0];
const j = w.jvms[0];
const path = `/v2/jvms/${encodeURIComponent(w.ns)}/${encodeURIComponent(w.pod)}/${encodeURIComponent(w.container)}/report?start=${encodeURIComponent(String(Date.parse(j.start)))}&cluster=${encodeURIComponent(w.cluster)}`;
const report = await fetch(base + path).then((r) => r.json());
if (!report.groups?.length) throw new Error('report missing groups');
console.log(`check-api ok ${base} groups=${report.groups.length}`);
