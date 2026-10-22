# SalesIQ frontend

A React + TypeScript frontend for the existing Sales AI FastAPI backend. It preserves the project's forecast, chat, Databricks and pipeline APIs. No backend replacement is included.

## Install in your project

Extract this archive and copy the `frontend` directory into your project root, next to your existing `backend` directory. If you already have a frontend folder, keep a backup before replacing it.

Use Node.js 22.12 or newer. From your project root:

```bash
cd frontend
npm ci
npm run dev
```

Open **http://localhost:5173**. Keep your working FastAPI backend running on **http://127.0.0.1:8000**, and keep Ollama running with the model configured in your backend environment.

The default setup requires no frontend environment file. Vite forwards `/api/*` requests to FastAPI on port 8000 and removes the `/api` prefix. This avoids changing backend CORS settings for local development.

## What you get

- Overview: global business KPIs, product/store selectors, 30/60/90-day historical chart windows with future forecasts, explicit AI forecast explanations, searchable/paginated product outlook, and CSV export for the selected store.
- AI analyst: direct analytics shortcuts, conversational questions with history and optional store context, Markdown answers, supporting data, copy, request cancellation, and a new conversation action.
- Data pipeline: one or two named CSV uploads, filename checks, 25 MiB per-file UI limit, triggering a run using existing data, automatic status polling, terminal-state handling, and recovery using the last real run ID saved in this browser.
- Responsive layouts, keyboard focus styles, a navigation skip link, native settings dialog, bundled local font files, and loading/error/empty states.

## Live data and sample preview

The default is **live mode**. Backend failures display an error and empty values; sample figures are never substituted automatically.

To explore without the backend, open **http://localhost:5173/?demo=1**, or enable “Preview sample data” in Display settings. A persistent banner identifies the illustrative data. Sample chat answers are scripted, and sample pipeline runs never upload files or start real jobs. Sample data uses a fixed October 2026 timeline for a reproducible preview.

Business snapshot KPIs come from the global `/kpis` endpoint and are labelled **All stores**. Dashboard store selection applies to forecasts and the product outlook. The chat selector supplies store context, but whether an individual analytics tool honors that context is determined by the existing backend. The sample chat is illustrative and does not model every product or store filter.

The history tabs change the historical lookback; they do not change the backend's forecast horizon. Forecasts and table totals are shown as returned by the API. Explanations describe existing predictions and do not train or modify a model.

## Optional settings

Copy `.env.example` to `.env.local` only if you need overrides:

```dotenv
VITE_API_BASE_URL=/api
VITE_CURRENCY=INR
```

Restart Vite after changing environment files. `VITE_CURRENCY` sets the initial display currency; the UI remembers later changes in browser storage. Currency selection changes the label only, with no currency conversion. Use the currency of your underlying data.

For a different local backend port, change `API_PROXY_TARGET` in the environment where Vite runs, or edit the proxy target in `vite.config.ts`. To use a direct API URL instead, set `VITE_API_BASE_URL` to that API origin and configure its CORS policy yourself.

**Never put Ollama credentials, Databricks tokens, AWS credentials or other secrets in `VITE_*` variables.** These values are visible in the browser bundle. Keep backend configuration in the backend only.

## API contracts

| Feature | Existing endpoint |
| --- | --- |
| Catalog | `GET /products`, `GET /stores` |
| Business snapshot | `GET /kpis` |
| Trend | `GET /forecast?product_id=…&store_id=…&include_history=true&history_days=60` |
| Store forecast rows | `GET /forecast?store_id=…` |
| Explanation | `POST /forecast/explain` |
| Conversation / shortcuts | `POST /chat`, `POST /chat/quick` |
| Upload and run | `POST /pipeline/upload-and-trigger` |
| Run existing input | `POST /pipeline/trigger` |
| Run status | `GET /pipeline/status/{run_id}` |

Multipart fields are **`sales_transactions_file`** and **`calendar_marketing_file`**. Use CSV names beginning with `sales_transactions` and `calendar_marketing_external`, respectively. Filename prefixes are case-sensitive to match the current backend.

The 25 MiB limit is a browser-side guard, not a replacement for server-side limits or validation. Chat and explanations wait up to four minutes for local inference. The cancel button stops the browser waiting; the backend may continue inference if it does not propagate cancellation. The frontend makes no automatic POST retries that could duplicate a pipeline run.

## Checks

```bash
npm test
npm run build
```

Ten tests cover request contracts, multipart names, optional uploads, URL encoding, conversation history, validation errors, cancellation, timeouts and pipeline terminal states. The build checks TypeScript and produces `dist/`.

Browser checks exercised sample dashboard filtering, quick and conversational analyst answers, display settings, a sample pipeline run, and live API error states. These checks do not validate your real Databricks workspace or Ollama service, which were unavailable in the build environment. Responsive CSS is included; device testing is still recommended before release.

## Production note

This is the frontend source deliverable, ready to integrate locally. `npm run build` produces static assets. The Vite development proxy is not part of the static build: when you later deploy to AWS, route `/api/*` to FastAPI with the required prefix rewrite, configure SPA history fallback to `index.html`, and expose `/api/docs` if you want the default documentation link to work. Environment values are baked in at build time. `npm run preview` is a build preview, not an application hosting plan.

No authentication layer, AWS infrastructure, Docker setup or CI/CD changes are introduced by this package. Those belong to the later deployment steps.

## Reference

Feature/API reference: https://github.com/Sandesh-hase/sales_ai_project (reviewed at `c93e4b12a1c0cb3617393785f6afbc28d13afdc3`). Integration checked against the user's backend at https://github.com/rs6739171-hash/sales_ai_project (reviewed at `179484cc0163c731d69fdd645df2b74f76ae7cfe`). This is a new frontend design with compatibility adjustments for the user's named upload fields. No remote repository was modified.
