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

export const STARTERS = [
  'Is this JVM healthy right now?',
  'What should I look at first?',
  'Explain the open incidents in plain language.',
];

export const QT = {
  point(p) { return [`Why is ${p.name} ${p.value} here?`, `Is ${p.name} unusual compared with the rest of the window?`, `What else moved when ${p.name} did?`]; },
  range(p) { return [`What changed between ${p.from} and ${p.to}?`, `Which metric moved the most in this range?`, `Did an incident overlap ${p.from}–${p.to}?`]; },
  bar(p) { return [`Why is ${p.name} the top ${p.what}?`, `What calls ${p.name}?`, `Is ${p.name} new in this window?`]; },
  cell(p) { return [`Why is ${p.name} hot in this slice?`, `Is this slice worse than the others?`, `What was ${p.name} doing then?`]; },
  frame(p) { return [`What is ${p.name} doing on CPU?`, `Who calls ${p.name}?`, `Is ${p.name} expected for this workload?`]; },
};
