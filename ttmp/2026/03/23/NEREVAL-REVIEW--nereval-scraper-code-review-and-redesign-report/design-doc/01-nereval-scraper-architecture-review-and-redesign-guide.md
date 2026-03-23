---
Title: Nereval scraper architecture review and redesign guide
Ticket: NEREVAL-REVIEW
Status: review
Topics:
    - nereval
    - scraping
    - sqlite
    - queue
    - proxy
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: nereval/app.mjs
      Note: Combined server
    - Path: nereval/browser.mjs
      Note: Legacy browser server duplicated by app.mjs
    - Path: nereval/db.js
      Note: Schema
    - Path: nereval/extract.js
      Note: DOM parsing contracts
    - Path: nereval/fetch.js
      Note: Proxy and retry policy
    - Path: nereval/worker.js
      Note: List/detail worker orchestration and cancellation behavior
ExternalSources: []
Summary: Evidence-backed architecture review, code review findings, and redesign plan for the nereval scraper and app stack.
LastUpdated: 2026-03-23T00:25:47.598658509-04:00
WhatFor: Orient a new engineer, explain the current nereval scraper end to end, identify correctness and complexity risks, and propose a cleaner queue/cache/retry design.
WhenToUse: Use when reviewing the current nereval scraper, planning a refactor, or onboarding an intern to the scraper/app code.
---


# Nereval scraper architecture review and redesign guide

## Executive Summary

This document reviews the current `nereval/` scraper as it exists in code today, not as it was originally intended. The current system is functional enough to crawl the ASP.NET property list, cache form state, persist discovered properties in SQLite, and expose a browser UI with scrape controls. The core flow is understandable: `fetch.js` performs HTTP and proxy-aware retries, `extract.js` parses DOM tables into JavaScript objects, `db.js` stores list/detail data plus queue state, `worker.js` orchestrates crawl phases, `run.js` provides CLI entry, and `app.mjs` exposes a combined API/UI server. That baseline is real and useful.

The main design problem is that the code has crossed from "small experiment" into "stateful application" without finishing the architectural shift. The detail queue is global even though jobs carry `town` and `job_id`; the "job queue" is only partially implemented because queued jobs are not automatically drained; retry/cancel semantics are muddled; and the main server/UI file is now a 1,517-line monolith. Those are not style issues. They directly affect correctness, restart behavior, and the mental model a new engineer needs to use.

The recommendation is to keep the good parts, especially the SQLite-first architecture and the scraper phase split, but tighten the contracts. Treat the current code as a single-process scraper platform with three distinct concerns:

1. Property storage: canonical property/detail data.
2. Work management: jobs, queue items, retries, leases, cancellation, freshness.
3. Presentation: browser API plus UI.

The redesign in this document keeps the single-process / SQLite approach, but makes queue scope explicit, turns job execution into an actual scheduler, formalizes retry states, narrows the purpose of the viewstate cache, and splits the large server file into modules with clearer ownership.

## Problem Statement And Scope

The user request for this ticket was not to modify the other experiments and not to rewrite history from the earlier NEREVAL tickets. The task here is to review the current `nereval` scraper and application, explain it in enough detail for a new intern, identify correctness and design risks, and propose a more maintainable design.

This report covers:

- The current runtime architecture of the `nereval/` scraper and app.
- The scraper's queue, cache, retry, proxy, and restart behavior.
- Complexity and maintainability issues, including overgrown or deprecated code.
- A redesign that stays pragmatic for a single-process SQLite application.
- Implementation phases, test strategy, and operational guidance.

This report does not assume that the earlier design docs are authoritative. Those older docs were useful historical context, but every major claim here is anchored to the current source files.

## How To Read This As A New Intern

Start with the module map below, then read the runtime diagram, then read the findings section. The important mindset is that the code has two personalities at once:

- It is still an experiment in some modules.
- It is already a persistent application in others.

That mismatch explains most of the confusion in the current codebase.

## Current-State Architecture

### Module inventory

| Module | Purpose | Why it matters |
| --- | --- | --- |
| `nereval/fetch.js` | Remote HTTP access, proxy setup, retries, ASP.NET form POSTs | All crawling depends on its request semantics and its retry/backoff policy |
| `nereval/extract.js` | DOM parsing for list and detail pages | Defines the scraper's contract with the NEREVAL HTML |
| `nereval/db.js` | SQLite schema, migrations, queue helpers, config, jobs, cache | Central state layer for both scrape progress and stored data |
| `nereval/worker.js` | List crawl phase, detail phase, orchestration | Main scraper runtime behavior lives here |
| `nereval/run.js` | CLI entrypoint | Thin wrapper around `worker.js` and `db.js` |
| `nereval/app.mjs` | Combined API server, browser endpoints, scraper controls, inline UI | Main operational surface, and the largest source of current complexity |
| `nereval/browser.mjs` | Older read-only browser server | Mostly duplicated by `app.mjs`; still present and therefore still confusing |
| `nereval/REPORT.md` | Historical narrative of the original scraper | Good orientation, but no longer complete relative to the current app |

### Runtime flow

Observed runtime composition:

```text
CLI path:
  run.js
    -> openDb()
    -> createJob()
    -> runScrapeJob()

Server path:
  app.mjs
    -> openDb()
    -> recoverJobs()
    -> resetInProgressDetails()
    -> POST /api/jobs/start
       -> createJob()
       -> startJob()
       -> runScrapeJob()
    -> GET /api/jobs/:id/stream
       -> EventSource / SSE updates

Shared scraper path:
  worker.js
    -> runListCrawl()
       -> fetchListPage() / fetchNextPage()
       -> getFormState()
       -> extractListRows()
       -> upsertProperty()
       -> enqueueDetail()
       -> saveViewstate()
    -> runDetailFetch()
       -> claimNextDetail()
       -> fetchDetailPage()
       -> extractDetail()
       -> storeDetail()
       -> markDetailDone() / markDetailFailed()
```

### Current module responsibilities with evidence

`nereval/fetch.js`

- The request layer sets desktop browser headers and supports proxy configuration through `setProxy()` using `https-proxy-agent` loaded via dynamic import (`nereval/fetch.js:14-49`).
- `fetchWithRetry()` retries `403`, `429`, `500`, `502`, `503`, `504`, and `529` with exponential backoff up to 7 retries by default (`nereval/fetch.js:64-99`).
- List pagination depends on sending `__VIEWSTATE`, `__EVENTVALIDATION`, `__EVENTTARGET`, and `__EVENTARGUMENT` in a POST (`nereval/fetch.js:160-176`).

`nereval/extract.js`

- The list parser assumes one main grid `#PropertyList_GridView1`, filters down to rows with at least 4 `<td>` cells, extracts detail URL, map/lot, owner, location, and account number, and deduplicates by `accountNumber + owner` (`nereval/extract.js:26-57`).
- The detail parser uses repeated table-shape assumptions, including pairwise label/value cells and header-row tables for prior assessments, sales, and sub-areas (`nereval/extract.js:63-151`).

`nereval/db.js`

- `openDb()` enables WAL and foreign keys, creates tables, then runs migrations (`nereval/db.js:7-14`).
- The schema mixes canonical property tables with app state tables (`jobs`, `config`, `detail_queue`, `viewstates`) in one database (`nereval/db.js:33-181`).
- `detail_queue` is unique on `account_number`, stores `town`, `location`, `job_id`, `attempts`, status, timestamps, and error state, but has no composite index or uniqueness on `(job_id, account_number)` (`nereval/db.js:154-169`).
- `viewstates` caches ASP.NET form state by `(town, page_number)` (`nereval/db.js:171-180`).
- Queue helper methods claim work globally, not by town or job (`nereval/db.js:383-459`).

`nereval/worker.js`

- The list phase optionally fast-forwards using cached viewstate for `start_page - 1` and otherwise crawls sequentially from page 1 while saving new viewstates (`nereval/worker.js:35-145`).
- The detail phase creates a global rate limiter, starts `job.workers` parallel loops, repeatedly claims the next queue item, fetches details, stores them, and marks the item done or failed (`nereval/worker.js:149-231`).
- The combined job runner sets proxy state, marks the job running, executes phases based on `mode`, then marks the job completed/failed/cancelled (`nereval/worker.js:235-343`).

`nereval/app.mjs`

- On startup it marks `running` jobs as failed and resets `in_progress` queue items to `pending` (`nereval/app.mjs:39-45`).
- It exposes job control APIs, queue APIs, config APIs, viewstate APIs, and all read-only browser APIs in one file (`nereval/app.mjs:56-602`).
- It also serves a single inline HTML document containing all CSS and client-side JavaScript (`nereval/app.mjs:613-1517`).

`nereval/browser.mjs`

- This older file still contains a read-only property browser with overlapping SQL and inline UI logic (`nereval/browser.mjs:1-240` and remaining file).
- `app.mjs` explicitly labels its read-side routes as "Data Browsing API (from browser.mjs)" (`nereval/app.mjs:332`), which confirms that duplication is historical debt rather than an intentional layered design.

### Data model

Current tables fall into three groups.

Canonical property data:

- `properties`
- `owners`
- `assessments`
- `prior_assessments`
- `buildings`
- `sales`
- `sub_areas`
- `land`
- `mailing_addresses`

Operational state:

- `jobs`
- `detail_queue`
- `config`
- `viewstates`

Supporting migrations:

- `migrate()` currently adds `detail_queue.location` and `jobs.mode`, then backfills queue locations from `properties` (`nereval/db.js:16-31`).

Observed schema strengths:

- A single SQLite database is pragmatic here. The application is single-process, write volume is modest, WAL is appropriate, and better-sqlite3 keeps the code simple (`nereval/db.js:7-14`).
- Canonical property tables are normalized enough for useful downstream queries.
- Queue and viewstate persistence make resume behavior possible.

Observed schema weaknesses:

- There is only one explicit secondary index: `idx_detail_queue_status` (`nereval/db.js:169`).
- Search-heavy read APIs in `browser.mjs` / `app.mjs` rely on table scans, joins, and string parsing that will degrade sharply on very large datasets.
- Numerical values such as `parcel_total` and `above_grade_area` are stored as strings and converted on every query.
- Queue semantics are not modeled strongly enough to distinguish "global backlog", "job-local work", and "freshness cache".

### Current list/detail sequence

```text
List crawl:
  1. Optionally read cached viewstate for page start_page - 1
  2. If cache hit, POST forward one page
  3. Otherwise GET first page
  4. Save current page's viewstate
  5. Extract list rows
  6. Upsert property + owners
  7. INSERT OR IGNORE detail_queue row
  8. Repeat until end_page or no next page

Detail fetch:
  1. Compute queue stats from all queue rows
  2. Start N workers
  3. Each worker claims the next pending row from detail_queue
  4. Rate limiter gates the request
  5. Fetch detail page, extract tables, store normalized detail rows
  6. Mark queue item done or failed
```

### Current API reference

Scraper control and job APIs in `nereval/app.mjs`:

| Method | Route | Current behavior |
| --- | --- | --- |
| `POST` | `/api/jobs/start` | Creates a job immediately and starts it unless another job is already `running` (`nereval/app.mjs:57-88`) |
| `GET` | `/api/jobs` | Returns recent jobs (`nereval/app.mjs:91-94`) |
| `GET` | `/api/jobs/:id` | Returns one job (`nereval/app.mjs:97-101`) |
| `POST` | `/api/jobs/:id/stop` | Aborts the active in-memory job or marks a queued job cancelled (`nereval/app.mjs:103-119`) |
| `POST` | `/api/jobs/:id/retry` | Creates a new job copy, but only starts it immediately if nothing is currently running (`nereval/app.mjs:121-144`) |
| `GET` | `/api/jobs/:id/stream` | SSE channel for status/page/detail/error/done events (`nereval/app.mjs:146-178`) |

Queue and cache APIs:

| Method | Route | Current behavior |
| --- | --- | --- |
| `GET` | `/api/queue/stats` | Returns global queue counts (`nereval/app.mjs:296-298`) |
| `GET` | `/api/queue` | Returns global queue rows, optionally search/filter (`nereval/app.mjs:300-306`) |
| `POST` | `/api/queue/retry-failed` | Re-pends failed items with attempts below threshold (`nereval/app.mjs:308-312`) |
| `POST` | `/api/queue/clear-done` | Deletes done items from the queue (`nereval/app.mjs:314-317`) |
| `GET` | `/api/viewstates` | Lists cached viewstates by town (`nereval/app.mjs:321-324`) |
| `POST` | `/api/viewstates/clear` | Clears cached viewstates for a town (`nereval/app.mjs:326-329`) |

Config APIs:

| Method | Route | Current behavior |
| --- | --- | --- |
| `GET` | `/api/config` | Returns raw config plus masked proxy field (`nereval/app.mjs:226-233`) |
| `PUT` | `/api/config` | Writes allowed config keys (`nereval/app.mjs:235-243`) |
| `POST` | `/api/config/proxy/test` | Tests proxy connectivity via `https://httpbin.org/ip` (`nereval/app.mjs:245-292`) |

## Code Review Findings

This section is the actual review. Findings are ordered by severity and operational impact.

### Finding 1: the detail queue is global, but jobs imply scoped work

Severity: high

The code stores `town` and `job_id` on each queue row (`nereval/db.js:155-168`), which strongly suggests queue items are meant to preserve where the work came from. But the claim path ignores both fields. `claimNextDetail()` simply selects the next row where `status = 'pending'` (`nereval/db.js:393-405`). `runDetailFetch()` then calls that global claim function for every worker (`nereval/worker.js:172-179`).

That means a "details only" job for town A can consume pending queue rows discovered during an earlier job for town B, or during a previous run with different intent. The UI also reinforces this ambiguity because `/api/queue/stats` and `/api/queue` are global rather than job-scoped (`nereval/app.mjs:296-306`).

The current implementation therefore behaves less like "each job processes its own queue" and more like "all jobs operate on one shared detail backlog". That can be a legitimate design, but if it is intentional the code and UI should say so. Right now it reads like a per-job queue while behaving like a global queue.

### Finding 2: the "job queue" is not actually scheduled

Severity: high

`POST /api/jobs/start` rejects new work when any job is already `running` (`nereval/app.mjs:57-62`). So the main user path is not queuing additional jobs.

`POST /api/jobs/:id/retry` does create a new `queued` job when another job is running (`nereval/app.mjs:130-143`). But there is no scheduler loop, no `runNextJob()`, and no logic in `emitter.on('done')` to automatically start the next queued job (`nereval/app.mjs:205-217`). Once the active job finishes, the queued retry stays queued forever unless something else manually starts it.

This is a correctness gap, not just naming imprecision. The database contains a `jobs` table with queued/running/completed-like status semantics (`nereval/db.js:124-146`), but the runtime still behaves as an imperative "start one job right now" controller.

### Finding 3: retrying a job drops the original mode

Severity: high

Jobs are created with a `mode` column in both the schema and the creation helper (`nereval/db.js:124-146`, `nereval/db.js:306-312`). `runScrapeJob()` uses `job.mode` to decide which phases to run (`nereval/worker.js:258-312`).

However, the retry endpoint recreates a job without passing `mode` (`nereval/app.mjs:130-139`). Because `createJob()` defaults `mode = 'full'`, retrying a `list_only` or `details_only` job silently changes behavior on the retry path (`nereval/db.js:306-310`).

For a scraper with a two-phase design, that is a real behavior regression.

### Finding 4: cancellation and failure are conflated in the detail worker

Severity: medium-high

In `runDetailFetch()`, once a worker has claimed a queue item and passed through the rate limiter, a cancellation request causes that item to be marked failed with the error `"Cancelled"` (`nereval/worker.js:180-185`). Failures increment `attempts` in `markDetailFailed()` (`nereval/db.js:413-416`).

This has three side effects:

- A user cancellation pollutes failure metrics.
- Cancellation consumes retry budget.
- Operators must distinguish "site/network failure" from "user intentionally stopped" by reading free-form text.

Cancellation should return leased work to a resumable state, not mutate it into a real scrape failure.

### Finding 5: queue metrics overstate what was actually queued or added

Severity: medium

`enqueueDetail()` uses `INSERT OR IGNORE` with `UNIQUE(account_number)` (`nereval/db.js:383-388`, `nereval/db.js:167`). In `runListCrawl()`, the local `enqueued` counter increments every time a row has a detail URL and account number, regardless of whether the insert actually changed the database (`nereval/worker.js:100-111`).

Likewise, when the full job finishes, `properties_added` is populated from `finalStats.done` (`nereval/worker.js:315-322`), which is actually the count of all queue items in global `done` status, not the number of newly inserted properties for this job.

This makes the progress UI and final job summaries harder to trust. A new engineer will read "queued" and "properties added" as job-local truth even though the values are global-ish and partially cumulative.

### Finding 6: viewstate freshness semantics are inconsistent

Severity: medium

`getViewstate()` accepts cached state up to 2,880 minutes old by default, which is 48 hours (`nereval/db.js:474-480`). The UI, however, labels cached pages as "fresh" only if they are younger than 15 minutes (`nereval/app.mjs:1409-1415`).

This means the operator sees one freshness model while the scraper uses another. A 30-minute-old or 12-hour-old cache entry may appear stale to the user but still be actively used to skip crawl pages. For an ASP.NET/WebForms site whose hidden form state can change with deployment or server behavior, that mismatch should be a conscious design decision, not an accident.

### Finding 7: the main application has grown into a monolith and retains a deprecated twin

Severity: medium

`nereval/app.mjs` is 1,517 lines long and contains:

- process argument parsing,
- database bootstrap,
- crash recovery,
- job control APIs,
- queue APIs,
- config APIs,
- read-only data APIs,
- the entire HTML page,
- CSS,
- all client-side JavaScript (`nereval/app.mjs:1-1517`).

At the same time, `nereval/browser.mjs` still exists as a separate 565-line read-only server with overlapping query logic (`nereval/browser.mjs:1-240` and remaining file).

That duplication is dangerous because:

- bug fixes can land in one read path but not the other,
- an intern cannot tell which server is canonical without reading both files,
- there is no module boundary between server logic and UI logic.

### Finding 8: query scalability is under-modeled for large datasets

Severity: medium

The user explicitly asked for attention to scale. The current design is safe for moderate usage, but it is not prepared for "queue tables and property tables may grow to 1M rows".

Evidence:

- There is only one explicit non-unique secondary index: `idx_detail_queue_status` (`nereval/db.js:169`).
- Search and dashboard queries repeatedly parse string-valued money and area columns with `REPLACE()` + `CAST()` (`nereval/app.mjs:334-360`, `nereval/browser.mjs:113-161`).
- Search over addresses and owners uses `LIKE` against joined/aggregated text (`nereval/browser.mjs:96-159`).
- Top-landlord queries group by `owner_name` without a dedicated owner-name index (`nereval/browser.mjs:64-83`).

The current model is acceptable for experimentation. It is not yet shaped for predictable latency at larger scale.

### Finding 9: configuration handling exposes more than the UI actually needs

Severity: medium-low

`GET /api/config` returns raw `cfg.proxy_url` and also adds `cfg.proxy_url_masked` (`nereval/app.mjs:226-233`). The settings dialog then reads the raw value back into the browser (`nereval/app.mjs:1449-1456`).

If this service is ever exposed beyond a trusted local environment, proxy credentials are now part of the browser-delivered payload. Even for localhost-only usage, this is a questionable default because there is no privilege separation between "can use proxy" and "can read proxy secret".

### Finding 10: there is no automated test harness in the repository

Severity: medium-low

`package.json` still has `"test": "echo \"Error: no test specified\" && exit 1"` (`package.json:6-8`). The queue, cache, retry, parser, and API behavior all rely on manual verification or historical notes rather than executable tests.

Given that queue correctness and retry semantics are now core product behavior, this is a real maintenance risk.

### Finding 11: legacy compatibility fields and imports make the mental model noisier

Severity: low

There are several small signs of in-progress evolution:

- `jobs.no_details` still exists even though `mode` is the clearer phase-control concept (`nereval/db.js:124-146`, `nereval/worker.js:285-311`).
- `run.js` still imports `setProxy` even though proxy configuration is now delegated through `runScrapeJob()` (`nereval/run.js:6`, `nereval/run.js:68-94`).
- `browser.mjs` remains present even though `app.mjs` absorbed it.

These are not severe bugs, but they add friction for onboarding and make the code feel more deprecated than it needs to.

## Proposed Design

### Design goals

The redesign should optimize for these properties:

1. Correctness over cleverness.
2. One-process deployability.
3. Explicit queue semantics.
4. Predictable restart and cancellation behavior.
5. Clear enough structure that an intern can trace a request without opening a 1,500-line file.
6. Good-enough performance for a materially larger dataset.

### Recommended architecture

Keep SQLite and a single Node process. Do not over-engineer this into Redis plus workers plus a frontend build unless usage proves that necessary.

Recommended top-level split:

```text
nereval/
  app/
    server.mjs              # express bootstrap only
    routes/jobs.mjs         # job APIs + SSE
    routes/queue.mjs        # queue/viewstate APIs
    routes/data.mjs         # property browser APIs
    routes/config.mjs       # config APIs
    scheduler.mjs           # start next queued job
    sse.mjs                 # client registry + publish helpers
  scraper/
    fetch.js                # request/proxy/backoff
    extract.js              # DOM parsing contracts
    list-worker.js          # list crawl phase
    detail-worker.js        # detail phase
    runtime.js              # runScrapeJob
  store/
    db.js                   # connection/bootstrap
    property-store.js       # canonical property writes
    queue-store.js          # jobs, queue, leases, retries
    query-store.js          # read-model SQL for browser
  public/
    index.html
    app.js
    app.css
```

This is still a small system. The goal is not "microservices". The goal is "clear ownership and fewer accidental couplings".

### Key design decision: separate work management from canonical property storage

Right now `detail_queue` acts as both:

- a persistent work queue,
- a dedupe mechanism,
- an implicit "already fetched once" cache.

That overloading is the root of several confusing behaviors. The redesign should make these concepts explicit.

Recommended meaning of each table:

- `properties`: canonical property identity discovered from list pages.
- `property_details`: canonical detail freshness and extracted normalized detail data.
- `jobs`: user- or system-requested scrape runs.
- `job_items`: rows of work leased to a particular job.
- `viewstate_cache`: cached ASP.NET pagination state, scoped by town and page.

If the current schema must be evolved in place rather than replaced, `detail_queue` can be upgraded into `job_items`, but the meaning should still change: one row should represent "this job needs this account processed", not "this account exists somewhere in the global backlog".

### Queue semantics

Recommended queue model:

- A job owns its work items.
- Claiming is always filtered by `job_id`.
- Claiming is ordered and lease-based.
- Cancellation returns leased items to `pending` or `cancelled`, not `failed`.
- Retry policy is stored explicitly rather than inferred from `last_error`.

Recommended status machine:

```text
pending
  -> leased
  -> done
  -> retry_wait
  -> failed_terminal
  -> cancelled
```

Recommended queue columns:

```sql
job_items (
  id                INTEGER PRIMARY KEY,
  job_id            INTEGER NOT NULL REFERENCES jobs(id),
  town              TEXT NOT NULL,
  account_number    TEXT NOT NULL,
  detail_url        TEXT NOT NULL,
  source_page       INTEGER,
  status            TEXT NOT NULL DEFAULT 'pending',
  lease_owner       TEXT,
  leased_at         TEXT,
  lease_expires_at  TEXT,
  attempts          INTEGER NOT NULL DEFAULT 0,
  next_attempt_at   TEXT,
  last_error_code   TEXT,
  last_error_msg    TEXT,
  completed_at      TEXT,
  UNIQUE(job_id, account_number)
);

CREATE INDEX idx_job_items_claim
  ON job_items(job_id, status, next_attempt_at, id);
CREATE INDEX idx_job_items_town_status
  ON job_items(town, status, id);
```

Why this is better:

- A single job can be reasoned about in isolation.
- Jobs for different towns do not cross-contaminate.
- Retry and cancel behavior are auditable.
- Order becomes deterministic.

### Job scheduling

The current `jobs` table is closer to a real queue than the runtime that uses it. Finish that transition.

Recommended scheduler behavior:

```text
POST /api/jobs/start
  -> create job with status = queued
  -> enqueue job items if needed
  -> ask scheduler to wake up

scheduler loop
  if no active job:
    select next queued job ordered by created_at, id
    mark it running
    run job
    on completion:
      mark complete/failed/cancelled
      immediately look for next queued job
```

Pseudocode:

```js
async function maybeRunNextJob() {
  if (activeJob) return;

  const next = queueStore.claimNextQueuedJob(db);
  if (!next) return;

  activeJob = next.id;
  publishJobEvent(next.id, "status", { status: "running" });

  try {
    await runtime.runJob(db, next, { publish: publishJobEvent });
    queueStore.finishJob(db, next.id, { status: "completed" });
  } catch (err) {
    if (err instanceof CancelError) {
      queueStore.finishJob(db, next.id, { status: "cancelled" });
    } else {
      queueStore.finishJob(db, next.id, { status: "failed", error: err.message });
    }
  } finally {
    activeJob = null;
    maybeRunNextJob();
  }
}
```

### Retry and backoff behavior

The current backoff is all inside `fetchWithRetry()` and is unaware of job-level context (`nereval/fetch.js:64-99`). That is acceptable for transient HTTP issues, but not sufficient for robust queue semantics.

Recommended split:

- Request-level retries: small, local, for obvious transient network issues.
- Queue-level retries: explicit item rescheduling after request-level retries are exhausted.
- Job-level circuit breaker: if repeated 403/429 events suggest blocking, pause the job rather than grinding through the entire queue.

Suggested classification:

| Error class | Example | Immediate action | Queue action |
| --- | --- | --- | --- |
| network transient | timeout, reset, proxy tunnel hiccup | retry request a few times | reschedule item with backoff |
| server transient | `429`, `502`, `503`, `504`, maybe `403` depending on proxy mode | retry request a few times | if repeated, move to `retry_wait` |
| parse drift | missing expected table, DOM shape changed | do not spin for many minutes | mark item failed_terminal or pause whole job |
| operator cancel | user stop button | stop requesting | release leased items, do not increment failure budget |

Suggested queue-level pseudocode:

```js
try {
  const detail = await fetchAndExtract(item);
  storeDetailTx(db, item.account_number, detail);
  markItemDone(db, item.id);
} catch (err) {
  const kind = classify(err);

  if (kind === "cancelled") {
    releaseLease(db, item.id);
    throw err;
  }

  if (kind === "parse_drift") {
    markItemTerminalFailure(db, item.id, err);
    maybePauseJob(db, job.id, "Parser assumptions no longer match site");
    return;
  }

  rescheduleItem(db, item.id, backoffFor(item.attempts + 1), err);
}
```

### Viewstate cache behavior

The current cache is directionally correct but underspecified. It should be treated as a bounded optimization, not as a silent source of truth.

Recommended rules:

1. Only use cached viewstate for skip-ahead when it is within an explicit operator-facing TTL.
2. Store `source_job_id` and maybe `fetched_with_proxy` for debugging.
3. If a cached jump fails validation, invalidate it immediately and fall back to sequential crawl.
4. Surface cache hits and fallbacks clearly in job history.

Suggested schema refinement:

```sql
viewstate_cache (
  town              TEXT NOT NULL,
  page_number       INTEGER NOT NULL,
  view_state        TEXT NOT NULL,
  event_validation  TEXT NOT NULL,
  fetched_at        TEXT NOT NULL,
  source_job_id     INTEGER,
  PRIMARY KEY (town, page_number)
);
```

### Read model and scalability

For the browser side, the main opportunity is not "introduce Elasticsearch". It is:

1. Stop converting numeric strings on every query.
2. Add the indexes the existing queries already imply.
3. Separate scraper-write tables from browser-read queries.

Recommended incremental improvements:

- Add numeric companion columns such as `parcel_total_num` and `above_grade_area_num`.
- Backfill them once and update them during writes.
- Add indexes:
  - `properties(location)`
  - `owners(owner_name)`
  - `assessments(parcel_total_num)`
  - `buildings(design, year_built)`
  - `job_items(job_id, status, next_attempt_at, id)`
  - `viewstate_cache(town, page_number)`

That preserves SQLite and simplifies the SQL.

### UI/server separation

The current inline HTML page was a reasonable bootstrap choice. It is now too large.

Recommended split:

- Keep the current UI behavior.
- Move HTML/CSS/JS into `public/`.
- Serve static assets from Express.
- Keep SSE; it is appropriate for one-way progress streams.
- Remove `browser.mjs` once `app.mjs` routes are decomposed and parity is confirmed.

That change alone will reduce the cognitive load of onboarding.

## Proposed API Adjustments

### Current-to-target API comparison

| Concern | Current | Target |
| --- | --- | --- |
| start job | `POST /api/jobs/start` starts immediately | `POST /api/jobs` creates queued job; scheduler decides when to run |
| retry job | recreates a new job but may orphan it and drops `mode` | `POST /api/jobs/:id/retry` clones all execution fields, preserves mode, and schedules automatically |
| queue stats | global queue | `/api/jobs/:id/items/stats` and optional `/api/queue?town=` global backlog views |
| claim semantics | implicit, hidden in DB helper | explicit job-scoped lease semantics |
| config exposure | returns raw proxy secret | returns masked secret by default; separate update endpoint accepts new secret |
| viewstate cache | operator sees one freshness threshold, worker uses another | one explicit TTL surfaced consistently in API and UI |

### Suggested API contracts

Create job:

```json
POST /api/jobs
{
  "town": "Providence",
  "startPage": 1,
  "endPage": "all",
  "workers": 2,
  "rps": 1.5,
  "useProxy": true,
  "mode": "full"
}
```

Response:

```json
{
  "job_id": 42,
  "status": "queued"
}
```

Per-job queue stats:

```json
GET /api/jobs/42/items/stats
{
  "pending": 120,
  "leased": 2,
  "retry_wait": 4,
  "failed_terminal": 1,
  "done": 85,
  "total": 212
}
```

Pause due to block / repeated retry failure:

```json
event: status
data: {
  "status": "paused",
  "reason": "repeated_403",
  "message": "Job paused after repeated 403 responses. Check proxy configuration."
}
```

## Implementation Plan

### Phase 1: fix correctness before deeper refactor

Goal: eliminate behavior bugs without changing the whole shape of the app.

1. Preserve `mode` on retry.
2. Introduce a real job scheduler that automatically starts the next queued job.
3. Scope detail claiming by `job_id` or by explicit backlog mode.
4. Make cancellation release claimed items instead of marking them failed.
5. Correct queue/job metrics so UI numbers match database changes.

Files most affected:

- `nereval/app.mjs`
- `nereval/db.js`
- `nereval/worker.js`

### Phase 2: formalize queue and retry semantics

Goal: make queue behavior understandable and restart-safe.

1. Replace `detail_queue` semantics with job-scoped work items.
2. Add explicit retry scheduling fields.
3. Add deterministic claim ordering.
4. Add lease expiration / recovery logic.
5. Update queue APIs to operate per job and optionally by town.

Files most affected:

- `nereval/db.js` or new `store/queue-store.js`
- `nereval/worker.js` or split runtime modules
- `nereval/app.mjs` job and queue endpoints

### Phase 3: split the monolith

Goal: reduce onboarding cost and accidental duplication.

1. Extract read-only browser queries from `app.mjs`.
2. Move inline HTML/CSS/JS into `public/`.
3. Delete or hard-deprecate `browser.mjs`.
4. Create small route modules with explicit ownership.

Files most affected:

- `nereval/app.mjs`
- `nereval/browser.mjs`
- new `nereval/app/*` or equivalent

### Phase 4: performance and observability

Goal: prepare for larger datasets and longer-running operations.

1. Add numeric helper columns and indexes.
2. Add job and item history views.
3. Add structured logging for queue transitions and cache hits.
4. Add browser-side drilldowns for per-job failures and cache use.

Files most affected:

- `nereval/db.js`
- read-model query files
- job history UI

## Testing And Validation Strategy

The current repository has no usable automated test suite (`package.json:6-8`). That should change before a large refactor.

Recommended test layers:

### 1. Parser fixtures

Use saved HTML fixtures for:

- first list page,
- paginated list page,
- detail page with typical data,
- detail page with missing sections,
- layout drift examples if available.

Assertions:

- `extractListRows()` returns expected accounts and owners.
- `extractDetail()` returns stable field mappings.
- DOM drift yields explicit parse failures rather than silent data loss.

### 2. Queue/store tests

Use temporary SQLite databases.

Assertions:

- job creation and scheduler pickup order,
- claim semantics are scoped by job,
- cancellation releases leased items,
- retry backoff updates `next_attempt_at`,
- crash recovery resets only leased items that expired or were active.

### 3. Worker integration tests

Mock `fetchListPage`, `fetchNextPage`, and `fetchDetailPage`.

Assertions:

- list crawl writes expected property rows and queue rows,
- details phase drains only job-local items,
- viewstate cache hit/fallback behavior is correct,
- retry classification pauses or reschedules as intended.

### 4. API tests

Assertions:

- retry preserves mode,
- queued jobs start automatically after current job ends,
- config endpoints do not leak secrets by default,
- per-job queue stats match store state.

### 5. Manual smoke checks

Recommended operator smoke sequence:

1. Run a list-only scrape.
2. Confirm queue rows are created only for that job/town.
3. Run details-only on the same job.
4. Cancel mid-run.
5. Confirm claimed work returns to resumable state.
6. Retry.
7. Restart the server.
8. Confirm recovery behavior is deterministic.

## Risks, Tradeoffs, And Alternatives

### Why not keep the current global queue?

Alternative: make the global queue explicit and document that jobs are only "queue feeders" or "queue drainers".

This could work, but then the API and UI should stop pretending that queue state is job-local. You would need:

- global backlog terminology everywhere,
- town filters,
- freshness rules for when a previously done account should re-enter backlog,
- different job metrics.

That is a valid design, but it is a different product than the current code is implying. I recommend job-scoped work items because it matches the existing mental model better and produces fewer surprises.

### Why not move to Redis / Postgres now?

Not necessary yet. SQLite with WAL is still the right default here because:

- there is one process,
- writes are bounded,
- state is local and inspectable,
- deployment stays simple.

Move off SQLite only if actual concurrency or remote multi-worker deployment requires it.

### Main tradeoff in the proposed redesign

The redesign introduces more explicit state. That means:

- a few more columns,
- more queue-state code,
- more tests.

That is worthwhile because the current pain is not "too much code". It is "not enough explicit contract".

## Open Questions

1. Should the system model job-scoped queue items only, or should it intentionally support a cross-job global backlog view as a secondary feature?
2. What is the intended freshness policy for detail pages? Is "fetched once" enough, or do we want periodic refresh by town or by age?
3. What TTL is actually safe for viewstate reuse against this specific ASP.NET deployment?
4. Is the service assumed to be localhost-only, or should proxy credentials and other operator controls be treated as multi-user sensitive?
5. Do we want the browser application to remain server-rendered / static-file simple, or should it graduate to a separate frontend package later?

## References

Primary source files reviewed:

- `package.json:1-18`
- `nereval/fetch.js:1-207`
- `nereval/extract.js:1-154`
- `nereval/db.js:1-502`
- `nereval/worker.js:1-343`
- `nereval/run.js:1-140`
- `nereval/app.mjs:1-1517`
- `nereval/browser.mjs:1-565`
- `nereval/REPORT.md:1-181`

Historical doc context consulted, but not treated as source of truth:

- `ttmp/2026/03/22/NEREVAL-APP--nereval-property-scraper-web-application-with-job-queue-and-proxy-support/design-doc/01-architecture-and-implementation-guide.md`
- `ttmp/2026/03/22/NEREVAL-QUEUE--detail-queue-and-viewstate-cache-for-resumable-scraping/design-doc/01-implementation-plan-detail-queue-and-viewstate-cache.md`
