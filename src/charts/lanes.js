/**
 * Incident timeline lanes: a port of the mockup's seekOption / renderSeek (jafra-z-dashboard.html 1604–1628),
 * fed from J/timeline ({window, lanes:[{group, state, segments:[{from,to,state}]}], incidents}) and J/incidents.
 * Pure (no DOM); main.js owns the ECharts instance.
 */
import { BRUSH, GROUP_LABEL, GROUP_ORDER, clock, defaultTheme, tms } from './registry.js';

const SEV = { critical: 2, warning: 1 };

/**
 * Lanes: one per group that has incidents in range (mockup rule), plus groups whose timeline segments are
 * critical/warning without an incident yet. Ordered like the report (worst state first, then catalogue order).
 * opts.all = true → all 18 groups (?lanes=all).
 */
export function laneGroups(timeline, incidents, report, opts = {}) {
  const has = new Set((incidents || []).map((x) => x.group));
  for (const l of timeline?.lanes || []) if ((l.segments || []).some((s) => SEV[s.state])) has.add(l.group);
  const rank = (report?.groups || []).map((g) => g.group);
  const order = (g) => { const i = rank.indexOf(g); return i < 0 ? 100 + GROUP_ORDER.indexOf(g) : i; };
  const list = opts.all ? [...GROUP_ORDER] : [...has];
  return list.sort((a, b) => order(a) - order(b));
}

export function laneHeight(n) { return Math.max(1, n) * 22 + 52; }

/** Map {incidents, segments} → custom-series items [lane, t0, t1, sev, selected, open]. */
function items(lanes, timeline, incidents, selId, now) {
  const out = [];
  for (const x of incidents || []) {
    const li = lanes.indexOf(x.group); if (li < 0) continue;
    const t0 = tms(x.t0); const t1 = x.status === 'open' || !x.t1 ? now : tms(x.t1);
    out.push({ value: [li, t0, Math.max(t1, t0), SEV[x.level] || 1, x.id === selId ? 1 : 0, x.status === 'open' ? 1 : 0], inc: x.id });
  }
  // Non-ok timeline segments that no incident covers yet (e.g. the first bad chunk) at the closed opacity.
  for (const l of timeline?.lanes || []) {
    const li = lanes.indexOf(l.group); if (li < 0) continue;
    for (const s of l.segments || []) {
      if (!SEV[s.state]) continue;
      const a = tms(s.from); const b = tms(s.to) || now;
      const covered = (incidents || []).some((x) => x.group === l.group && tms(x.t0) <= b && (x.status === 'open' || !x.t1 ? now : tms(x.t1)) >= a);
      if (!covered) out.push({ value: [li, a, b, SEV[s.state], 0, 0], seg: { group: l.group, state: s.state, from: a, to: b } });
    }
  }
  return out;
}

/**
 * seekOption port. opts: {theme, selectedId, titleOf(x), feltOf(x), paused:boolean, cursor:ms|null}
 */
export function laneOption(timeline, incidents, lanes, opts = {}) {
  const Th = opts.theme || defaultTheme(false);
  const w = timeline?.window || {};
  const from = tms(w.from); const to = tms(w.to);
  const cat = lanes.map((g) => GROUP_LABEL[g] || g);
  const byId = Object.fromEntries((incidents || []).map((x) => [x.id, x]));
  const cursor = opts.cursor ?? null;
  return {
    animation: false, brush: BRUSH(Th), toolbox: { show: false }, grid: { left: 118, right: 20, top: 6, bottom: 40 },
    tooltip: {
      trigger: 'item', confine: true, ...Th.tip,
      formatter: (p) => {
        const x = p.data && p.data.inc && byId[p.data.inc];
        if (x) return `<b>${opts.titleOf ? opts.titleOf(x) : x.type}</b> · ${clock(x.t0)}–${x.status === 'open' || !x.t1 ? 'now' : clock(x.t1)}<br>${(opts.feltOf ? opts.feltOf(x) : x.headline) || ''}<br><span style="opacity:.7">${x.status === 'open' ? 'open' : 'closed'} · ${x.confidence || ''} · click to open</span>`;
        const s = p.data && p.data.seg;
        return s ? `<b>${GROUP_LABEL[s.group] || s.group}</b> · ${s.state}<br>${clock(s.from)}–${clock(s.to)} · no incident yet` : '';
      },
    },
    xAxis: { type: 'time', min: from, max: to, axisLine: { lineStyle: { color: Th.hair } }, splitLine: { show: true, lineStyle: { color: Th.hair, type: 'dotted' } }, axisTick: { show: false }, axisLabel: { color: Th.ink3, fontSize: 10, formatter: (v) => clock(v).slice(0, 5) } },
    yAxis: { type: 'category', data: cat, inverse: true, axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: true, lineStyle: { color: Th.hair } }, axisLabel: { color: Th.ink3, fontSize: 10.5, fontFamily: 'Varela Round' } },
    dataZoom: [{
      type: 'slider', xAxisIndex: 0, height: 16, bottom: 4, filterMode: 'none', showDetail: true, labelFormatter: (v) => clock(v), borderColor: 'transparent', backgroundColor: Th.dark ? 'rgba(255,255,255,.06)' : 'rgba(159,161,255,.10)',
      fillerColor: Th.dark ? 'rgba(159,161,255,.22)' : 'rgba(159,161,255,.28)', handleStyle: { color: '#fff', borderColor: '#9FA1FF' }, moveHandleSize: 5, textStyle: { color: Th.ink3, fontSize: 10 }, dataBackground: { lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 } }, selectedDataBackground: { lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 } },
    },
    { type: 'inside', xAxisIndex: 0, filterMode: 'none', zoomOnMouseWheel: 'shift', moveOnMouseWheel: false }],
    series: [
      {
        type: 'custom', name: 'incidents',
        renderItem: (params, api) => {
          const lane = api.value(0); const a = api.coord([api.value(1), lane]); const b = api.coord([api.value(2), lane]); const h = api.size([0, 1])[1] * 0.5; const sel = api.value(4); const op = api.value(5);
          // Clamp to the plot area so a lane that starts before the window (or the zoom) is cut at the axis instead of drawing over the subsystem labels.
          const cs = params.coordSys; const x0 = Math.max(a[0], cs.x); const x1 = Math.min(Math.max(b[0], a[0] + 4), cs.x + cs.width);
          if (x1 <= x0) return null;
          return { type: 'rect', shape: { x: x0, y: a[1] - h / 2, width: Math.max(Math.min(4, cs.x + cs.width - x0), x1 - x0), height: h, r: h / 2 }, style: { fill: api.value(3) === 2 ? '#E5484D' : '#E59A12', opacity: op ? 0.95 : 0.5, stroke: sel ? (Th.dark ? '#fff' : '#24255A') : 'rgba(255,255,255,.9)', lineWidth: sel ? 2 : 1 } };
        },
        encode: { x: [1, 2], y: 0 }, data: items(lanes, timeline, incidents, opts.selectedId, to), z: 3, clip: true,
      },
      { type: 'line', name: 'cursor', data: [], markLine: { silent: true, symbol: 'none', data: cursor ? [{ xAxis: cursor }] : [], lineStyle: { color: '#D9619F', width: 1.4 }, label: { show: false } } },
      { type: 'line', name: 'future', data: [], markArea: { silent: true, data: cursor && cursor < to ? [[{ xAxis: cursor }, { xAxis: to }]] : [], itemStyle: { color: Th.dark ? 'rgba(255,255,255,.04)' : 'rgba(159,161,255,.07)' } } },
    ],
  };
}
