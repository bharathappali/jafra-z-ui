import { buildOption, planFor } from '../src/charts/registry.js';

const base = (process.env.VITE_JAFRA_API || 'http://127.0.0.1:8787').replace(/\/$/, '');
const workloads = await fetch(`${base}/v2/workloads`).then((r) => r.json());
let checked = 0;
for (const w of workloads) {
  const seen = new Set();
  for (const j of w.jvms) {
    const key = `${w.ns}/${w.pod}/${w.container}/${j.start}/${w.cluster}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const q = `start=${encodeURIComponent(String(Date.parse(j.start)))}&cluster=${encodeURIComponent(w.cluster)}&last=15m`;
    const root = `/v2/jvms/${encodeURIComponent(w.ns)}/${encodeURIComponent(w.pod)}/${encodeURIComponent(w.container)}`;
    const list = await fetch(`${base}${root}/charts?${q}`).then((r) => r.json());
    for (const chart of list.charts || []) {
      if (chart.availability !== 'available') continue;
      const views = chart.views?.length ? chart.views : [{ id: 'time' }];
      for (const view of views) {
        const plan = planFor(chart, view);
        let payload = {};
        let url = `${base}${root}/charts/${encodeURIComponent(chart.id)}?${q}&view=${encodeURIComponent(view.id)}`;
        if (plan.source === 'flame') url = `${base}${root}/flame/${encodeURIComponent(plan.group)}?${q}`;
        else if (plan.source === 'query') url = `${base}${root}/query?${q}&metric=${encodeURIComponent(plan.metric)}&by=${encodeURIComponent(plan.by)}`;
        else if (plan.source === 'events') url = `${base}${root}/events?${q}&type=${encodeURIComponent(plan.type)}`;
        const res = await fetch(url);
        payload = await res.json();
        const option = buildOption(plan, payload);
        const ok = option && (option.series?.length || option.graphic);
        if (!ok) throw new Error(`empty option ${key} ${chart.id} ${view.id}`);
        checked += 1;
      }
    }
  }
}
console.log(`check-charts ok options=${checked}`);
