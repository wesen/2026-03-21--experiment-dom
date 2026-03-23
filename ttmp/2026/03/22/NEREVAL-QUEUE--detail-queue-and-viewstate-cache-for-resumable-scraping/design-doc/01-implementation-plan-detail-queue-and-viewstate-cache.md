---
Title: "Implementation Plan: Detail Queue and Viewstate Cache"
Ticket: NEREVAL-QUEUE
Status: active
Topics:
    - nereval
    - scraping
    - sqlite
    - queue
DocType: design-doc
Intent: long-term
Owners: []
RelatedFiles:
    - Path: nereval/db.js
      Note: "Schema changes: add detail_queue and viewstates tables, CRUD helpers"
    - Path: nereval/worker.js
      Note: "Refactor: split into list crawler + detail fetcher, read/write queue"
    - Path: nereval/app.mjs
      Note: "New API endpoints for queue status, manual queue operations"
    - Path: nereval/fetch.js
      Note: "No changes expected"
    - Path: nereval/extract.js
      Note: "No changes expected"
    - Path: nereval/run.js
      Note: "Update to use new queue-based flow (or deprecate in favor of app.mjs)"
ExternalSources:
    - URI: https://data.nereval.com
      Note: "ASP.NET WebForms with __VIEWSTATE pagination"
Summary: "Detailed implementation plan for adding a detail_queue table (resumable detail fetching) and viewstates table (page position caching) to the nereval scraper, with worker.js refactoring to decouple phase 1 and phase 2."
LastUpdated: 2026-03-22
WhatFor: "Step-by-step implementation guide"
WhenToUse: "When implementing the queue and viewstate features"
---

# Implementation Plan: Detail Queue and Viewstate Cache

## Executive Summary

The nereval scraper currently runs phase 1 (list crawl) and phase 2 (detail fetch) as a single monolithic operation inside `worker.js`. If a job is interrupted during phase 2, all progress on individual detail pages is lost — the entire job must be restarted. Phase 1 must also always start from page 1 because viewstates are held only in memory.

This plan adds two SQLite tables — `detail_queue` and `viewstates` — that make both phases independently resumable. It also refactors `worker.js` to decouple the phases so they can run separately, and so detail workers can pull from a persistent queue rather than an in-memory list.

## Problem Statement

### Three problems with the current design

**1. Detail fetch progress is lost on interruption.** Phase 2 builds its work list in memory from phase 1 results. If the job fails at detail 40/100, there's no record of which 40 succeeded. Retrying the job re-fetches all 100 detail pages (wasting time and proxy bandwidth).

**2. Phase 1 must start from page 1 every time.** ASP.NET viewstate pagination is sequential — you need the viewstate from page N to fetch page N+1. We currently hold viewstates in memory only, so a new job must fast-forward through all earlier pages even if we've already crawled them.

**3. Phase 1 and Phase 2 are tightly coupled.** They run in sequence inside a single `runScrapeJob()` call. You can't run "just phase 1" to discover properties and then "just phase 2" to fetch details — for example, to list-crawl 100 pages overnight and detail-fetch the next day.

## Proposed Solution

### New tables

#### `detail_queue` — persistent work queue for detail fetches

```sql
CREATE TABLE IF NOT EXISTS detail_queue (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    account_number  TEXT NOT NULL,
    detail_url      TEXT NOT NULL,
    town            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    -- status: pending | in_progress | done | failed
    job_id          INTEGER,          -- which job discovered this property
    attempts        INTEGER DEFAULT 0,
    last_error      TEXT,
    last_attempt_at TEXT,
    completed_at    TEXT,
    UNIQUE(account_number)            -- one queue entry per property
);

CREATE INDEX IF NOT EXISTS idx_detail_queue_status ON detail_queue(status);
```

Key design choices:
- **UNIQUE on account_number** — if the same property is discovered by multiple list crawls, it doesn't get queued twice
- **`in_progress` status** — claimed by a worker, prevents double-fetching. On crash recovery, `in_progress` entries are reset to `pending`
- **`attempts` counter** — enables retry policies (e.g., skip after 3 failures)
- **`job_id`** — tracks which job discovered the property, for auditing

#### `viewstates` — cached ASP.NET form state per page

```sql
CREATE TABLE IF NOT EXISTS viewstates (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    town            TEXT NOT NULL,
    page_number     INTEGER NOT NULL,
    view_state      TEXT NOT NULL,     -- __VIEWSTATE value (~5.5KB)
    event_validation TEXT NOT NULL,    -- __EVENTVALIDATION value
    fetched_at      TEXT DEFAULT (datetime('now')),
    UNIQUE(town, page_number)
);
```

Key design choices:
- **UNIQUE on (town, page_number)** — one cached state per page per town
- **`fetched_at` timestamp** — viewstates expire server-side (ASP.NET session timeout, likely 20 minutes). Code should treat entries older than a threshold as stale
- **Upsert on save** — overwrite old viewstates when re-crawling

### How it works

#### Phase 1: List crawl populates detail_queue

```
Page 1 → extract rows → upsert properties → INSERT OR IGNORE into detail_queue
        → save viewstate for page 1
Page 2 → extract rows → upsert properties → INSERT OR IGNORE into detail_queue
        → save viewstate for page 2
...
```

After phase 1, the `detail_queue` table has one `pending` entry per unique property with a `detail_url`. Properties already fetched in previous jobs (status=`done`) are left alone thanks to `INSERT OR IGNORE` on the unique constraint.

#### Phase 1 resume via viewstate cache

When starting a list crawl at page N:
1. Check `viewstates` table for town + page (N-1)
2. If found and fresh (< 15 minutes old): use cached viewstate to fetch page N directly
3. If stale or missing: fast-forward from page 1 as before, but save each viewstate along the way

This makes viewstate caching **opportunistic** — it helps when doing consecutive crawls in the same session, but degrades gracefully to the existing fast-forward behavior when viewstates have expired.

#### Phase 2: Detail fetch pulls from detail_queue

```
Worker loop:
  1. UPDATE detail_queue SET status='in_progress', last_attempt_at=now()
     WHERE id = (SELECT id FROM detail_queue WHERE status='pending' LIMIT 1)
     RETURNING *
  2. Fetch detail page, extract, store
  3. UPDATE detail_queue SET status='done', completed_at=now() WHERE id=?
  On error:
  3. UPDATE detail_queue SET status='failed', attempts=attempts+1, last_error=?
     WHERE id=?
```

This is a classic SQLite work queue pattern. The `UPDATE ... WHERE id = (SELECT ... LIMIT 1) RETURNING *` atomically claims a work item. Multiple workers can safely pull from the same queue.

Note: better-sqlite3 doesn't support RETURNING. Instead use a transaction:

```javascript
const claim = db.transaction(() => {
  const item = db.prepare(
    "SELECT * FROM detail_queue WHERE status = 'pending' LIMIT 1"
  ).get();
  if (!item) return null;
  db.prepare(
    "UPDATE detail_queue SET status = 'in_progress', last_attempt_at = datetime('now') WHERE id = ?"
  ).run(item.id);
  return item;
});
```

This is safe because better-sqlite3 is synchronous and single-threaded — the transaction is atomic.

#### Resume after interruption

On crash/restart:
1. `recoverJobs()` already marks `running` jobs as `failed`
2. New: reset `in_progress` queue items back to `pending` (the worker that claimed them is gone)
3. Start a new "detail-only" job that pulls from the existing queue — no phase 1 needed

## Design Decisions

### 1. Single queue table, not per-job

**Decision:** One `detail_queue` table shared across all jobs.

**Why:** Properties are global — the same property shouldn't be detail-fetched twice just because two different jobs discovered it. The queue is a property-level concept, not a job-level concept.

**Trade-off:** Can't easily see "which properties did job #7 discover?" without the `job_id` column (which we include for this reason).

### 2. Viewstate cache is opportunistic, not required

**Decision:** Viewstate cache is a performance optimization, not a correctness requirement. If the cache misses, we fall back to fast-forward.

**Why:** ASP.NET sessions expire. We can't guarantee viewstates will be valid. Building the system around required viewstate caching would make it fragile. Treating it as a warm cache that sometimes helps is much simpler.

**Expiry policy:** 15 minutes. Configurable but conservative — ASP.NET default session timeout is 20 minutes.

### 3. Phase 2 becomes independent of phase 1

**Decision:** Phase 2 workers pull from `detail_queue` regardless of how items got there. They don't need a phase 1 to run first.

**Why:** This enables several workflows:
- Run list-only crawl, review discovered properties, then start detail fetch
- Detail fetch dies at 50% — restart just phase 2, it picks up where it left off
- Run multiple list crawls for different page ranges, then batch detail-fetch everything

### 4. `INSERT OR IGNORE` for queue deduplication

**Decision:** When phase 1 discovers a property, it does `INSERT OR IGNORE INTO detail_queue`. If the property is already in the queue (from a previous job), the insert is silently skipped.

**Why:** This means re-crawling the same list pages doesn't create duplicate work. A property that's already `done` stays `done`. A property that's `pending` stays `pending`. Only genuinely new properties get added.

### 5. Retry with attempt tracking

**Decision:** Failed queue items stay in the queue with `status='failed'` and `attempts` incremented. A separate "retry failed" operation can reset them to `pending`.

**Why:** Some failures are transient (403, timeout) and worth retrying. Others are permanent (malformed HTML, missing detail page). The `attempts` counter and `last_error` let the UI show what's failing and let the user decide whether to retry.

## Alternatives Considered

### A. Store work list in the jobs table as JSON

Could add a `work_items JSON` column to jobs. Rejected because: duplicates data already in `properties`, doesn't survive schema changes, can't be queried with SQL, doesn't support cross-job sharing.

### B. Use properties table itself as the queue

Add `detail_status` column to `properties`. Rejected because: mixes property data with queue state, makes the properties table wider, and the property may exist (from a list crawl) before we decide whether to queue it for detail fetching. A separate queue table is cleaner.

### C. External job queue (Redis, BullMQ)

Rejected because: adds operational complexity for a single-user tool. SQLite is already our storage layer and handles concurrent reads + single writer perfectly.

## Implementation Plan

### Step 1: Add tables and CRUD to db.js

**Files changed:** `nereval/db.js`

Add `CREATE TABLE` statements for `detail_queue` and `viewstates` inside `createTables()`.

New functions:

```javascript
// detail_queue
enqueueDetail(db, { accountNumber, detailUrl, town, jobId })
claimNextDetail(db)              // atomic claim via transaction, returns row or null
markDetailDone(db, id)
markDetailFailed(db, id, error)
resetInProgressDetails(db)       // crash recovery
getQueueStats(db)                // { pending, in_progress, done, failed, total }
getQueueItems(db, { status, limit, offset })
retryFailedDetails(db, { maxAttempts })  // reset failed→pending where attempts < max

// viewstates
saveViewstate(db, { town, pageNumber, viewState, eventValidation })
getViewstate(db, town, pageNumber, maxAgeMinutes)  // returns null if stale
clearViewstates(db, town)        // clear all for a town (e.g., on error)
```

### Step 2: Refactor worker.js into two functions

**Files changed:** `nereval/worker.js`

Split `runScrapeJob()` into:

```javascript
// Phase 1: List crawl only — discovers properties, populates queue
runListCrawl(db, job, opts)
// Returns: { emitter, promise }
// Events: status, page, done
// Writes to: properties, owners, detail_queue, viewstates

// Phase 2: Detail fetch only — pulls from queue
runDetailFetch(db, job, opts)
// Returns: { emitter, promise }
// Events: status, detail, error, done
// Reads from: detail_queue
// Writes to: assessments, buildings, sales, etc. + updates detail_queue status

// Combined: runs both phases (backwards-compatible)
runScrapeJob(db, job, opts)
// Calls runListCrawl, then runDetailFetch
```

**Phase 1 changes:**
- After extracting rows and upserting properties, also `enqueueDetail()` for each property with a detail URL
- After fetching each page, `saveViewstate()` with the form state
- Before starting, check `getViewstate()` for the start page — skip fast-forward if fresh cache hit

**Phase 2 changes:**
- Instead of building work list from phase 1 results, pull from `detail_queue` via `claimNextDetail()`
- Worker loop becomes: claim → fetch → store → markDone, or claim → error → markFailed
- Progress tracking: `getQueueStats()` for totals, individual events for per-property progress
- Job's `details_total` set from queue stats at start, not from phase 1 count

### Step 3: Update job model

**Files changed:** `nereval/db.js`, `nereval/app.mjs`

Add a `mode` column to jobs table:

```sql
-- In createTables, jobs table gets:
    mode TEXT NOT NULL DEFAULT 'full'
    -- mode: full | list_only | details_only
```

- `full` — run phase 1 then phase 2 (current behavior)
- `list_only` — run phase 1 only, populate queue
- `details_only` — skip phase 1, run phase 2 from existing queue

The `POST /api/jobs/start` endpoint accepts `mode` in the body. UI form gets a dropdown.

### Step 4: Add queue API endpoints

**Files changed:** `nereval/app.mjs`

```
GET  /api/queue/stats         → { pending, in_progress, done, failed, total }
GET  /api/queue               → list queue items (with status filter, pagination)
POST /api/queue/retry-failed  → reset failed items to pending (optional maxAttempts param)
POST /api/queue/clear-done    → delete completed items to clean up the queue
```

### Step 5: Update crash recovery

**Files changed:** `nereval/db.js` (recoverJobs), `nereval/app.mjs` (startup)

On startup, in addition to marking stale `running` jobs as `failed`:
- Call `resetInProgressDetails(db)` — any `in_progress` queue items get reset to `pending`
- These were claimed by workers that no longer exist

### Step 6: Add queue UI to Scraper tab

**Files changed:** `nereval/app.mjs` (HTML)

Add a queue status section to the Scraper tab:

```
┌─ Detail Queue ────────────────────────────┐
│ Pending: 142   In Progress: 3   Done: 98  │
│ Failed: 4      Total: 247                 │
│                                           │
│ [Fetch Pending Details]  [Retry Failed]   │
│ [Clear Completed]                         │
└───────────────────────────────────────────┘
```

The "Fetch Pending Details" button starts a `details_only` job. "Retry Failed" calls `/api/queue/retry-failed`. Queue stats auto-refresh during active jobs.

Job form gets a mode dropdown:
```
Mode: [Full Scrape ▾]     ← full | List Only | Details Only
```

### Step 7: Update run.js CLI

**Files changed:** `nereval/run.js`

Add `--mode` flag: `full` (default), `list-only`, `details-only`.

- `list-only` mode: runs phase 1, populates queue, exits
- `details-only` mode: skips phase 1, fetches from queue
- `full` mode: current behavior, using the new queue internally

### Step 8: Viewstate cache display

**Files changed:** `nereval/app.mjs`

New endpoint and small UI display:

```
GET /api/viewstates?town=Providence → [{ page_number, fetched_at, age_minutes }]
```

Show in the Scraper tab below the job form — shows cached pages and their ages, so you know whether fast-forward will be skipped.

## File-by-File Change Summary

| File | Changes | Scope |
|------|---------|-------|
| `nereval/db.js` | Add 2 tables, ~12 new CRUD functions, add `mode` to jobs, update `recoverJobs()` | Medium |
| `nereval/worker.js` | Split `runScrapeJob` into `runListCrawl` + `runDetailFetch`, add queue reads/writes, add viewstate logic | Large (main refactor) |
| `nereval/app.mjs` | Add 4 queue endpoints, 1 viewstate endpoint, add mode to job start, add queue UI section | Medium |
| `nereval/run.js` | Add `--mode` flag, wire to new worker functions | Small |
| `nereval/fetch.js` | No changes | None |
| `nereval/extract.js` | No changes | None |

## Migration

The new tables use `CREATE TABLE IF NOT EXISTS`, so existing databases gain the tables on next `openDb()` call. The `mode` column on `jobs` needs to be added with `ALTER TABLE` for existing databases, or we just add it to the CREATE TABLE and rely on SQLite's forgiving column handling.

For existing properties that already have detail data, you can retroactively populate the queue:

```sql
-- Mark already-fetched properties as done in the queue
INSERT OR IGNORE INTO detail_queue (account_number, detail_url, town, status)
SELECT account_number, detail_url, town, 'done'
FROM properties
WHERE detail_url IS NOT NULL
AND account_number IN (SELECT account_number FROM assessments);

-- Queue properties that haven't been detail-fetched yet
INSERT OR IGNORE INTO detail_queue (account_number, detail_url, town, status)
SELECT account_number, detail_url, town, 'pending'
FROM properties
WHERE detail_url IS NOT NULL
AND account_number NOT IN (SELECT account_number FROM assessments);
```

## Open Questions

1. **Should we store the raw HTML of detail pages?** It's ~50KB per page. Storing it would allow re-extracting data without re-fetching, useful if we improve the extraction logic. But it balloons the database. Probably not worth it for now — can add a `detail_html` column later if needed.

2. **Should the viewstate expiry be configurable?** Hardcoded 15 minutes is probably fine. Could add it to the `config` table if it becomes an issue.

3. **Priority in the queue?** Currently FIFO. Could add a `priority` column for things like "fetch this specific property first" from the UI. Low priority for now.
