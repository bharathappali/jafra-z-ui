/** One EventSource per JVM. Caller closes the previous handle on switch. */
export function openStream(base, jvm, { onWindow, onHeartbeat, onOpen, onError } = {}) {
  const q = new URLSearchParams();
  if (jvm.cluster) q.set('cluster', jvm.cluster);
  if (jvm.start) q.set('start', String(jvm.start));
  const path = `${base}/v2/jvms/${encodeURIComponent(jvm.ns)}/${encodeURIComponent(jvm.pod)}/${encodeURIComponent(jvm.container)}/stream${q.toString() ? `?${q}` : ''}`;
  const es = new EventSource(path);
  es.addEventListener('window', (ev) => {
    try { onWindow && onWindow(JSON.parse(ev.data)); } catch { /* ignore */ }
  });
  es.addEventListener('heartbeat', (ev) => {
    try { onHeartbeat && onHeartbeat(JSON.parse(ev.data)); } catch { /* ignore */ }
  });
  es.onopen = () => onOpen && onOpen();
  es.onerror = () => onError && onError();
  return {
    source: es,
    close() { es.close(); },
    get readyState() { return es.readyState; },
  };
}
