---
Title: Architecture and Implementation Guide
Ticket: NEREVAL-APP
Status: active
Topics:
    - nereval
    - scraping
    - sqlite
    - express
    - proxy
    - job-queue
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: nereval/fetch.js
      Note: HTTP fetch layer with proxy support and retry
    - Path: nereval/extract.js
      Note: DOM extraction for list and detail pages
    - Path: nereval/db.js
      Note: SQLite schema and upsert logic (9 tables)
    - Path: nereval/run.js
      Note: CLI scraper with parallel workers and rate limiting
    - Path: nereval/browser.mjs
      Note: Current read-only property browser (Express)
ExternalSources:
    - URI: https://data.nereval.com
      Note: Target site — ASP.NET WebForms property assessment database
Summary: "Architecture and implementation guide for building a web application that combines property data browsing with a job-queued scraper, proxy support, and real-time progress monitoring."
LastUpdated: 2026-03-22T22:04:39.916207861-04:00
WhatFor: "Implementation reference for the NEREVAL-APP build"
WhenToUse: "When implementing or extending any part of the nereval web application"
---

# Nereval Property Scraper — Architecture and Implementation Guide

## Executive Summary

This document describes the architecture for a web application that scrapes property assessment data from data.nereval.com and provides a UI for browsing, analyzing, and managing the scraping process. The application combines two existing systems — a CLI scraper (`nereval/run.js`) and a read-only property browser (`nereval/browser.mjs`) — into a single Express server with a SQLite-backed job queue, proxy support, real-time progress streaming, and analytics dashboards focused on finding large landlords and multi-unit properties.

The target site is an ASP.NET WebForms application that serves Rhode Island municipal property assessment data. It has two page types: a paginated property list (26 rows per page, `__doPostBack` pagination) and individual property detail pages with ~10 data tables covering assessment, building, sales, land, and owner information.

## Problem Statement

We have a working scraper and a working browser, but they're disconnected:

- **The CLI scraper** (`nereval/run.js`) runs from the terminal, handles pagination, parallel workers, rate limiting, and stores data in SQLite. But it has no web interface, no way to monitor progress from a browser, and no persistent job history.
- **The property browser** (`nereval/browser.mjs`) serves a read-only dashboard for exploring scraped data. But it can't trigger scrapes, configure proxies, or show scraping status.
- **Proxy configuration** exists in the fetch layer but requires CLI flags or environment variables. There's no way to configure it through a UI or save proxy settings.
- **The site blocks us** after too many requests (AWS WAF 403). We need proxy rotation and careful rate limiting, which should be configurable and visible in the UI.

The goal is a single application where you can: configure a proxy, start a scrape job for any town, watch its progress live, browse the collected data, and find interesting patterns like large landlords or high-value multi-unit buildings.

## Proposed Solution

A single Express server (`nereval/app.mjs`) that combines:

1. **Job queue** — SQLite-backed, managing scrape jobs with status tracking
2. **Scraper worker** — runs in-process, pulls jobs from the queue, emits progress via SSE
3. **Property browser** — the existing dashboard, enhanced with scraper controls
4. **Proxy management** — configure/test proxies through the UI, stored in SQLite
5. **Analytics** — landlord finder, multi-unit detector, value heatmaps

### What stays the same

- The DOM extraction logic (`nereval/extract.js`) — proven, well-tested
- The SQLite property schema (`nereval/db.js`) — 9 normalized tables
- The HTTP fetch layer (`nereval/fetch.js`) — retry, backoff, proxy agent
- The existing browser UI patterns — dark theme, stat cards, searchable tables, detail modals

### What changes

- The CLI runner (`nereval/run.js`) becomes a library that the server calls, not a standalone script
- The browser (`nereval/browser.mjs`) gains scraper control endpoints and SSE streaming
- A new `jobs` table tracks scrape history and progress
- A new `config` table stores proxy settings and rate limit preferences

## Architecture

### System overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Express Server (app.mjs)                   │
│                                                               │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ Browser UI   │  │ Scraper API  │  │ SSE /api/jobs/:id  │  │
│  │ (HTML/JS)    │  │ POST /start  │  │ /stream            │  │
│  │              │  │ POST /stop   │  │ real-time progress  │  │
│  │ Properties   │  │ GET /jobs    │  │                    │  │
│  │ Landlords    │  │ GET /config  │  │                    │  │
│  │ Analytics    │  │ PUT /config  │  │                    │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬───────────┘  │
│         │                 │                    │              │
│  ┌──────┴─────────────────┴────────────────────┴───────────┐ │
│  │                    Job Runner                            │ │
│  │  Pulls jobs from queue, runs scraper, emits events       │ │
│  │  Configurable: workers, rps, proxy, pages                │ │
│  └──────────────────────┬──────────────────────────────────┘ │
│                         │                                     │
│  ┌──────────────────────┴──────────────────────────────────┐ │
│  │                  SQLite Database                          │ │
│  │  properties | owners | assessments | buildings | sales    │ │
│  │  prior_assessments | sub_areas | land | mailing_addresses │ │
│  │  jobs | config                                            │ │
│  └──────────────────────────────────────────────────────────┘ │
│                         │                                     │
│  ┌──────────────────────┴──────────────────────────────────┐ │
│  │                  Fetch Layer (fetch.js)                    │ │
│  │  Proxy agent | Retry w/ backoff | Rate limiting           │ │
│  └──────────────────────┬──────────────────────────────────┘ │
│                         │                                     │
└─────────────────────────┼─────────────────────────────────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │  data.nereval.com      │
              │  (via proxy or direct) │
              └───────────────────────┘
```

### Component diagram

```mermaid
flowchart TD
    subgraph "Frontend (Single Page)"
        UI["Dark-themed SPA"]
        DASH["Dashboard: stats, charts"]
        PROPS["Properties: search, sort, filter"]
        LAND["Landlords: multi-property owners"]
        JOBS["Scraper: start, monitor, configure"]
    end

    subgraph "Express Server"
        API_BROWSE["/api/properties\n/api/landlords\n/api/biggest\n/api/stats"]
        API_SCRAPE["/api/jobs\n/api/jobs/start\n/api/jobs/:id/stop"]
        API_CONFIG["/api/config\n/api/config/proxy/test"]
        SSE["/api/jobs/:id/stream\nServer-Sent Events"]
    end

    subgraph "Job Runner"
        QUEUE["Job Queue\n(SQLite jobs table)"]
        WORKER["Scraper Worker\nfetch → extract → store"]
        LIMITER["Rate Limiter\ntoken bucket"]
    end

    subgraph "Storage"
        DB["SQLite\n(WAL mode)"]
    end

    subgraph "Network"
        PROXY["Proxy Agent\n(https-proxy-agent)"]
        SITE["data.nereval.com"]
    end

    UI --> API_BROWSE & API_SCRAPE & API_CONFIG & SSE
    API_SCRAPE --> QUEUE
    QUEUE --> WORKER
    WORKER --> LIMITER --> PROXY --> SITE
    WORKER --> DB
    API_BROWSE --> DB
    SSE -.->|progress events| UI

    style DB fill:#1a3a2a,color:#3fb950
    style SITE fill:#3d2e00,color:#d29922
    style PROXY fill:#1f3a5f,color:#58a6ff
```

## Design Decisions

### 1. SQLite for everything (data + jobs + config)

**Decision:** Use a single SQLite database for property data, job queue, and configuration.

**Why:** SQLite with WAL mode handles concurrent reads (browser queries) and a single writer (scraper worker) perfectly. No need for Redis, PostgreSQL, or a separate queue system. The entire application is a single `node` process with a single `.db` file — simple to deploy, back up, and move.

**Trade-off:** Only one scrape job can write at a time. This is fine — we don't want parallel scrapes hitting the same site anyway. The queue ensures jobs run sequentially.

### 2. SSE for progress streaming, not WebSocket

**Decision:** Use Server-Sent Events (SSE) for real-time scraper progress.

**Why:** SSE is simpler than WebSocket for one-way streaming (server → client). No handshake protocol, no keepalive negotiation, built-in reconnection in browsers. The progress stream is read-only — the client never needs to send data back through it.

**Implementation:** The `/api/jobs/:id/stream` endpoint holds the HTTP connection open and writes `data: {...}\n\n` lines as the scraper processes each property. The browser's `EventSource` API handles reconnection automatically.

### 3. In-process scraper worker, not a separate process

**Decision:** Run the scraper in the same Node.js process as the web server.

**Why:** Avoids IPC complexity. The scraper worker is I/O-bound (waiting on HTTP responses), so it doesn't block the event loop. SQLite writes are fast (< 1ms per property). The Express server continues responding to browser requests while the scraper runs.

**Trade-off:** If the scraper crashes, it takes down the server. Mitigation: wrap the scraper in a try/catch and mark the job as `failed` on error.

### 4. Proxy URL stored in config, not just CLI/env

**Decision:** Store proxy configuration in the SQLite `config` table, editable via the UI.

**Why:** Proxy credentials change, proxies get blocked, and you want to switch between direct and proxied access without restarting the server. The UI should let you paste a proxy URL, test it, and save it.

**Format:** Stored as a single URL string: `http://user:pass@host:port`. Passwords are stored in plaintext in the database (acceptable for a local tool; not for a hosted service).

### 5. Rate limiting as a global token bucket

**Decision:** Single token-bucket rate limiter shared across all parallel workers.

**Why:** The site's WAF counts requests per IP per time window. Whether you have 1 worker or 5, the total request rate must stay below the threshold. A global limiter ensures this regardless of worker count.

**Parameters:**
- `rps` — max requests per second (default: 1)
- `workers` — parallel fetch concurrency (default: 1)
- Workers add concurrency for network latency (while one waits for a response, another starts a request), but the limiter caps the total rate.

## Implementation Details

### New SQLite tables

```sql
-- Job queue: tracks scrape jobs and their progress
CREATE TABLE IF NOT EXISTS jobs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    town         TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'queued',
    -- status: queued | running | completed | failed | cancelled
    start_page   INTEGER DEFAULT 1,
    end_page     INTEGER DEFAULT 3,     -- or -1 for "all"
    workers      INTEGER DEFAULT 1,
    rps          REAL DEFAULT 1.0,
    use_proxy    INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now')),
    started_at   TEXT,
    finished_at  TEXT,
    -- Progress tracking
    pages_done   INTEGER DEFAULT 0,
    rows_found   INTEGER DEFAULT 0,
    details_done INTEGER DEFAULT 0,
    details_total INTEGER DEFAULT 0,
    errors       INTEGER DEFAULT 0,
    error_msg    TEXT,
    -- Summary stats written on completion
    properties_added  INTEGER DEFAULT 0,
    properties_updated INTEGER DEFAULT 0
);

-- Persistent configuration
CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT
);
-- Keys: proxy_url, default_rps, default_workers, default_town
```

### Job lifecycle

```mermaid
stateDiagram-v2
    [*] --> queued: POST /api/jobs/start
    queued --> running: Worker picks up job
    running --> completed: All pages + details done
    running --> failed: Unrecoverable error
    running --> cancelled: POST /api/jobs/:id/stop
    failed --> queued: POST /api/jobs/:id/retry
    completed --> [*]
    cancelled --> [*]
```

When the server starts, it checks for any `running` jobs left over from a crash and marks them `failed`. Only one job can be `running` at a time.

### SSE progress event format

The `/api/jobs/:id/stream` endpoint sends these event types:

```
event: status
data: {"status":"running","pages_done":3,"details_done":15,"details_total":42}

event: page
data: {"page":3,"rows":25,"total_rows":75}

event: detail
data: {"account":"24058","location":"40 ABBOTT ST","sales":3,"prior_years":5}

event: error
data: {"account":"24455","error":"HTTP 403","retrying":true}

event: done
data: {"status":"completed","properties_added":42,"duration_s":120}
```

The browser listens with `EventSource` and updates the UI in real time — progress bar, property count, error log.

### API endpoints

#### Scraper control

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/jobs/start` | Queue a new scrape job. Body: `{town, startPage, endPage, workers, rps, useProxy}` |
| `GET`  | `/api/jobs` | List all jobs (recent first) |
| `GET`  | `/api/jobs/:id` | Get job details + progress |
| `GET`  | `/api/jobs/:id/stream` | SSE stream of progress events |
| `POST` | `/api/jobs/:id/stop` | Cancel a running job |
| `POST` | `/api/jobs/:id/retry` | Re-queue a failed job |

#### Configuration

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/config` | Get all config (proxy URL masked) |
| `PUT`  | `/api/config` | Update config. Body: `{proxy_url, default_rps, ...}` |
| `POST` | `/api/config/proxy/test` | Test a proxy URL. Returns: `{ok, status, latency_ms, ip}` |

#### Data browsing (existing, unchanged)

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/stats` | Overview stats (counts, totals, distributions) |
| `GET`  | `/api/properties` | Search/filter/sort properties |
| `GET`  | `/api/property/:acct` | Full detail for one property |
| `GET`  | `/api/landlords` | Owners with multiple properties |
| `GET`  | `/api/biggest` | Top properties by value/area/units |
| `GET`  | `/api/histogram` | Value distribution |

### Scraper worker pseudocode

```javascript
async function runJob(db, jobId) {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  updateJob(db, jobId, { status: 'running', started_at: now() });

  // Configure proxy if enabled
  const proxyUrl = job.use_proxy
    ? db.prepare("SELECT value FROM config WHERE key = 'proxy_url'").get()?.value
    : null;
  if (proxyUrl) setProxy(proxyUrl);

  const emitter = new EventEmitter(); // SSE listeners subscribe here

  try {
    // Phase 1: Crawl list pages
    let page = job.start_page;
    while (page <= job.end_page) {
      const rows = await fetchAndExtractPage(page);
      for (const row of rows) upsertProperty(db, job.town, row);
      updateJob(db, jobId, { pages_done: page, rows_found: totalRows });
      emitter.emit('page', { page, rows: rows.length });
      page++;
    }

    // Phase 2: Fetch detail pages (parallel workers + rate limiter)
    const unique = deduplicateAccounts(allRows);
    updateJob(db, jobId, { details_total: unique.size });

    await fetchDetailsParallel(db, unique, {
      workers: job.workers,
      rps: job.rps,
      onDetail: (acct, detail) => {
        emitter.emit('detail', { account: acct, ... });
        updateJob(db, jobId, { details_done: ++done });
      },
      onError: (acct, err) => {
        emitter.emit('error', { account: acct, error: err.message });
        updateJob(db, jobId, { errors: ++errors });
      },
    });

    updateJob(db, jobId, { status: 'completed', finished_at: now() });
    emitter.emit('done', { status: 'completed' });
  } catch (err) {
    updateJob(db, jobId, { status: 'failed', error_msg: err.message });
    emitter.emit('done', { status: 'failed', error: err.message });
  }
}
```

### Proxy test endpoint

The proxy test endpoint makes a single request through the proxy to verify connectivity:

```javascript
app.post('/api/config/proxy/test', async (req, res) => {
  const { proxy_url } = req.body;
  const agent = new HttpsProxyAgent(proxy_url);
  const t0 = Date.now();
  try {
    // Fetch a lightweight page to test connectivity
    const response = await fetchViaProxy('https://httpbin.org/ip', { agent });
    const data = await response.json();
    res.json({
      ok: true,
      status: response.status,
      latency_ms: Date.now() - t0,
      ip: data.origin,  // shows the proxy's outbound IP
    });
  } catch (err) {
    res.json({ ok: false, error: err.message, latency_ms: Date.now() - t0 });
  }
});
```

### ASP.NET pagination: the hard constraint

The target site uses ASP.NET WebForms `__doPostBack` pagination. This means:

1. You **cannot jump to page N directly** — you must fetch pages 1 through N-1 first to chain the `__VIEWSTATE`
2. Each page's `__VIEWSTATE` is ~5.5KB and changes on every request
3. Pagination is sequential by nature (POST current viewstate → get next page + new viewstate)
4. The `--start` flag fast-forwards through earlier pages (fetching them for viewstate but not extracting)

This constraint means Phase 1 (list crawl) is always sequential. Only Phase 2 (detail fetches) benefits from parallelism, since detail pages are independent GETs.

### Handling the 403 block

The site returns HTTP 403 via AWS WAF after too many requests. Observations:

- **Trigger:** roughly >2 requests/second sustained for >30 seconds
- **Duration:** 15-30 minutes (sometimes longer)
- **Scope:** IP-based (proxy bypasses it)
- **Detection:** The response is a 118-byte HTML page: `<html><head><title>403 Forbidden</title></head>...`

Mitigation strategy:
1. Default to 1 rps (conservative)
2. Retry with exponential backoff (2s, 4s, 8s) — handles transient 403s
3. If all retries fail, pause the job and emit a `blocked` event so the UI can offer to switch to proxy
4. With a proxy, can safely run 2-4 rps

### UI layout

```
┌──────────────────────────────────────────────────────┐
│  Nereval Property Browser           [⚙ Settings]      │
├──────────────────────────────────────────────────────┤
│  [Dashboard] [Properties] [Landlords] [Scraper]       │
├──────────────────────────────────────────────────────┤
│                                                        │
│  Scraper tab:                                          │
│  ┌────────────────────────────────────────────┐       │
│  │ New Job                                     │       │
│  │ Town: [Providence ▾] Pages: [1] to [10]     │       │
│  │ Workers: [1]  RPS: [1]  [✓] Use proxy       │       │
│  │                          [Start Scrape]      │       │
│  └────────────────────────────────────────────┘       │
│                                                        │
│  ┌────────────────────────────────────────────┐       │
│  │ Current Job: #7 — Providence pages 1-10     │       │
│  │ Status: ██████████░░░░ 68% (58/85 details)  │       │
│  │ Phase: Detail fetch · 3 errors · 2:34 elapsed│      │
│  │ Rate: 1.0 req/s · Proxy: active             │       │
│  │                                  [Cancel]    │       │
│  └────────────────────────────────────────────┘       │
│                                                        │
│  Job History                                           │
│  #7  Providence  1-10   running   58/85   2:34        │
│  #6  Providence  1-5    completed 42/42   1:15        │
│  #5  Cranston    1-3    failed    0/0     0:02  403   │
│                                                        │
│  Settings panel (modal):                               │
│  ┌────────────────────────────────────────────┐       │
│  │ Proxy: [http://user:pass@host:port    ]     │       │
│  │        [Test Proxy] ✓ Connected (142ms)     │       │
│  │ Default RPS: [1]   Default Workers: [1]     │       │
│  │                              [Save]          │       │
│  └────────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────┘
```

## File Structure

```
nereval/
├── app.mjs              ← NEW: main server (replaces browser.mjs)
├── fetch.js             ← existing: HTTP fetch + proxy + retry
├── extract.js           ← existing: DOM extraction
├── db.js                ← existing: schema + upsert (add jobs + config tables)
├── run.js               ← existing: CLI runner (kept for standalone use)
├── worker.js            ← NEW: job runner (extracted from run.js for reuse)
├── browser.mjs          ← DEPRECATED: replaced by app.mjs
├── explore-*.js         ← existing: DOM exploration scripts
├── REPORT.md            ← existing: technical report
└── *.db                 ← SQLite databases (gitignored)
```

## Existing Code Reference

### `nereval/fetch.js` — what's already built

- `fetchWithRetry(url, init, { maxRetries, baseDelay })` — retry with exponential backoff on 403/429/5xx
- `fetchViaProxy(url, init)` — HTTP request through `https-proxy-agent` using Node's `https.request`
- `setProxy(url)` — configure the global proxy agent (normalized URL, creates `HttpsProxyAgent`)
- `getProxyInfo()` — returns the proxy URL with masked password
- `fetchListPage(town)` → `{ document, html }` — GET first page
- `fetchNextPage(town, viewState, eventValidation)` → `{ document, html }` — POST for pagination
- `fetchDetailPage(detailPath)` → `{ document, html }` — GET property detail
- `getFormState(document)` → `{ viewState, eventValidation }` — extract ASP.NET hidden fields
- `hasNextPage(document)` → boolean — check for "Next" link in GridView

### `nereval/extract.js` — what's already built

- `extractListRows(document)` → array of `{ mapLot, owner, location, detailUrl, accountNumber }` — from GridView, deduped by account+owner
- `extractDetail(document)` → `{ parcel, assessment, priorAssessments, location, building, sales, subAreas, land }` — full detail from all 10 tables
- `extractTablePairs(table)` → object — helper for ASP.NET label/value pair tables

### `nereval/db.js` — what's already built

- `openDb(path)` — open/create database with WAL mode and foreign keys
- `createTables(db)` — 9 property data tables
- `upsertProperty(db, town, row)` — insert/update from list page data
- `storeDetail(db, accountNumber, detail)` — store all detail page data with upsert

### `nereval/run.js` — what's already built

- `parseArgs()` — CLI argument parsing with `--help`
- `createRateLimiter(rps)` — global token-bucket rate limiter
- `fetchDetailsParallel(db, accounts, opts)` — worker pool with staggered start and rate limiting
- `main()` — two-phase orchestration: list crawl → detail fetch
- Supports: `--town`, `--pages`, `--start`, `--workers`, `--rps`, `--proxy`, `--no-details`, `--db`

## Open Questions

1. **Should we support multiple towns in the same database?** Currently the schema doesn't partition by town (account numbers may collide across towns). Adding a `town` column to more tables or using separate databases per town?

2. **Should the job runner support resuming a partially-completed job?** If a job fails at detail #45 of 85, should "retry" skip properties already fetched? The upsert logic handles re-fetching gracefully, but it wastes time.

3. **Should we add owner name normalization?** "Church of The Blessed Sacrament" and "Church of the Blessed Sacrement" (typo) are the same entity but appear as different owners. Fuzzy matching could merge these.

4. **Photo/sketch extraction?** The detail page has photo and sketch tables with image URLs. Should we download and store these?

5. **How aggressive can we be with a residential proxy?** Rayobyte residential proxies rotate IPs per request. With IP rotation, can we safely run 3-5 rps without triggering the WAF?

## Near-term Next Steps

See the task list in this ticket for the implementation order.
