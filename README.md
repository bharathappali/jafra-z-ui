# Jafra Z UI

Vanilla-JS dashboard for the Jafra analyzer. The chat assistant is **KUSMA** (Knowledge-driven Unified Systems Monitoring Assistant); it runs on the **Jafra Z** model server. Numbers come from the analyzer v2 API. The dummy analyzer used in development lives in `do_not_commit/dummy-api/` (gitignored).

## Run

```bash
node do_not_commit/dummy-api/server.mjs
npm install
npm run dev
```

Open http://127.0.0.1:5173/ and set the three service URLs in **Settings** (gear in the top bar, or click the service dots):

| Service | Placeholder | Health check | Used for |
|---|---|---|---|
| Analyzer | `http://localhost:8080` | `GET /v2/workloads` | workloads, charts, incidents, flames, KUSMA tools |
| Laya | `http://localhost:8000` | `GET /healthz` (+ `POST /route`) | routing each KUSMA question |
| Jafra Z | `http://localhost:8081` | `GET /health` (+ `POST /v1/chat/completions`) | the KUSMA model (streaming, reasoning on, tool calls) |

URLs are saved in `localStorage` (`jz.url.analyzer|laya|jafraz`). `VITE_ANALYZER_URL`, `VITE_LAYA_URL`, `VITE_JAFRAZ_URL` only prefill an empty setting; `?api=` overrides the analyzer for one page load. Health is polled every 15 s; each service is NOT CONFIGURED (grey), UNHEALTHY (red, with the error and last check time) or HEALTHY (green). KUSMA is locked until the Analyzer, Laya and Jafra Z are all connected and healthy.

### CORS

The browser calls the three services directly, so each must answer the preflight from the UI origin:

```
Access-Control-Allow-Origin: <UI origin, or *>
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

During `npm run dev` you can instead turn on **Same-origin dev proxy** in Settings (or `VITE_JZ_PROXY=1`): requests go to `/__jz/analyzer|laya|jafraz/...` and `vite.config.js` forwards them (SSE streams pass through). `vite build` output has no proxy.

### KUSMA

`src/kusma/harness.js`: Laya `/route` → Jafra Z `/v1/chat/completions` (stream, reasoning on) with the analyzer tools from `/v2/tools` → `J/tools/{tool}`. Thinking (`reasoning_content` or inline `<think>…</think>`) streams into the folded think step, tool calls into tool steps, then the answer. Tool arguments always go out in the API's exact form: full RFC 3339 `from`/`to` (the selection's range, else the window) or a valid `last` such as `15m`; never a display label. Each think/tool step folds the full context, request URL, arguments and result for audit. `node scripts/check-chat.mjs` runs the harness end to end (set the three `VITE_*_URL`).

```bash
npm run build
npm run preview
```

Contract checks for the dummy API: `node --test do_not_commit/dummy-api/test/contract.test.mjs`.
