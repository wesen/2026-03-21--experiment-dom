---
Title: Implementation Diary
Ticket: NEREVAL-APP
Status: active
Topics:
    - nereval
    - scraping
    - sqlite
    - express
    - proxy
    - job-queue
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: nereval/db.js
      Note: Added jobs and config tables, CRUD helpers, crash recovery
    - Path: nereval/worker.js
      Note: EventEmitter-based scraper worker extracted from run.js
    - Path: nereval/app.mjs
      Note: Combined Express server with job queue, SSE, config, and full UI
    - Path: nereval/fetch.js
      Note: Fixed ESM-only https-proxy-agent import
    - Path: nereval/run.js
      Note: Updated setProxy to be async
ExternalSources: []
Summary: "Step-by-step diary of implementing the NEREVAL-APP web application from the architecture guide."
LastUpdated: 2026-03-22T22:26:43.298354063-04:00
WhatFor: "Tracking implementation decisions, problems, and solutions"
WhenToUse: "When reviewing what was done and why during the NEREVAL-APP build"
---

# Implementation Diary

## Step 1: Add jobs and config tables to db.js (Task #2)

**Prompt Context:** Design doc specifies `jobs` table (status lifecycle: queued -> running -> completed/failed/cancelled) and `config` table (key-value for proxy_url, default_rps, etc.)

**What I Did:**
- Added `CREATE TABLE IF NOT EXISTS jobs (...)` with 18 columns covering status, pagination params, worker config, progress tracking, and timestamps
- Added `CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT)`
- Wrote CRUD helpers: `createJob`, `getJob`, `listJobs`, `updateJob`, `recoverJobs`
- Wrote config helpers: `getConfig`, `getConfigValue`, `setConfig`, `setConfigBulk`
- `updateJob` uses an allowlist of field names to prevent injection
- `recoverJobs` marks any `status='running'` jobs as `failed` on startup (crash recovery)

**What Worked:** All CRUD operations tested against `:memory:` SQLite. Crash recovery correctly marks stale jobs.

**What I Learned:** `updateJob` needs to be flexible (different fields updated at different stages) — allowlist + dynamic SQL is the right pattern for better-sqlite3's synchronous API.

## Step 2: Extract scraper worker into worker.js (Task #3)

**Prompt Context:** Need to separate the scraping logic from the CLI `run.js` so the web server can drive it and stream progress.

**What I Did:**
- Created `nereval/worker.js` with a `runScrapeJob(db, job, opts)` function
- Returns `{ emitter, promise }` — emitter is an EventEmitter, promise resolves when done
- Events: `status`, `page`, `detail`, `error`, `done`
- Added `emitter.abort()` for cancellation — sets a `cancelled` flag checked between operations
- Reused the same rate limiter pattern from run.js (`createRateLimiter`)
- Custom `CancelError` class to distinguish cancellation from real failures
- Worker updates the `jobs` table directly via `updateJob()` as it progresses

**What Worked:** Clean separation — the worker doesn't know about HTTP/SSE, just emits events and writes to SQLite.

**What Didn't Work Initially:** Nothing blocked, but I noticed the `setProxy` call needed to become async (see Step 4).

## Step 3: Build app.mjs — combined server (Tasks #4-9, #12)

**Prompt Context:** Design doc specifies Express server with 6 endpoint groups: scraper control, SSE streaming, config, data browsing, HTML UI.

**What I Did:**
- Created `nereval/app.mjs` combining all browser.mjs APIs + new scraper/config endpoints
- Job runner: `startJob(id)` calls `runScrapeJob()`, forwards all emitter events to SSE clients
- SSE endpoint: `/api/jobs/:id/stream` sends current state on connect, then live events, auto-closes on done
- Scraper API: POST /start (with conflict check), POST /stop, POST /retry (creates new job), GET /jobs
- Config API: GET (with password masking), PUT, POST proxy/test (via httpbin.org/ip)
- HTML UI: added Scraper tab with job form, live progress bar, event log, job history table
- HTML UI: added Settings modal with proxy input, test button, default town/rps/workers
- `sseClients` Map tracks active SSE connections per job ID, broadcasts events, cleans up on done
- Single-active-job enforcement: POST /start returns 409 if a job is already running

**What Worked:** Full round-trip: start job via UI -> SSE streams progress -> log updates -> job history refreshes. Config save/load works. Proxy test endpoint works.

## Step 4: Fix https-proxy-agent ESM import (Bug)

**Prompt Context:** App failed to start: `ERR_PACKAGE_PATH_NOT_EXPORTED` on `require('https-proxy-agent')`.

**What I Did:**
- Discovered `https-proxy-agent` v7 is ESM-only (no CJS exports in package.json)
- Changed `fetch.js` to lazy-load via `await import('https-proxy-agent')` instead of top-level `require`
- Made `setProxy()` async to accommodate the dynamic import
- Updated `run.js` and `worker.js` to `await setProxy()`
- Fixed `app.mjs` proxy test endpoint to use dynamic import too
- Used `httpsModule.default || httpsModule` pattern for Node built-in ESM imports

**What I Learned:** Always check if a package is ESM-only before using `require()`. The `fetch.js` original code with `require('https-proxy-agent')` at the top was actually broken all along — it would fail on any Node.js version with this package version. The lazy import is better anyway since it avoids loading proxy code when no proxy is configured.

## Step 5: Enhanced Landlords and Multi-Unit Analysis (Tasks #10, #11)

**Prompt Context:** Design doc calls for fuzzy name grouping, portfolio values, linked properties in landlords tab, and multi-unit filtering/sorting.

**What I Did:**
- Enhanced `/api/landlords` endpoint: added `search` param for name filtering, `sort` param (count/value/name), returns `account_numbers` for property linking
- Added `/api/multiunit` endpoint: filters multi-family/apartment/duplex/condo properties, returns `value_per_sqft` calculation, `designSummary` with counts and avg values
- Landlords tab UI: search bar, sort dropdown, min-properties dropdown, clickable property links (up to 5 shown, "+N more" overflow)
- Multi-Unit tab UI: design type filter, sort dropdown, design summary stat cards, properties table with $/sqft column
- Fixed SQLite alias bug: can't reference `value_num` alias in CASE expression in same SELECT — had to inline the full CAST/REPLACE expressions

**What Didn't Work:** SQLite `no such column: value_num` error when referencing a column alias in a CASE expression within the same SELECT. Unlike some databases, SQLite doesn't support referencing column aliases elsewhere in the same SELECT clause. Fix: inline the full expression.

## Step 6: End-to-End Test with Proxy (Task #13)

**Prompt Context:** Test the full flow: configure proxy, start job, monitor progress, browse results.

**What I Did:**
- Saved proxy config via PUT /api/config
- Tested proxy connectivity via POST /api/config/proxy/test — OK, 620ms latency, exit IP 107.5.44.60
- Started 3-page scrape job with proxy enabled via POST /api/jobs/start
- Job lifecycle confirmed: queued -> running (pages) -> running (details) -> completed
- Some 403 retries on page 3 (3 retry cycles), but all eventually succeeded
- Detail fetching progressing at ~1 req/s with 0 errors
- Tested job retry: creates new job from failed job's params
- Tested job cancellation: abort signal propagated correctly

**What I Learned:**
- Rayobyte rotating residential proxy works — each request may get a different IP
- The 403s with successful retries suggest WAF does short-window rate blocking per IP
- With proxy: ~1 rps is sustainable, occasional 403s resolved by retry (new IP on retry)
- Without proxy: our IP is still blocked from earlier scraping sessions

## Current State

- All 12 implementation tasks are done (2-13)
- `node nereval/app.mjs --db nereval-providence.db` starts the full app on port 3000
- 5 tabs: Properties, Landlords, Biggest, Multi-Unit, Scraper
- Settings modal for proxy config with test button
- Job queue with SSE progress streaming, start/stop/retry
- Proxy required for new scrapes (our IP is WAF-blocked)
- User-Agent: Chrome 131 on Windows 10
