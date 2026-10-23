import { typeTitle } from '../incidents/model.js';

const clock = (iso) => (iso ? String(iso).slice(11, 19) : '');

function num(incident) {
  const h = incident.how_bad?.headline || incident.felt || '';
  return h;
}

/** Mapped types follow data/build.py Q(dev, expert), filled from the record. */
const MAPPED = {
  cpu_throttling: (x) => ({
    dev: [
      `Why is this pod throttled in ${clock(x.t0)}–${clock(x.t1 || x.t0)}?`,
      'Which threads were burning CPU while the container sat on its quota?',
      'Would raising the CPU limit fix the slowdown?',
      'Did throttling make GC or safepoints slower in this window?',
    ],
    expert: [
      `Break down on-CPU samples while CFS throttled this window (${num(x)}).`,
      'Correlate throttled slices with time-to-safepoint and GC pause outliers.',
      'Is the cgroup quota undersized for the runnable thread count?',
      'Compare GC and compiler thread counts against the cgroup quota.',
    ],
  }),
  long_pause: (x) => ({
    dev: [
      `What caused the long GC pause at ${clock(x.t0)}?`,
      'Did this pause hurt request latency?',
      'Is the heap too small for this workload?',
      'How do I make GC pauses shorter?',
    ],
    expert: [
      `Phase breakdown of the pause at ${clock(x.t0)} (${num(x)}).`,
      'Was the pause dominated by time-to-safepoint, root scanning, or copy/compaction?',
      'Promotion and old-gen occupancy before vs after this collection.',
      'Would a different GC or pause target change this?',
    ],
  }),
  gc_overhead: (x) => ({
    dev: [
      'Why is so much time spent in GC?',
      'What is allocating so much memory here?',
      'Is GC overhead slowing the app down?',
      'Should I give this pod a bigger heap?',
    ],
    expert: [
      `Allocation rate and top sites during ${clock(x.t0)}–${clock(x.t1 || x.t0)}.`,
      'Young vs mixed/full collection mix and causes in the window.',
      'Eden sizing vs allocation rate.',
      'Is the pause target being met?',
    ],
  }),
  lock_contention: (x) => ({
    dev: [
      `Which lock is the thread waiting on (${x.who?.name || 'the hot monitor'})?`,
      'Is one thread holding it?',
      'Did this stall request threads?',
    ],
    expert: [
      'Monitor enter duration distribution and the owner stack.',
      'Park vs monitor-enter share in this window.',
      'Is the lock a single hot object or a class of locks?',
    ],
  }),
  slow_peer: (x) => ({
    dev: [
      `Which host is slow (${x.who?.name || 'the peer'})?`,
      'Are reads or writes the slow ones?',
      'Is this the database or another service?',
    ],
    expert: [
      'Socket read p99 vs the recording threshold, by remote address.',
      'Bytes and duration of the slowest reads in the window.',
      'Any TLS handshake spikes on the same peers?',
    ],
  }),
  pinning_burst: (x) => ({
    dev: [
      'Why are virtual threads pinned?',
      'Which frame is holding the pin?',
      'Does this block the carrier pool?',
    ],
    expert: [
      'Pinned duration distribution and the top native/monitor frames.',
      'Carrier thread count vs pinned virtual threads.',
      'Is the pin a synchronized block or a native call?',
    ],
  }),
  deopt_storm: (x) => ({
    dev: [
      'Why did the JIT deoptimise so much?',
      'Which method is unstable?',
      'Will this settle?',
    ],
    expert: [
      'Deoptimisation reasons in the window.',
      'Compile queue depth against the deopt rate.',
      'Uncommon-trap vs not-entrant share.',
    ],
  }),
  thread_churn: (x) => ({
    dev: [
      'Why are so many threads starting?',
      'Is a pool unbounded?',
      'What are the new threads doing?',
    ],
    expert: [
      'Thread start rate vs live count.',
      'Top thread names by start count.',
      'Any matching thread-end rate, or are they leaking?',
    ],
  }),
  native_growth: (x) => ({
    dev: [
      'What is growing outside the heap?',
      'Is native memory close to the pod limit?',
      'Which category grew?',
    ],
    expert: [
      'NMT committed by category across the window.',
      'Direct buffer vs other native.',
      'Compare committed with the cgroup memory limit.',
    ],
  }),
  metaspace_growth: (x) => ({
    dev: [
      'Why is metaspace growing?',
      'Are class loaders leaking?',
      'How close is it to the limit?',
    ],
    expert: [
      'Loaded vs unloaded classes in the window.',
      'Top class loaders by metadata.',
      'Is MaxMetaspaceSize set?',
    ],
  }),
  evac_promotion_failure: (x) => ({
    dev: [
      'What does an evacuation failure mean here?',
      'Is the heap running out of free space?',
      'How close did this get to an OutOfMemoryError?',
    ],
    expert: [
      'Evacuation or promotion failure count and bytes.',
      'Old-gen occupancy before the failure.',
      'Humongous allocations in the same window.',
    ],
  }),
  alloc_spike: (x) => ({
    dev: [
      `What allocated the spike at ${clock(x.t0)}?`,
      'Which class or site is responsible?',
      'Did this cause a GC pause?',
    ],
    expert: [
      'Top allocation sites by bytes in the window.',
      'TLAB refill rate vs the outside-TLAB path.',
      'Promotion rate after the spike.',
    ],
  }),
  heap_near_full: (x) => ({
    dev: [
      'Why is the heap staying full after GC?',
      'Is this a leak or a big live set?',
      'What should I change first?',
    ],
    expert: [
      `Live set vs the band (${num(x)}).`,
      'Top retained classes after GC.',
      'Old-gen occupancy trend and time to the limit.',
    ],
  }),
};

function generic(x) {
  const title = typeTitle(x.type).toLowerCase();
  const when = `${clock(x.t0)}–${clock(x.t1 || x.t0)}`;
  return {
    dev: [
      `What does the ${title} between ${when} mean for this JVM?`,
      `What should I look at first for this ${title}?`,
      `Is the ${title} still happening?`,
    ],
    expert: [
      `Which metric crossed the band for ${x.type} in ${when}?`,
      `Show the top frames or rows behind ${x.type}.`,
      `Does ${x.type} overlap another open incident?`,
    ],
  };
}

export function questionsFor(incident, persona = 'developer') {
  const fn = MAPPED[incident.type] || generic;
  const both = fn(incident);
  const list = persona === 'expert' ? both.expert : both.dev;
  return list.slice(0, persona === 'expert' ? 3 : 3);
}

export function allQuestions(incident) {
  const fn = MAPPED[incident.type] || generic;
  const both = fn(incident);
  return { dev: both.dev.slice(0, 3), expert: both.expert.slice(0, 3) };
}

/** Mockup chat-empty starters (jafra-z-dashboard.html renderMsgs). */
export const STARTERS = [
  'Is this JVM healthy right now?',
  'What are the top CPU consumers?',
  'Is the heap growing?',
];

const fmt = (v) => (v == null ? '–' : Math.abs(v) >= 100 ? Math.round(v).toLocaleString('en-US') : Math.abs(v) >= 10 ? (+v.toFixed(1)).toString() : (+v.toFixed(2)).toString());
const cap = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const clk = (ms) => new Date(ms).toISOString().slice(11, 19);

/**
 * Question templates from the mockup (QT), filled with the selection's real values.
 * Times are epoch ms (the mockup used seconds since the recording start).
 */
export const QT = {
  point: (s) => [`Why was ${s.q} ${fmt(s.v)}${s.u} at ${clk(s.t)}?`, `What else changed in this JVM around ${clk(s.t)}?`,
    s.med != null ? `${cap(s.q)} was ${fmt(s.v)}${s.u} at ${clk(s.t)} vs a median of ${fmt(s.med)}${s.u}. Is that a problem?` : null, `Which code or threads drove ${s.q} at ${clk(s.t)}?`].filter(Boolean),
  range: (s) => [`Why did ${s.q} ${s.l > s.f ? 'grow' : s.l < s.f ? 'drop' : 'stay'} ${s.l !== s.f ? `from ${fmt(s.f)}${s.u} to ${fmt(s.l)}${s.u}` : `at ${fmt(s.f)}${s.u}`} between ${clk(s.a)} and ${clk(s.b)}?`,
    `What caused the peak of ${fmt(s.mx)}${s.u} ${s.q} at ${clk(s.tm)}?`, s.inc ? `How do the ${s.inc} overlapping incident${s.inc > 1 ? 's' : ''} explain ${clk(s.a)}–${clk(s.b)}?` : `Nothing was flagged between ${clk(s.a)} and ${clk(s.b)}. Is anything unusual here?`,
    `What would bring ${s.q} down in this window?`],
  bar: (s) => [`Why is ${s.name} ${s.rank === 1 ? 'the top' : `#${s.rank}`} ${s.what} (${s.val})?`, `Where in my code does ${s.name} come from?`, `Is ${s.val} for ${s.name} expected for this workload?`],
  cell: (s) => [`Why did ${s.name} reach ${fmt(s.v)}${s.u} around ${s.when}?`, `What was ${s.name} doing at ${s.when}?`, `Is ${s.name} on the critical path during the incidents?`],
  frame: (s) => [`Why does ${s.name} take ${fmt(s.pct)}% of ${s.unit}?`, `Which callers lead to ${s.name}?`, s.cat === 'app' ? `How can I make ${s.name} cheaper?` : `Why is ${s.cat === 'jdk' ? 'this JDK method' : 'this JVM code'} (${s.name}) so hot in my workload?`, `Is ${s.name} hotter during the incidents than in the rest of the recording?`],
};

/** One-shot console note when falling back to the local catalogue. */
let _fallbackLogged = false;
function logFallback(where) {
  if (_fallbackLogged) return;
  _fallbackLogged = true;
  console.info(`[kusma] analyzer questions missing (${where}); using src/chat/questions.js fallback`);
}

/**
 * Prefer analyzer-filled questions[persona]; else local MAPPED/generic.
 * persona: 'developer' | 'expert'. Analyzer uses those keys; local uses dev/expert.
 */
export function pickQuestions(source, persona = 'developer', where = 'incident') {
  const p = persona === 'expert' ? 'expert' : 'developer';
  const fromApi = source?.questions?.[p] || source?.questions?.[p === 'expert' ? 'expert' : 'developer'];
  if (Array.isArray(fromApi) && fromApi.length) return fromApi.slice(0, 5);
  logFallback(where);
  if (source && source.type) return questionsFor(source, p);
  return (p === 'expert' ? STARTERS_EXPERT : STARTERS).slice(0, 5);
}

/** Fill range_questions templates ({from}/{to} as HH:MM:SS UTC) from a brush; else QT.range. */
export function rangeQuestions(chartBody, persona, aMs, bMs, stats) {
  const p = persona === 'expert' ? 'expert' : 'developer';
  const from = clockUtc(aMs); const to = clockUtc(bMs);
  const tpl = chartBody?.range_questions?.[p];
  if (Array.isArray(tpl) && tpl.length) {
    return tpl.map((s) => String(s).replaceAll('{from}', from).replaceAll('{to}', to)
      .replaceAll('{title}', chartBody.title || '')
      .replaceAll('{metric}', chartBody.series?.[0]?.metric || '')).slice(0, 5);
  }
  logFallback('range');
  if (stats) return QT.range(stats);
  return [`What happened between ${from} and ${to}?`, `What caused the peak between ${from} and ${to}?`, `Do any incidents explain ${from}–${to}?`];
}

const clockUtc = (ms) => new Date(ms).toISOString().slice(11, 19);

/** Expert starters (local fallback); developer list is STARTERS. */
export const STARTERS_EXPERT = [
  'Summarise open incidents with scores and overlapping groups.',
  'What dominates CPU self_pct in this window?',
  'Is heap.used.bytes trending to the limit?',
];

/** Starters for the empty composer: analyzer starters when loaded, else local. */
export function startersFor(persona, catalog) {
  const p = persona === 'expert' ? 'expert' : 'developer';
  const fromApi = catalog?.[p];
  if (Array.isArray(fromApi) && fromApi.length) return fromApi.slice(0, 5);
  return p === 'expert' ? STARTERS_EXPERT : STARTERS;
}
