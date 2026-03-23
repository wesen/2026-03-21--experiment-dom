---
Title: Implementation Diary
Ticket: NEREVAL-QUEUE
Status: active
Topics:
    - nereval
    - scraping
    - sqlite
    - queue
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: nereval/db.js
      Note: "Added detail_queue + viewstates tables, 12 CRUD helpers, mode column"
    - Path: nereval/worker.js
      Note: "Split into runListCrawl + runDetailFetch + runScrapeJob orchestrator"
    - Path: nereval/app.mjs
      Note: "Queue/viewstate APIs, mode dropdown, queue status UI, crash recovery"
    - Path: nereval/run.js
      Note: "Rewritten to use worker.js with --mode flag"
ExternalSources: []
Summary: "Step-by-step implementation diary for the detail queue and viewstate cache feature."
LastUpdated: 2026-03-23
WhatFor: "Tracking decisions and issues during implementation"
WhenToUse: "When reviewing what was built and why"
---

# Implementation Diary

## Step 1: Add detail_queue and viewstates tables + CRUD helpers (Task #2)

**What I Did:**
- Added `detail_queue` table: account_number (unique), detail_url, town, status (pending/in_progress/done/failed), job_id, attempts, last_error, timestamps
- Added `viewstates` table: town + page_number (unique), view_state, event_validation, fetched_at
- 12 CRUD functions: enqueueDetail, claimNextDetail (atomic via transaction), markDetailDone/Failed, resetInProgressDetails, getQueueStats, getQueueItems, retryFailedDetails, clearDoneDetails, saveViewstate, getViewstate (with age check), listViewstates, clearViewstates
- Added `mode` column to jobs with auto-migration for existing DBs (`ALTER TABLE` in try/catch)
- Index on detail_queue(status) for efficient queue polling

**What Worked:** All CRUD tested against :memory: DB. claimNextDetail uses a transaction to atomically SELECT + UPDATE, safe because better-sqlite3 is synchronous.

**What I Learned:** better-sqlite3 doesn't support RETURNING, so the claim pattern is SELECT-in-transaction instead of UPDATE...RETURNING.

## Step 2: Refactor worker.js (Tasks #3-6)

**What I Did:**
- Split `runScrapeJob` into three functions: `runListCrawl`, `runDetailFetch`, `runScrapeJob` (orchestrator)
- `runListCrawl`: fetches list pages, upserts properties, calls `enqueueDetail()` for each, calls `saveViewstate()` after each page. Checks viewstate cache before fast-forward.
- `runDetailFetch`: loops calling `claimNextDetail()` until queue empty. Each worker claims -> fetches -> markDone/markFailed. No in-memory work list.
- `runScrapeJob`: configures proxy, starts running, delegates to phase 1 and/or phase 2 based on `job.mode`. Forwards events from sub-phases.
- Cancellation propagates via `activePhase.abort()` chain.

**What Worked:** Clean separation — each phase function is self-contained with its own emitter. The orchestrator just wires events through.

## Step 3: Queue/viewstate APIs + UI (Tasks #7-10)

**What I Did:**
- Queue API: GET /api/queue/stats, GET /api/queue (with status filter), POST /api/queue/retry-failed, POST /api/queue/clear-done
- Viewstate API: GET /api/viewstates?town=X, POST /api/viewstates/clear
- POST /api/jobs/start now accepts `mode` param
- Crash recovery: `resetInProgressDetails(db)` on startup alongside `recoverJobs(db)`
- UI: queue status cards (pending/in_progress/done/failed/total), Retry Failed + Clear Completed + Fetch Pending Details buttons, viewstate cache info line
- Job form: mode dropdown (Full / List Only / Details Only)

## Step 4: Rewrite run.js CLI (Task #11)

**What I Did:**
- Replaced all inline scraping logic with `runScrapeJob()` call
- Added `--mode` flag (full/list_only/details_only), `--no-details` maps to list_only for compat
- Creates a job record per run, logs events to console, shows queue stats in summary
- Removed redundant code: sleep, createRateLimiter, fetchDetailsParallel (all in worker.js now)
- File went from 239 lines to 100 lines

## Step 5: End-to-end test (Task #13)

**What I Did:**
1. **List-only crawl** (mode=list_only, 1 page, proxy): completed, 25 rows found, 16 properties queued (some dupes from previous data). Viewstate for page 1 cached (age: 0.5 min).
2. **Details-only fetch** (mode=details_only, 3 workers, proxy): started pulling from queue, got to 7/16 before cancel.
3. **Cancel**: stopped job, queue showed 10 done (some completed before cancel signal), 6 pending after cleanup.
4. **Resume**: new details-only job picked up remaining 6, completed all. Final queue: 16/16 done, 0 failed.

**What Worked:** Full round-trip. Queue survived cancel and resume. No duplicate fetches. Viewstate cached and visible in UI. INSERT OR IGNORE correctly skipped already-known properties.

## Current State

All 12 tasks complete. The scraper now supports:
- `mode=list_only`: crawl pages, populate queue, cache viewstates
- `mode=details_only`: fetch from queue, resume after interruption
- `mode=full`: both phases sequentially (default, backwards compatible)
- Queue visible in Scraper tab with stats and management buttons
- Viewstate cache display shows cached pages and freshness
