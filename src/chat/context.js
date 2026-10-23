/** Section 1.10 context block. Starters and free text pass chart and selection as null.
 * Key order is locked for training/harness byte-stability:
 *   jvm, range, chart, selection, summary, open_incidents, persona
 * Persona is required on every turn the harness sends (developer|expert).
 */

export function buildContext({ jvm, range, chart = null, selection = null, summary = null, openIncidents = [], persona = 'developer' }) {
  return {
    jvm: jvm ? {
      ns: jvm.ns,
      pod: jvm.pod,
      container: jvm.container,
      start: jvm.start,
      jdk: jvm.jdk,
    } : null,
    // Full RFC 3339 from/to (never a display label such as "15m"); `last` only when it is the API value the window came from.
    range: range && range.from != null && range.to != null ? { from: iso(range.from), to: iso(range.to), ...(range.last ? { last: range.last } : {}) } : null,
    chart: chart || null,
    selection: selection || null,
    summary: summary ?? null,
    open_incidents: openIncidents || [],
    persona: persona === 'expert' ? 'expert' : 'developer',
  };
}

function iso(v) {
  const n = typeof v === 'number' ? v : /^\d{10,}$/.test(String(v)) ? +v : Date.parse(String(v));
  return Number.isFinite(n) ? new Date(n).toISOString() : String(v);
}
