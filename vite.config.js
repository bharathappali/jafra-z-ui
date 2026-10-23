import { defineConfig, loadEnv } from 'vite';
import { Readable } from 'node:stream';

/**
 * Same-origin dev proxy (Settings → "Same-origin dev proxy"), so the demo works without CORS on the analyzer,
 * Laya or llama-server. Dev server only; `vite build` output has no proxy.
 *   POST /__jz/config {analyzer, laya, jafraz}   ← the UI sends its saved URLs (kept in memory)
 *   ANY  /__jz/<service>/<path>                  → <url of that service>/<path>, streamed (SSE works)
 * Targets start from VITE_ANALYZER_URL / VITE_LAYA_URL / VITE_JAFRAZ_URL. Only http(s) targets are forwarded.
 */
function jzProxy(env) {
  const targets = { analyzer: env.VITE_ANALYZER_URL || env.VITE_JAFRA_API || '', laya: env.VITE_LAYA_URL || '', jafraz: env.VITE_JAFRAZ_URL || '' };
  const send = (res, code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
  return {
    name: 'jz-dev-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/__jz/')) return next();
        const body = await new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))); });
        if (req.url === '/__jz/config') {
          if (req.method !== 'POST') return send(res, 200, targets);
          try {
            const cfg = JSON.parse(body.toString() || '{}');
            for (const k of Object.keys(targets)) if (typeof cfg[k] === 'string') targets[k] = cfg[k].replace(/\/+$/, '');
            return send(res, 200, targets);
          } catch (e) { return send(res, 400, { error: 'bad_request', message: String(e.message), hint: 'POST a JSON object {analyzer, laya, jafraz}', valid: [] }); }
        }
        const m = req.url.match(/^\/__jz\/(analyzer|laya|jafraz)(\/.*)?$/);
        if (!m) return send(res, 404, { error: 'not_found', message: 'unknown proxy service', hint: 'use /__jz/analyzer, /__jz/laya or /__jz/jafraz', valid: ['analyzer', 'laya', 'jafraz'] });
        const base = targets[m[1]];
        if (!/^https?:\/\//i.test(base)) return send(res, 502, { error: 'not_configured', message: `${m[1]} URL is not configured`, hint: 'set it in Settings', valid: [] });
        const ac = new AbortController();
        req.on('close', () => ac.abort());
        try {
          const headers = { accept: req.headers.accept || '*/*' };
          if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
          const up = await fetch(base + (m[2] || '/'), { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body, signal: ac.signal });
          res.statusCode = up.status;
          up.headers.forEach((v, k) => { if (!['content-encoding', 'content-length', 'transfer-encoding', 'connection'].includes(k) && !k.startsWith('access-control-')) res.setHeader(k, v); });
          if (!up.body) return res.end();
          Readable.fromWeb(up.body).on('error', () => res.end()).pipe(res);
        } catch (e) {
          if (ac.signal.aborted) return res.end();
          send(res, 502, { error: 'proxy_error', message: `${m[1]} unreachable at ${base}: ${e.cause?.code || e.message}`, hint: 'check the URL in Settings', valid: [] });
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [jzProxy(env)],
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    preview: { host: '127.0.0.1', port: 5173, strictPort: true },
  };
});
