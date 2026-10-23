/** Shared state + helpers for the v4.3 UI (mockup jafra-z-dashboard.html helpers: $, esc, icon, chev). */
import { createClient } from '../api/client.js';
import { defaultTheme } from '../charts/registry.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const icon = (id, st = '', cls = 'icon') => `<svg class="${cls}" style="${st}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
export const chev = () => icon('chev', 'width:14px;height:14px', 'icon chev');
let MID = 0;
export const mid = () => `m${++MID}`;
export const qs = new URLSearchParams(location.search);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const state = {
  page: qs.get('page') === 'charts' ? 'charts' : 'incidents',
  theme: qs.get('theme') === 'dark' ? 'dark' : (localStorage.getItem('jz-theme') || 'light'),
  chatOpen: qs.get('chat') !== '0',
  persona: localStorage.getItem('jz.persona') === 'expert' ? 'expert' : 'developer',
  dev: localStorage.getItem('jz.ctxdev') === 'on',
  workloads: null, // null = not loaded yet
  wlError: null,
  selected: null,
  info: null,
  report: null,
  timeline: null,
  incidents: [],
  chartList: [],
  range: { last: qs.get('last') || '15m' },
  live: true,
  chats: {},
  lastContext: null,
};

/** One analyzer client; rebuilt when the analyzer URL changes. */
export const api = { client: createClient() };
export function rebuildClient() { api.client = createClient(); return api.client; }

/** Late-bound cross-module hooks (each view registers its functions here). */
export const app = {};

export function chartTheme() { return defaultTheme(state.theme === 'dark'); }

/* ---------- workloads → picker rows ---------- */
export function splitPod(pod) {
  let m = pod.match(/^(.*)-(\d{6,})-([a-z0-9]+)$/i);
  if (m) return { workload: m[1], kind: 'Job', suffix: m[3] };
  m = pod.match(/^(.*)-([0-9a-f]{6,10})-([a-z0-9]+)$/i);
  if (m && !/^\d+$/.test(m[2])) return { workload: m[1], kind: 'Deployment', suffix: m[3] };
  m = pod.match(/^(.*)-(\d+)$/);
  if (m) return { workload: m[1], kind: 'StatefulSet', suffix: m[2] };
  return { workload: pod, kind: 'Pod', suffix: '' };
}
export function dotOf(last) {
  const age = Date.now() - Date.parse(last);
  if (Number.isNaN(age)) return 'ended';
  if (age <= 15_000) return 'live';
  if (age <= 10 * 60_000) return 'stale';
  return 'ended';
}
export const startClock = (iso) => (iso ? new Date(iso).toISOString().slice(0, 19).replace('T', ' ') : '');
export function jvmKey(j) { return j ? `${j.ns}/${j.pod}/${j.container}|${j.start}|${j.cluster || ''}` : 'none'; }
export function flatJvms() {
  const out = [];
  for (const w of state.workloads || []) {
    const { workload, kind, suffix } = splitPod(w.pod);
    for (const j of w.jvms || []) {
      out.push({ ns: w.ns, pod: w.pod, container: w.container, cluster: w.cluster, workload, kind, suffix,
        start: j.start, startMs: Date.parse(j.start), jdk: j.jdk, profile: j.profile, first: j.first, last: j.last, st: dotOf(j.last) });
    }
  }
  return out;
}
/** API path identity for a JVM (start as epoch ms, per contract ?start=). */
export const jvmRef = (j) => (j ? { ns: j.ns, pod: j.pod, container: j.container, cluster: j.cluster, start: j.startMs } : null);
/** Context-block jvm (contract 1.10). */
export const ctxJvm = (j) => (j ? { ns: j.ns, pod: j.pod, container: j.container, start: j.start, jdk: j.jdk } : null);
/** Range query params for the analyzer. */
export const rangeQ = () => ({ ...state.range });
