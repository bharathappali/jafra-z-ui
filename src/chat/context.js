/** Section 1.10 context block. Starters and free text pass chart and selection as null. */

export function buildContext({ jvm, range, chart = null, selection = null, summary = null, openIncidents = [] }) {
  return {
    jvm: jvm ? {
      ns: jvm.ns,
      pod: jvm.pod,
      container: jvm.container,
      start: jvm.start,
      jdk: jvm.jdk,
    } : null,
    range: range ? { from: range.from, to: range.to } : null,
    chart: chart || null,
    selection: selection || null,
    summary: summary ?? null,
    open_incidents: openIncidents || [],
  };
}
