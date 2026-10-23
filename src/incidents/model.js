/** Incident card view-model. Pure: importable from Node. */

export const TYPE_TITLE = {
  long_pause: 'Long GC pause',
  gc_overhead: 'GC overhead',
  full_gc: 'Full GC',
  evac_promotion_failure: 'Evacuation failure',
  zgc_alloc_stall: 'ZGC allocation stall',
  system_gc_calls: 'System.gc calls',
  heap_near_full: 'Heap near full',
  oom: 'Out of memory',
  old_gen_rising: 'Old generation rising',
  alloc_spike: 'Allocation spike',
  container_near_limit: 'Container near its limit',
  overcommitted_config: 'Overcommitted config',
  metaspace_growth: 'Metaspace growth',
  loader_leak: 'Class loader leak',
  class_load_burst: 'Class load burst',
  class_unload_burst: 'Class unload burst',
  direct_buffer_leak: 'Direct buffer leak',
  native_growth: 'Native memory growth',
  cpu_throttling: 'CPU throttling',
  cpu_saturation: 'CPU saturation',
  cpu_jump: 'CPU jump',
  hot_frame_shift: 'Hot frame shift',
  lock_contention: 'Lock contention',
  single_hot_lock: 'One hot lock',
  thread_churn: 'Many new threads',
  thread_leak: 'Thread leak',
  pool_saturation: 'Pool saturation',
  event_loop_blocked: 'Event loop blocked',
  pinning_burst: 'Virtual thread pinning',
  vt_submit_failed: 'Virtual thread submit failed',
  ttsp_spike: 'Time to safepoint',
  safepoint_overhead: 'Safepoint overhead',
  deopt_storm: 'Deoptimisation storm',
  jit_backlog: 'JIT backlog',
  slow_peer: 'Slow socket reads',
  tls_churn: 'TLS handshake churn',
  slow_file_io: 'Slow file I/O',
  exception_storm: 'Exception storm',
  error_thrown: 'Error thrown',
  endpoint_slowdown: 'Endpoint slowdown',
  slow_requests: 'Slow requests',
};

export const ALL_TYPES = Object.keys(TYPE_TITLE);

export const INSTANT = new Set(['long_pause', 'full_gc', 'evac_promotion_failure', 'oom', 'ttsp_spike', 'error_thrown']);

export const CONF_TIP = {
  strong: 'Severe (score ≥ 90) and backed by at least one other incident in the same window.',
  medium: 'Clear signal (score ≥ 60), or moderate and backed by another incident.',
  weak: 'A single, mild signal. Worth a look, not proof.',
};

export function typeTitle(type) {
  return TYPE_TITLE[type] || type;
}

export function cardModel(incident) {
  const where = Array.isArray(incident.where) ? incident.where.slice(0, 5) : [];
  const todo = Array.isArray(incident.todo) ? incident.todo.slice(0, 3) : [];
  const when = incident.when && typeof incident.when === 'object' ? { ...incident.when } : { text: incident.when || '' };
  if (!when.text && when.t0) {
    const a = String(when.t0).slice(11, 19);
    const b = when.t1 ? String(when.t1).slice(11, 19) : 'now';
    when.text = `${a}–${b}${when.duration_s != null ? ` · ${when.duration_s}s` : ''}`;
  }
  const how = incident.how_bad && typeof incident.how_bad === 'object' ? { ...incident.how_bad } : {};
  how.headline = how.headline || incident.headline || '';
  how.worst = how.worst ?? how.evidence?.worst?.value;
  how.latest = how.latest ?? how.evidence?.latest?.value;
  const together = incident.together && typeof incident.together === 'object' ? { ...incident.together } : {};
  together.chain = together.chain || (together.related || []).map((r) => (typeof r === 'string' ? r : r.id));
  together.groupsLine = Array.isArray(together.groups) ? together.groups.map((g) => g.group || g).join(', ') : (together.groups || '');
  return {
    id: incident.id,
    type: incident.type,
    title: typeTitle(incident.type),
    group: incident.group,
    level: incident.level,
    status: incident.status || when.status,
    felt: incident.felt || '',
    when,
    how_bad: how,
    together,
    who: incident.who || {},
    where,
    todo,
    confidence: incident.confidence || how.confidence,
    chunks: INSTANT.has(incident.type) ? 1 : 2,
  };
}
