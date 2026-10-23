# Jafra Z

Vanilla-JS dashboard for the Jafra analyzer. Numbers come from the analyzer v2 API. The dummy analyzer used in development lives in `do_not_commit/dummy-api/` (gitignored).

## Run

```bash
node do_not_commit/dummy-api/server.mjs
npm install
npm run dev
```

Open http://127.0.0.1:5173/ . The UI talks to http://127.0.0.1:8787/ unless `?api=`, `localStorage["jz.api"]`, or `VITE_JAFRA_API` says otherwise.

```bash
npm run build
npm run preview
```

Contract checks for the dummy API: `node --test do_not_commit/dummy-api/test/contract.test.mjs`.
