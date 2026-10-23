/**
 * Catalogue-order chart registry. Pure: importable from Node (no DOM).
 * buildOption() returns ECharts options in the v4.3 mockup's visual language (cardOption / chart builders):
 * legend top-left with round-rect keys, hairline grid, area gradient under the first series, red/amber incident
 * markArea, pin markPoints, dashed critical limit line, Theil–Sen trend line, lineX brush.
 */

/** 18 catalogue groups, catalogue order. Colours/labels from the UI spec table (mockup SUB_COLOR extended to 18). */
export const GROUP_ORDER = ['cpu', 'heap', 'gc', 'metaspace', 'codecache', 'nmt', 'container', 'threads', 'locks', 'vt', 'safepoint', 'jit', 'classes', 'socket', 'file', 'exceptions', 'alloc', 'endpoint'];
export const GROUP_COLOR = {
  cpu: '#F08A5D', heap: '#D9619F', gc: '#8E90FB', metaspace: '#C85A9A', codecache: '#A77BCA',
  nmt: '#E07FB5', container: '#B4507F', threads: '#3BB273', locks: '#B05CE0', vt: '#2E9A62',
  safepoint: '#4F63D2', jit: '#7C8BA1', classes: '#95A3B8', socket: '#2FA4C7', file: '#1F7FA0',
  exceptions: '#E5484D', alloc: '#E2A72E', endpoint: '#14A38B',
};
export const GROUP_LABEL = {
  cpu: 'CPU', heap: 'Heap', gc: 'GC', metaspace: 'Metaspace', codecache: 'Code cache',
  nmt: 'Off-heap memory', container: 'Pod memory', threads: 'Threads', locks: 'Locks',
  vt: 'Virtual threads', safepoint: 'JVM-wide pauses', jit: 'JIT', classes: 'Classes',
  socket: 'Network', file: 'File I/O', exceptions: 'Exceptions', alloc: 'Allocation',
  endpoint: 'Endpoints',
};
export const LVL_COLOR = { crit: '#E5484D', warn: '#E59A12', info: '#9A9CBF' };

/** Incident-page primary chart per group (UI spec step 3). */
export const PRIMARY = {
  cpu: 'cpu-limit', heap: 'heap-used', gc: 'gc-pauses', metaspace: 'metaspace',
  codecache: 'code-cache', nmt: 'nmt', container: 'memory-limits', threads: 'threads',
  locks: 'locks', vt: 'vthreads', safepoint: 'safepoints', jit: 'jit',
  classes: 'class-loading', socket: 'socket', file: 'file-io', exceptions: 'exceptions',
  alloc: 'alloc-classes', endpoint: 'endpoints-time',
};
/** Card view per primary chart (alloc-classes uses its time view on the dashboard). */
export const PRIMARY_VIEW = { 'alloc-classes': 'time', nmt: 'total' };

/** One flame chart per subsystem: CPU, Allocation, Locks, Socket I/O, wall-clock (Threads) and Endpoint slow calls. */
export const FLAME_IDS = ['cpu-flame', 'alloc-flame', 'lock-flame', 'wall-flame', 'socket-flame'];
export const FLAME_GROUP = { 'cpu-flame': 'cpu', 'alloc-flame': 'alloc', 'lock-flame': 'locks', 'wall-flame': 'threads', 'socket-flame': 'socket', 'slow-breakdown': 'endpoint' };

/** Trend charts (Theil–Sen line + time to limit, on by default). chartId → view that carries it. */
export const TREND_VIEWS = { 'memory-limits': 'limit', 'cpu-limit': 'used', 'heap-used': 'used', metaspace: 'used', 'code-cache': 'total', nmt: 'total' };

/** Which series a view draws. `limit:` entries become the dashed critical limit line; `ax1:` go on the right axis; `dash:` dashed; `bar:` bars; `scatter:` dots. */
const VIEW_SERIES = {
  'cpu-limit:used': ['cpu.used.cores', 'cpu.user.cores', 'off:cpu.system.cores', 'limit:cpu.limit.cores'],
  'cpu-limit:throttle': ['cpu.throttled.pct', 'ax1:cpu.throttled.s_per_s'],
  'heap-spaces:used': ['heap.pool.used.bytes', 'dash:heap.pool.committed.bytes'],
  'heap-spaces:gc': ['heap.space.used.bytes'],
  'heap-spaces:ages': ['heap.survivor_age.bytes', 'ax1:bar:heap.promotion.bytes_per_s'],
  'heap-used:used': ['heap.used.bytes', 'dash:heap.committed.bytes', 'limit:heap.max.bytes'],
  'heap-live:live': ['scatter:heap.after_gc.bytes', 'off:heap.before_gc.bytes', 'limit:heap.max.bytes'],
  'alloc-classes:time': ['alloc.rate.bytes_per_s'],
  'gc-freed:freed': ['bar:gc.freed.bytes'],
  'gc-freed:copied': ['bar:gc.copied.bytes'],
  'gc-freed:shen': ['bar:gc.shenandoah.collected.bytes'],
  'gc-pauses:time': ['scatter:gc.pause.us', 'ax1:bar:gc.count.per_s'],
  'compaction:old': ['heap.space.used.bytes', 'ax1:bar:gc.full.count'],
  'zgc-reloc:bytes': ['bar:gc.zgc.reloc_set.bytes'],
  'zgc-pages:mb': ['bar:gc.zgc.reloc_group.bytes'],
  'zgc-pages:pages': ['bar:gc.zgc.reloc_group.pages'],
  'zgc-alloc:alloc': ['bar:gc.zgc.page_alloc.bytes'],
  'zgc-alloc:uncommit': ['gc.zgc.uncommit.bytes', 'gc.zgc.unmap.bytes'],
  'zgc-alloc:stall': ['scatter:gc.zgc.stall.us'],
  'metaspace:used': ['metaspace.used.bytes', 'dash:metaspace.committed.bytes', 'off:metaspace.class_space.used.bytes', 'dash:metaspace.gc_threshold.bytes'],
  'class-loading:time': ['bar:classes.loaded.per_s', 'bar:classes.unloaded.per_s', 'ax1:dash:classes.net.count'],
  'code-cache:total': ['codecache.used.bytes', 'limit:codecache.reserved.bytes', 'off:ax1:codecache.methods.count'],
  'nmt:total': ['nmt.committed.bytes', 'off:nmt.reserved.bytes', 'off:nmt.untracked.bytes', 'limit:container.limit.bytes'],
  'nmt:direct': ['nmt.direct.used.bytes', 'dash:nmt.direct.capacity.bytes', 'ax1:off:nmt.direct.buffers.count'],
  'memory-limits:limit': ['container.usage.bytes', 'container.rss.bytes', 'off:heap.committed.bytes', 'off:nmt.committed.bytes', 'limit:container.limit.bytes'],
  'threads:count': ['threads.live.count', 'off:threads.daemon.count', 'dash:threads.peak.count', 'ax1:bar:threads.started.per_s'],
  'threads:state': ['bar:threads.state.samples'],
  'locks:time': ['locks.wait.ms_per_s', 'ax1:bar:locks.wait.count'],
  'vthreads:time': ['vt.pinned.per_s', 'ax1:bar:vt.pinned.ms_per_s'],
  'safepoints:time': ['safepoint.duration.us', 'safepoint.ttsp.us', 'ax1:bar:safepoint.count.per_s'],
  'jit:time': ['bar:jit.compiles.per_s', 'bar:jit.deopts.per_min', 'ax1:off:jit.compile_time.pct'],
  'jit:queue': ['jit.queue.size', 'ax1:jit.queue.added.per_s', 'ax1:jit.queue.removed.per_s'],
  'socket:time': ['socket.read.us', 'ax1:bar:socket.read_time.ms_per_s'],
  'network:throughput': ['socket.net.rx.bytes_per_s', 'socket.net.tx.bytes_per_s'],
  'network:tls': ['bar:socket.tls.handshakes.per_s'],
  'network:writes': ['scatter:socket.write.us', 'ax1:bar:socket.write.bytes'],
  'file-io:time': ['file.io.us', 'ax1:bar:file.io.bytes'],
  'file-io:disk': ['file.disk.iops', 'ax1:file.disk.bytes_per_s'],
  'exceptions:time': ['exceptions.thrown.per_s', 'ax1:bar:exceptions.errors.count'],
  'endpoints-time:rate': ['endpoint.calls.per_s'],
  'endpoints-time:avg': ['endpoint.latency.us'],
  'slow-calls:scatter': ['scatter:endpoint.slow.us'],
};

/** Views that read J/query with `by` (rows → bars). [metric, by, stat?, what] */
const QUERY_VIEW = {
  'cpu-threads:heat': ['cpu.thread.pct', 'thread', null, 'CPU % by thread'],
  'alloc-classes:top': ['alloc.sampled.bytes', 'class', 'sum', 'allocated bytes by class'],
  'alloc-sites:paths': ['alloc.sampled.bytes', 'site', 'sum', 'allocated bytes by site'],
  'alloc-sites:gc': ['alloc.gc_trigger.count', 'site', 'sum', 'GC-triggering allocations by site'],
  'gc-pauses:hist': ['gc.pause.us', 'cause', 'max', 'longest pause by cause'],
  'gc-phases:phases': ['gc.phase.us', 'phase', 'sum', 'pause time by phase'],
  'gc-phases:refs': ['gc.references.count', 'type', 'sum', 'references processed by type'],
  'class-loading:loaders': ['classes.loader.classes.count', 'loader', 'max', 'classes by class loader'],
  'code-cache:heaps': ['codecache.used.bytes', 'code_heap', 'max', 'used by code heap'],
  'nmt:cat': ['nmt.category.committed.bytes', 'category', 'max', 'committed by NMT category'],
  'locks:total': ['locks.wait.ms_per_s', 'monitor', 'sum', 'total wait by lock'],
  'locks:count': ['locks.wait.count', 'monitor', 'sum', 'waits by lock'],
  'locks:max': ['locks.wait.ms', 'monitor', 'max', 'longest wait by lock'],
  'vthreads:sites': ['vt.pinned.per_s', 'site', 'max', 'pinning by code site'],
  'safepoints:ops': ['safepoint.duration.us', 'operation', 'sum', 'pause time by VM operation'],
  'jit:comp': ['jit.compile.us', 'method', 'max', 'longest compile by method'],
  'jit:reasons': ['jit.deopts.per_min', 'reason', 'count', 'deopts by reason'],
  'socket:hist': ['socket.read.us', 'peer', 'p99', 'p99 read time by peer'],
  'file-io:paths': ['file.io.us', 'path', 'p99', 'p99 I/O time by file'],
  'exceptions:errors': ['exceptions.errors.count', 'class', 'sum', 'errors by class'],
  'slow-breakdown:cause': ['endpoint.slow.wait.pct', 'wait_cause', 'avg', 'slow-call time by wait cause'],
  'endpoints-overview:table': ['endpoint.calls.per_s', 'handler', 'avg', 'calls/s by endpoint'],
};
/** endpoints-overview columns (J/query by=handler per metric). */
export const ENDPOINT_TABLE = [
  ['endpoint.calls.per_s', 'avg', 'Calls/s'], ['endpoint.latency.us', 'avg', 'Avg'], ['endpoint.latency.us', 'max', 'Max'],
  ['endpoint.slow.count', 'sum', 'Slow calls'], ['endpoint.slow.pct', 'avg', '% over 500 ms'],
];

export function planFor(chart, view) {
  const viewId = (typeof view === 'string' ? view : view?.id) || chart.views?.[0]?.id;
  const key = `${chart.id}:${viewId}`;
  if (viewId === 'flame' || chart.id?.endsWith('-flame')) {
    const kind = chart.id === 'slow-breakdown' ? 'wall' : (chart.frames?.[0] || undefined);
    return { source: 'flame', group: FLAME_GROUP[chart.id] || chart.group, kind, chartId: chart.id, view: viewId || 'flame' };
  }
  if (chart.id === 'endpoints-time' && viewId === 'max') return { source: 'query', metric: 'endpoint.latency.us', stat: 'max', step: true, chartId: chart.id, view: viewId, what: 'max latency' };
  if (QUERY_VIEW[key]) {
    const [metric, by, stat, what] = QUERY_VIEW[key];
    return { source: 'query', metric, by, stat: stat || undefined, chartId: chart.id, view: viewId, what };
  }
  return { source: 'chart', chartId: chart.id, view: viewId };
}

export function visibleForGc(chartId, gcOld) {
  const g = (gcOld || '').toLowerCase();
  if (chartId === 'compaction') return /parallel|ps ?mark|psparallel/.test(g);
  if (chartId.startsWith('zgc-')) return /\bz(gc)?\b|zgc/.test(g);
  return true;
}

/** Charts-page entries: one per catalogue chart (each flame is its own entry), in the 18-group order. */
export function navEntries(charts) {
  const rank = (g) => { const i = GROUP_ORDER.indexOf(g); return i < 0 ? 99 : i; };
  return charts.map((c, i) => ({ ...c, navId: c.id, _i: i })).sort((a, b) => (rank(a.group) - rank(b.group)) || (a._i - b._i));
}

/* ---------------- formatting ---------------- */
export const fmt = (v) => (v == null || Number.isNaN(v) ? '–' : Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : Math.abs(v) >= 10 ? (+v.toFixed(1)).toString() : (+v.toFixed(2)).toString());
const MIB = 1024 * 1024;
/** Display scale per unit: [factor, suffix]. */
export function unitScale(unit, maxAbs = 0) {
  switch (unit) {
    case 'bytes': return maxAbs >= 1024 * MIB ? [1 / (1024 * MIB), ' GiB'] : maxAbs >= MIB || !maxAbs ? [1 / MIB, ' MiB'] : [1 / 1024, ' KiB'];
    case 'bytes_per_s': return maxAbs >= 1024 * MIB ? [1 / (1024 * MIB), ' GiB/s'] : [1 / MIB, ' MiB/s'];
    case 'us': return maxAbs >= 1000 || !maxAbs ? [1 / 1000, ' ms'] : [1, ' µs'];
    case 'ms': return [1, ' ms'];
    case 'ms_per_s': return [1, ' ms/s'];
    case 'pct': return [1, '%'];
    case 'cores': return [1, ' cores'];
    case 'per_s': return [1, '/s'];
    case 'per_min': return [1, '/min'];
    case 's_per_s': return [1, ' s/s'];
    case 'count': return [1, ''];
    default: return [1, unit ? ` ${unit}` : ''];
  }
}
export function fmtUnit(v, unit) { const [f, s] = unitScale(unit, Math.abs(v || 0)); return `${fmt(v == null ? null : v * f)}${s}`; }
export const clock = (ms) => (ms == null ? '' : new Date(typeof ms === 'number' ? ms : Date.parse(ms)).toISOString().slice(11, 19));
export const tms = (v) => (v == null ? null : typeof v === 'number' ? v : Date.parse(v));

/** Plain metric label: "container.usage.bytes" → "Container usage". */
export function metricLabel(m) {
  const L = {
    'cpu.used.cores': 'Container CPU', 'cpu.user.cores': 'JVM user', 'cpu.system.cores': 'JVM system', 'cpu.limit.cores': 'CPU limit', 'cpu.throttled.pct': 'Throttled periods %', 'cpu.throttled.s_per_s': 'Throttled time (s/s)',
    'heap.used.bytes': 'Heap used', 'heap.committed.bytes': 'Heap committed', 'heap.max.bytes': 'Heap max', 'heap.after_gc.bytes': 'Heap after GC', 'heap.before_gc.bytes': 'Heap before GC',
    'metaspace.used.bytes': 'Metaspace used', 'metaspace.committed.bytes': 'Metaspace committed', 'metaspace.class_space.used.bytes': 'Class space used', 'metaspace.gc_threshold.bytes': 'GC threshold',
    'codecache.used.bytes': 'Code cache used', 'codecache.reserved.bytes': 'Reserved', 'codecache.methods.count': 'Compiled methods',
    'nmt.committed.bytes': 'NMT committed', 'nmt.reserved.bytes': 'NMT reserved', 'nmt.untracked.bytes': 'Untracked', 'nmt.direct.used.bytes': 'Direct buffers used', 'nmt.direct.capacity.bytes': 'Direct capacity', 'nmt.direct.buffers.count': 'Direct buffers',
    'container.usage.bytes': 'Pod memory', 'container.rss.bytes': 'RSS', 'container.limit.bytes': 'Pod limit',
    'threads.live.count': 'Live threads', 'threads.daemon.count': 'Daemon', 'threads.peak.count': 'Peak', 'threads.started.per_s': 'Started / s',
    'gc.pause.us': 'GC pause', 'gc.count.per_s': 'GCs / s', 'safepoint.duration.us': 'JVM-wide pause', 'safepoint.ttsp.us': 'Time to stop all threads', 'safepoint.count.per_s': 'Pauses / s',
    'endpoint.calls.per_s': 'Calls / s', 'endpoint.latency.us': 'Latency', 'endpoint.slow.us': 'Slow call', 'locks.wait.ms_per_s': 'Lock wait (ms/s)', 'locks.wait.count': 'Lock waits',
    'exceptions.thrown.per_s': 'Exceptions / s', 'exceptions.errors.count': 'Errors', 'alloc.rate.bytes_per_s': 'Allocation rate', 'socket.read.us': 'Socket read', 'socket.read_time.ms_per_s': 'Read time (ms/s)',
    'vt.pinned.per_s': 'Pinned / s', 'vt.pinned.ms_per_s': 'Pinned ms/s', 'jit.compiles.per_s': 'Compilations / s', 'jit.deopts.per_min': 'Deopts / min', 'jit.queue.size': 'Queue size',
    'classes.loaded.per_s': 'Loaded / s', 'classes.unloaded.per_s': 'Unloaded / s', 'classes.net.count': 'Loaded classes',
  };
  if (L[m]) return L[m];
  const p = String(m).split('.'); p.pop();
  const s = p.slice(1).join(' ').replace(/_/g, ' ');
  return s ? s[0].toUpperCase() + s.slice(1) : m;
}

/* ---------------- theme (pure; main passes the CSS-var values) ---------------- */
export function defaultTheme(dark = false) {
  return {
    dark, ink: dark ? '#F2F2FF' : '#24255A', ink3: dark ? '#A9AAD6' : '#6C6E9E', hair: dark ? 'rgba(255,255,255,.10)' : 'rgba(36,37,90,.08)',
    tip: { backgroundColor: dark ? 'rgba(34,35,70,.96)' : 'rgba(255,255,255,.97)', borderColor: dark ? 'rgba(255,255,255,.15)' : '#fff', padding: [6, 10], textStyle: { color: dark ? '#F2F2FF' : '#24255A', fontFamily: 'Varela Round', fontSize: 11.5 }, extraCssText: 'border-radius:10px;box-shadow:0 6px 18px rgba(70,72,150,.18);' },
  };
}
/** Mockup BRUSH(T). */
export const BRUSH = (T) => ({ toolbox: ['lineX'], xAxisIndex: 0, brushStyle: { borderWidth: 1, color: T.dark ? 'rgba(249,178,215,.16)' : 'rgba(249,178,215,.28)', borderColor: 'rgba(217,97,159,.55)' }, throttleType: 'debounce', throttleDelay: 120, transformable: false, removeOnClick: true, outOfBrush: { colorAlpha: 1 } });
const grad = (col) => ({ type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: `${col}55` }, { offset: 1, color: `${col}00` }] });
const ALT = ['#7F81F2', '#D97AAE', '#3BB273', '#E2A72E', '#2FA4C7'];
const BARC = ['#BFC0FF', '#F9A8C9', '#D8B4F8', '#BFE6F2', '#FFE7A3'];

function parseSpec(spec) {
  const parts = spec.split(':'); const metric = parts.pop(); const f = new Set(parts);
  return { metric, limit: f.has('limit'), ax1: f.has('ax1'), dash: f.has('dash'), off: f.has('off'), t: f.has('bar') ? 'bar' : f.has('scatter') ? 'scatter' : 'line' };
}

function timeAxis(T, ctx) {
  return {
    type: 'time', min: ctx.xMin ?? null, max: ctx.xMax ?? null, axisLine: { lineStyle: { color: T.hair } }, splitLine: { show: false }, axisTick: { show: false },
    axisLabel: { color: T.ink3, fontSize: 10, hideOverlap: true, formatter: (v) => { const c = clock(v); return c.slice(6) === '00' ? c.slice(0, 5) : `${c.slice(0, 5)}:${c.slice(6)}`; } },
  };
}

/**
 * Time-series card/page option (mockup cardOption).
 * ctx: {theme, color, incidents:[{id,level,t0,t1,peak_at,title,felt,status}], trend:bool, brush:bool, xMin, xMax, page:bool}
 */
function timeOption(plan, body, ctx) {
  const T = ctx.theme || defaultTheme(false);
  const base = ctx.color || '#7C7EF5';
  const key = `${plan.chartId}:${plan.view}`;
  const byMetric = Object.fromEntries((body.series || []).map((s) => [s.metric, s]));
  let specs = (VIEW_SERIES[key] || (body.series || []).map((s) => s.metric)).map(parseSpec).filter((z) => byMetric[z.metric]?.points?.length);
  if (!specs.length) specs = (body.series || []).filter((s) => s.points?.length).map((s) => parseSpec(s.metric));
  const lims = specs.filter((z) => z.limit);
  let plot = specs.filter((z) => !z.limit);
  if (!plot.length && lims.length) plot = lims.map((z) => ({ ...z, limit: false, dash: true }));
  if (!plot.length) return null;
  // units → axes: first unit on the left; a second unit (or explicit ax1) on the right.
  const u0 = byMetric[plot[0].metric].unit;
  plot.forEach((z) => { if (!z.ax1 && byMetric[z.metric].unit !== u0) z.ax1 = true; });
  const u1 = plot.find((z) => z.ax1) ? byMetric[plot.find((z) => z.ax1).metric].unit : null;
  const max0 = Math.max(0, ...plot.filter((z) => !z.ax1).flatMap((z) => byMetric[z.metric].points.map((p) => Math.abs(p[1] || 0))));
  const max1 = Math.max(0, ...plot.filter((z) => z.ax1).flatMap((z) => byMetric[z.metric].points.map((p) => Math.abs(p[1] || 0))));
  const [f0, s0] = unitScale(u0, max0); const [f1, s1] = unitScale(u1, max1);
  const twoAx = plot.some((z) => z.ax1);
  let ai = 0; let bi = 0;
  const series = plot.map((z, i) => {
    const s = byMetric[z.metric]; const f = z.ax1 ? f1 : f0;
    const col = z.t === 'bar' ? BARC[bi++ % BARC.length] : i === 0 ? base : ALT[ai++ % ALT.length];
    const o = {
      name: metricLabel(z.metric), metric: z.metric, unit: s.unit, type: z.t, yAxisIndex: z.ax1 ? 1 : 0,
      data: s.points.map((p) => [p[0], p[1] == null ? null : p[1] * f]), symbol: z.t === 'scatter' ? 'circle' : 'none', symbolSize: z.t === 'scatter' ? 4 : 0,
      connectNulls: true, itemStyle: { color: col, opacity: z.t === 'bar' ? 0.75 : 1 }, lineStyle: { width: i === 0 ? 2 : 1.4, color: col, type: z.dash ? 'dashed' : 'solid' },
      barMaxWidth: 4, z: z.t === 'bar' ? 1 : 3, emphasis: { disabled: true },
    };
    if (i === 0 && z.t === 'line') o.areaStyle = { color: grad(col) };
    return o;
  });
  const S = series[0];
  // limit line (dashed crit, label insideEndTop) — last value of the limit series, or the trend's limit.
  const markLines = [];
  let limV = null; let limL = null;
  for (const z of lims) {
    const pts = byMetric[z.metric].points; const last = [...pts].reverse().find((p) => p[1] != null);
    if (last) { limV = last[1] * f0; limL = `${metricLabel(z.metric).toLowerCase()} ${fmt(limV)}${s0}`; break; }
  }
  const tr = body.trend;
  if (limV == null && tr && tr.limit != null && ctx.trend !== false && (!tr.metric || byMetric[tr.metric])) { limV = tr.limit * f0; limL = `${tr.limit_source || 'limit'} ${fmt(limV)}${s0}`; }
  if (limV != null) markLines.push({ yAxis: limV, name: limL, lineStyle: { color: LVL_COLOR.crit, type: 'dashed', width: 1 }, label: { formatter: limL, position: 'insideEndTop', color: T.ink3, fontSize: 10 } });
  // event markers from J/charts (metaspace threshold / alloc failure / OOM, codecache.full, gc.system_gc …) as dotted vertical lines.
  const EV_COL = { oom: LVL_COLOR.crit, 'metaspace.alloc_failure': LVL_COLOR.crit, 'codecache.full': LVL_COLOR.crit, 'gc.evac_failed': LVL_COLOR.crit, 'gc.promotion_failed': LVL_COLOR.crit, 'metaspace.threshold': LVL_COLOR.warn };
  const EV_NAME = { oom: 'OutOfMemoryError', 'metaspace.alloc_failure': 'Metaspace allocation failure', 'metaspace.threshold': 'Metaspace GC threshold raised', 'codecache.full': 'Code cache full', 'gc.system_gc': 'System.gc()' };
  const scatterEv = new Set(['gc.pause', 'safepoint', 'endpoint.slow', 'jit.compile', 'socket.slow', 'file.slow']);
  for (const m of (body.markers || []).filter((x) => !scatterEv.has(x.type)).slice(0, 60)) {
    markLines.push({ xAxis: tms(m.t), name: `${EV_NAME[m.type] || m.type} · ${clock(m.t)}Z`, lineStyle: { color: EV_COL[m.type] || LVL_COLOR.info, type: 'dotted', width: 1.2 }, label: { show: false } });
  }
  if (markLines.length) S.markLine = { silent: false, symbol: 'none', data: markLines, tooltip: { show: true, trigger: 'item', formatter: (p) => p.name } };
  // incidents → markArea + pin markPoints at peak_at
  const incs = (ctx.incidents || []).filter((x) => x.t0);
  if (incs.length) {
    S.markArea = { silent: true, data: incs.map((x) => [{ xAxis: tms(x.t0), itemStyle: { color: `${x.level === 'critical' ? 'rgba(229,72,77,' : 'rgba(229,154,18,'}${T.dark ? '.12)' : '.10)'}` } }, { xAxis: tms(x.t1) || ctx.xMax || tms(x.t0) }]) };
    const valAt = (t) => { let best = null; let bd = Infinity; for (const p of S.data) { if (p[1] == null) continue; const d = Math.abs(p[0] - t); if (d < bd) { bd = d; best = p[1]; } } return best ?? 0; };
    S.markPoint = {
      symbol: 'pin', symbolSize: 30, data: incs.map((x) => { const t = tms(x.peak_at) || tms(x.t0); return { id: x.id, level: x.level, coord: [t, valAt(t)], itemStyle: { color: x.level === 'critical' ? LVL_COLOR.crit : LVL_COLOR.warn, borderColor: '#fff', borderWidth: 1.5, shadowBlur: 6, shadowColor: 'rgba(70,72,150,.3)' } }; }),
      label: { show: true, color: '#fff', fontWeight: 'bold', fontSize: 11, formatter: '!' },
      tooltip: { show: true, trigger: 'item', formatter: (p) => { const x = incs.find((z) => z.id === p.data.id); return x ? `<b>${x.title}</b> · ${clock(x.t0)}–${x.t1 ? clock(x.t1) : 'now'}<br>${x.felt || ''}<br><span style="opacity:.7">Click for questions</span>` : ''; } },
    };
  }
  // Theil–Sen trend (on by default; dashed periwinkle).
  if (tr && Array.isArray(tr.line) && tr.line.length >= 2 && ctx.trend !== false) {
    const tf = tr.metric && byMetric[tr.metric] ? (byMetric[tr.metric].unit === u0 ? f0 : f1) : f0;
    series.push({ name: 'Trend (Theil–Sen)', type: 'line', trend: true, yAxisIndex: tr.metric && byMetric[tr.metric]?.unit !== u0 && twoAx ? 1 : 0, data: tr.line.map((p) => [tms(p[0]), p[1] * tf]), symbol: 'none', lineStyle: { color: '#7C7EF5', width: 1.6, type: [6, 4] }, itemStyle: { color: '#7C7EF5' }, z: 4, emphasis: { disabled: true }, silent: true });
  }
  const offSel = Object.fromEntries(plot.filter((z) => z.off).map((z) => [metricLabel(z.metric), false]));
  return {
    animation: false, ...(ctx.brush !== false ? { brush: BRUSH(T) } : {}), toolbox: { show: false },
    grid: { left: 44, right: twoAx ? 40 : 14, top: 28, bottom: ctx.page ? 48 : 24 },
    legend: { top: 0, left: 40, right: 4, itemWidth: 12, itemHeight: 7, textStyle: { color: T.ink3, fontSize: 10.5 }, icon: 'roundRect', selected: offSel, type: 'scroll', pageIconSize: 9, pageTextStyle: { color: T.ink3 } },
    tooltip: {
      trigger: 'axis', confine: true, ...T.tip, axisPointer: { type: 'line', lineStyle: { color: '#9FA1FF', width: 1 } },
      formatter: (ps) => { if (!ps.length) return ''; const t = ps[0].value[0]; return `<b>${clock(t)}Z</b><br>${ps.filter((p) => p.value[1] != null).map((p) => `${p.marker}${p.seriesName}: <b>${fmt(p.value[1])}${p.seriesIndex < series.length && series[p.seriesIndex].yAxisIndex === 1 ? s1 : s0}</b>`).join('<br>')}`; },
    },
    xAxis: timeAxis(T, ctx),
    yAxis: [
      { type: 'value', min: 0, splitLine: { lineStyle: { color: T.hair } }, axisLabel: { color: T.ink3, fontSize: 10, formatter: (v) => fmt(v) }, name: s0.trim(), nameTextStyle: { color: T.ink3, fontSize: 9.5, align: 'right' }, nameGap: 6, max: limV != null ? (v) => Math.max(v.max, limV) * 1.05 : null },
      ...(twoAx ? [{ type: 'value', min: 0, splitLine: { show: false }, axisLabel: { color: T.ink3, fontSize: 10, formatter: (v) => fmt(v) }, name: s1.trim(), nameTextStyle: { color: T.ink3, fontSize: 9.5, align: 'left' }, nameGap: 6, max: u1 === 'pct' ? 100 : null }] : []),
    ],
    ...(ctx.page ? { dataZoom: [{ type: 'inside', xAxisIndex: 0, filterMode: 'none', zoomOnMouseWheel: 'shift', moveOnMouseWheel: false }, { type: 'slider', xAxisIndex: 0, height: 16, bottom: 4, filterMode: 'none', borderColor: 'transparent', backgroundColor: T.dark ? 'rgba(255,255,255,.06)' : 'rgba(159,161,255,.10)', fillerColor: T.dark ? 'rgba(159,161,255,.22)' : 'rgba(159,161,255,.28)', handleStyle: { color: '#fff', borderColor: '#9FA1FF' }, moveHandleSize: 5, textStyle: { color: T.ink3, fontSize: 10 }, labelFormatter: (v) => clock(v), dataBackground: { lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 } }, selectedDataBackground: { lineStyle: { opacity: 0 }, areaStyle: { opacity: 0 } } }] } : {}),
    series,
    _meta: { kind: 'ts', s0, s1, f0, f1, u0, u1 },
  };
}

/** Bars from J/query rows (mockup alloc-classes / locks bar language): horizontal, sorted, group colour. */
function barOption(plan, body, ctx) {
  const T = ctx.theme || defaultTheme(false);
  const rows = (body.rows || []).slice(0, 15);
  if (!rows.length) return null;
  const maxV = Math.max(...rows.map((r) => Math.abs(r.value || 0)));
  const [f, s] = unitScale(body.unit, maxV);
  const cats = rows.map((r) => String(r.key)).reverse();
  const vals = rows.map((r) => (r.value == null ? null : r.value * f)).reverse();
  const shares = rows.map((r) => r.share_pct).reverse();
  return {
    animation: false, toolbox: { show: false }, grid: { left: 8, right: 56, top: 8, bottom: 8, containLabel: true },
    tooltip: { trigger: 'item', confine: true, ...T.tip, formatter: (p) => `<b>${p.name}</b><br>${plan.what || body.metric}: <b>${fmt(p.value)}${s}</b>${shares[p.dataIndex] != null ? ` · ${fmt(shares[p.dataIndex])}%` : ''}<br><span style="opacity:.7">Click to ask</span>` },
    xAxis: { type: 'value', min: 0, splitLine: { lineStyle: { color: T.hair } }, axisLabel: { color: T.ink3, fontSize: 10, formatter: (v) => fmt(v) } },
    yAxis: { type: 'category', data: cats, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: T.ink3, fontSize: 10.5, fontFamily: 'JetBrains Mono', width: 260, overflow: 'truncate' } },
    series: [{ type: 'bar', name: plan.what || body.metric, data: vals, barMaxWidth: 16, itemStyle: { color: ctx.color || '#7C7EF5', borderRadius: [0, 6, 6, 0] }, label: { show: true, position: 'right', color: T.ink3, fontSize: 10, formatter: (p) => `${fmt(p.value)}${s}` } }],
    _meta: { kind: 'bars', cats, vals, unit: body.unit, s, what: plan.what || body.metric, rows: [...rows].reverse() },
  };
}

/** Slow-call scatter: one dot per call over the threshold (endpoint.slow markers), 500 ms line. */
function slowCallsOption(plan, body, ctx) {
  const T = ctx.theme || defaultTheme(false);
  const evs = (body.markers || []).filter((m) => m.type === 'endpoint.slow' && m.duration_us != null);
  if (!evs.length) return null;
  const data = evs.map((m) => ({ value: [tms(m.t), m.duration_us / 1000], ev: m }));
  return {
    animation: false, brush: BRUSH(T), toolbox: { show: false }, grid: { left: 44, right: 14, top: 28, bottom: 48 },
    legend: { top: 0, left: 40, itemWidth: 12, itemHeight: 7, icon: 'roundRect', textStyle: { color: T.ink3, fontSize: 10.5 } },
    tooltip: { trigger: 'item', confine: true, ...T.tip, formatter: (p) => { const e = p.data.ev || {}; return `<b>${e.handler || e.endpoint || 'call'}</b> · ${clock(e.t)}Z<br>${fmt(p.value[1])} ms${e.thread ? ` · ${e.thread}` : ''}${e.top_frame ? `<br><code>${e.top_frame}</code>` : ''}<br><span style="opacity:.7">Click to open the call's flame graph</span>`; } },
    xAxis: timeAxis(T, ctx), yAxis: { type: 'value', min: 0, name: 'ms', nameTextStyle: { color: T.ink3, fontSize: 9.5 }, splitLine: { lineStyle: { color: T.hair } }, axisLabel: { color: T.ink3, fontSize: 10 } },
    dataZoom: [{ type: 'inside', xAxisIndex: 0, filterMode: 'none', zoomOnMouseWheel: 'shift', moveOnMouseWheel: false }],
    series: [{ type: 'scatter', name: 'Slow call', symbolSize: 7, data, itemStyle: { color: ctx.color || '#14A38B', opacity: 0.85, borderColor: '#fff', borderWidth: 0.6 },
      markLine: { silent: true, symbol: 'none', data: [{ yAxis: 500, name: '500 ms', lineStyle: { color: LVL_COLOR.warn, type: 'dashed', width: 1 }, label: { formatter: '500 ms', position: 'insideEndTop', color: T.ink3, fontSize: 10 } }] } }],
    _meta: { kind: 'scatter-calls' },
  };
}

function emptyOption(text, ctx = {}) {
  const T = ctx.theme || defaultTheme(false);
  return { graphic: [{ type: 'text', left: 'center', top: 'middle', style: { text, fill: T.ink3, font: '13px Varela Round', width: 420, overflow: 'break', align: 'center' } }], series: [], _meta: { kind: 'empty' } };
}

/**
 * plan + payload (+ ctx) → ECharts option. Always non-empty (series or graphic): errors and empty data become a message.
 */
export function buildOption(plan, payload, ctx = {}) {
  const source = plan?.source || 'chart';
  if (payload && payload.error) return emptyOption(`${payload.message || payload.error}${payload.hint ? `\n${payload.hint}` : ''}`, ctx);
  if (source === 'flame') {
    const n = payload?.root?.total || 0;
    return emptyOption(n ? `Flame graph · ${n.toLocaleString('en-US')} ${payload.kind || ''} samples (drawn on canvas)` : 'No stacks recorded in this window', ctx);
  }
  if (source === 'query' && payload) {
    if (payload.points?.length) {
      const body = { series: [{ metric: payload.metric, unit: payload.unit, points: payload.points.map((p) => [tms(p.t), p.v]) }], markers: [] };
      return timeOption({ ...plan, view: `${plan.view}:q` }, body, ctx) || emptyOption('No samples in this window', ctx);
    }
    if (payload.series?.length) {
      const body = { series: payload.series.map((s) => ({ metric: s.key, unit: payload.unit, points: (s.points || []).map((p) => [tms(p.t), p.v]) })) };
      return timeOption({ ...plan, view: `${plan.view}:q` }, body, ctx) || emptyOption('No samples in this window', ctx);
    }
    return barOption(plan, payload, ctx) || emptyOption(payload.value != null ? `${fmtUnit(payload.value, payload.unit)}` : 'No rows in this window', ctx);
  }
  if (source === 'events' && payload) {
    const ev = payload.events || [];
    return slowCallsOption(plan, { markers: ev.map((e) => ({ ...e, type: 'endpoint.slow' })) }, ctx) || emptyOption('No events in this window', ctx);
  }
  if (plan.chartId === 'slow-calls') {
    const o = slowCallsOption(plan, payload || {}, ctx); if (o) return o;
  }
  return timeOption(plan, payload || {}, ctx) || emptyOption(payload?.summary || 'No samples in this window', ctx);
}

/** Mockup placeholder copy (PH): needs / why / alt. */
export function placeholderCopy(availability, chart = {}) {
  if (availability === 'nmt_off') {
    return { needs: 'jafra.io/jdk-nmt: "summary" (pod annotation) → -XX:NativeMemoryTracking=summary', why: 'Native Memory Tracking is off on this JVM, so the NMT views have no data. Add the jafra.io/jdk-nmt annotation to the pod and restart it to turn NMT on.', alt: 'memory-limits' };
  }
  if (availability === 'not_on_this_jdk') {
    const j = (chart.jdk || []).join(', ');
    return { needs: j ? `JDK ${j}` : 'a newer JDK', why: `This chart needs JDK ${j || 'a newer version'}; this JVM runs an older one.`, alt: chart.group === 'endpoint' ? 'cpu-flame' : null };
  }
  return null;
}
