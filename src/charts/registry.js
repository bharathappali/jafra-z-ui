/** Catalogue-order chart registry. Pure: importable from Node (no DOM). */

export const GROUP_COLOR = {
  cpu: '#F08A5D', heap: '#D9619F', gc: '#8E90FB', metaspace: '#C85A9A', codecache: '#A77BCA',
  nmt: '#E07FB5', container: '#B4507F', threads: '#3BB273', locks: '#B05CE0', vt: '#2E9A62',
  safepoint: '#4F63D2', jit: '#7C8BA1', classes: '#95A3B8', socket: '#2FA4C7', file: '#1F7FA0',
  exceptions: '#E5484D', alloc: '#E2A72E', endpoint: '#14A38B',
};

export const GROUP_LABEL = {
  cpu: 'CPU', heap: 'Heap', gc: 'GC', metaspace: 'Metaspace', codecache: 'Code cache',
  nmt: 'Native memory', container: 'Container', threads: 'Threads', locks: 'Locks',
  vt: 'Virtual threads', safepoint: 'Safepoints', jit: 'JIT', classes: 'Classes',
  socket: 'Sockets', file: 'File I/O', exceptions: 'Exceptions', alloc: 'Allocation',
  endpoint: 'Endpoints',
};

/** Incident-page primary chart per group. */
export const PRIMARY = {
  cpu: 'cpu-limit', heap: 'heap-used', gc: 'gc-pauses', metaspace: 'metaspace',
  codecache: 'code-cache', nmt: 'nmt', container: 'memory-limits', threads: 'threads',
  locks: 'locks', vt: 'vthreads', safepoint: 'safepoints', jit: 'jit',
  classes: 'class-loading', socket: 'socket', file: 'file-io', exceptions: 'exceptions',
  alloc: 'alloc-classes', endpoint: 'endpoints-time',
};

export const FLAME_IDS = ['cpu-flame', 'wall-flame', 'alloc-flame', 'lock-flame', 'socket-flame'];

const BY_VIEW = {
  loaders: 'loader', heaps: 'code_heap', reasons: 'reason', sites: 'site',
  classes: 'class', cat: 'category', threads: 'thread', endpoints: 'endpoint',
};

export function planFor(chart, view) {
  const viewId = typeof view === 'string' ? view : view?.id;
  if (viewId === 'flame' || chart.id?.endsWith('-flame')) {
    return { source: 'flame', group: chart.group, chartId: chart.id, view: viewId || 'flame' };
  }
  if (viewId && BY_VIEW[viewId] && chart.metrics?.length) {
    return { source: 'query', metric: chart.metrics[0], by: BY_VIEW[viewId], chartId: chart.id, view: viewId };
  }
  if (viewId === 'errors' && chart.events?.length) {
    return { source: 'events', type: chart.events[0], chartId: chart.id, view: viewId };
  }
  return { source: 'chart', chartId: chart.id, view: viewId };
}

export function visibleForGc(chartId, gcOld) {
  const g = (gcOld || '').toLowerCase();
  if (chartId === 'compaction') return g.includes('parallel') || g.includes('ps');
  if (chartId.startsWith('zgc-')) return g.includes('zgc') || g.includes('z');
  return true;
}

export function navEntries(charts) {
  const flames = charts.filter((c) => FLAME_IDS.includes(c.id));
  const rest = charts.filter((c) => !FLAME_IDS.includes(c.id));
  const out = rest.map((c) => ({ ...c, navId: c.id }));
  if (flames.length) {
    const first = flames[0];
    out.push({
      ...first,
      id: 'flame-graph',
      navId: 'flame-graph',
      title: 'Flame graph',
      group: 'cpu',
      views: flames.map((f) => ({ id: f.id, title: f.title })),
      flameIds: flames.map((f) => f.id),
    });
  }
  return out;
}

const PAL = ['#7C7EF5', '#E37AB3', '#E2A72E', '#3BB273', '#2FA4C7', '#E5484D', '#A77BCA', '#F08A5D'];

function lineSeries(body) {
  return (body.series || []).filter((s) => s.points?.length).map((s, i) => ({
    name: s.metric,
    type: 'line',
    showSymbol: false,
    smooth: false,
    data: s.points,
    lineStyle: { color: PAL[i % PAL.length], width: 1.6 },
    itemStyle: { color: PAL[i % PAL.length] },
  }));
}

function markAreas(body) {
  const areas = (body.markers || []).slice(0, 40).map((m) => ([
    { xAxis: m.t, itemStyle: { color: 'rgba(229,72,77,.12)' } },
    { xAxis: m.t },
  ]));
  return areas.length ? { data: areas } : undefined;
}

export function buildOption(plan, payload) {
  const source = plan?.source || 'chart';
  if (source === 'query' && payload) {
    if (payload.points?.length) {
      return axis({
        series: [{ name: payload.metric, type: 'line', showSymbol: false, data: payload.points.map((p) => [p.t, p.v]) }],
      });
    }
    const rows = payload.rows || [];
    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 48, right: 16, top: 24, bottom: 48 },
      xAxis: { type: 'category', data: rows.map((r) => r.key), axisLabel: { rotate: 30 } },
      yAxis: { type: 'value' },
      series: [{ type: 'bar', data: rows.map((r) => r.value), itemStyle: { color: '#7C7EF5' } }],
    };
  }
  if (source === 'events' && payload) {
    const ev = payload.events || [];
    return axis({
      series: [{ type: 'scatter', name: payload.type, data: ev.map((e) => [Date.parse(e.t), e.duration_us || 1]) }],
    });
  }
  if (source === 'flame' && payload) {
    const kids = payload.root?.children || [];
    return {
      tooltip: { trigger: 'item' },
      grid: { left: 120, right: 16, top: 16, bottom: 24 },
      xAxis: { type: 'value' },
      yAxis: { type: 'category', data: kids.map((k) => k.name).slice(0, 16) },
      series: [{ type: 'bar', data: kids.slice(0, 16).map((k) => k.total), itemStyle: { color: '#E37AB3' } }],
    };
  }
  const series = lineSeries(payload || {});
  if (payload?.flame?.root?.children?.length) {
    const kids = payload.flame.root.children.slice(0, 12);
    return {
      tooltip: { trigger: 'item' },
      grid: { left: 140, right: 16, top: 16, bottom: 24 },
      xAxis: { type: 'value' },
      yAxis: { type: 'category', data: kids.map((k) => k.name) },
      series: [{ type: 'bar', name: 'share', data: kids.map((k) => k.total), itemStyle: { color: '#F08A5D' } }],
    };
  }
  const ma = markAreas(payload || {});
  if (series.length && ma) series[0].markArea = ma;
  if (!series.length) {
    return {
      graphic: [{ type: 'text', left: 'center', top: 'middle', style: { text: payload?.summary || 'No samples in this window', fill: '#6C6E9E', font: '13px Varela Round' } }],
      series: [],
    };
  }
  return axis({ series });
}

function axis({ series }) {
  return {
    tooltip: { trigger: 'axis' },
    legend: { type: 'scroll', top: 0 },
    grid: { left: 56, right: 24, top: 32, bottom: 56 },
    xAxis: { type: 'time', axisLabel: { formatter: (v) => new Date(v).toISOString().slice(11, 19) } },
    yAxis: { type: 'value' },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 8 }],
    series,
  };
}

export function placeholderCopy(availability) {
  if (availability === 'nmt_off') {
    return { needs: 'Native Memory Tracking', why: 'Native Memory Tracking is off on this JVM.', alt: 'memory-limits' };
  }
  if (availability === 'not_on_this_jdk') {
    return { needs: 'a newer JDK', why: 'This chart needs a JDK this JVM is not running.', alt: null };
  }
  return null;
}
