---
Title: Go backend and React Redux frontend redesign with WebSocket progress
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
      Note: Current monolithic server and inline UI being replaced
    - Path: nereval/db.js
      Note: Current schema and queue behavior informing the Go store design
    - Path: nereval/extract.js
      Note: Current DOM contracts informing the Go parser layer
    - Path: nereval/fetch.js
      Note: Current retry and proxy behavior informing the Go fetch layer
    - Path: nereval/worker.js
      Note: Current runtime and progress flow informing the Go scheduler/runtime design
    - Path: ttmp/2026/03/23/NEREVAL-REVIEW--nereval-scraper-code-review-and-redesign-report/design-doc/01-nereval-scraper-architecture-review-and-redesign-guide.md
      Note: Companion review doc that explains the current architecture and findings
ExternalSources: []
Summary: Target architecture for moving nereval to a Go backend plus React/Redux frontend with WebSocket progress streaming.
LastUpdated: 2026-03-23T00:33:49.611153376-04:00
WhatFor: Give an intern a concrete, implementable target design for replacing the current Node/inline-UI app with a Go service and React/Redux frontend.
WhenToUse: Use when planning or implementing the Go + React/Redux rewrite of nereval.
---


# Go backend and React Redux frontend redesign with WebSocket progress

## Executive Summary

This document describes the target architecture for rewriting the current `nereval/` application as a Go backend plus a React/Redux frontend, with WebSocket-based live task progress. It is intentionally paired with the first review document in this ticket. The first document explains what the current system does and where it is weak. This document answers the next question: if we rebuild it cleanly in Go and React/Redux, what should the shape of the system be?

The recommended target is still deliberately simple:

1. One Go binary in production.
2. SQLite as the primary local database.
3. One React frontend built with Vite during development.
4. WebSockets for progress streams and task updates.
5. Redux Toolkit for client state orchestration.

The point of moving to Go is not to "be more enterprise". The point is to make the long-running scraper runtime, queue semantics, restart behavior, and concurrency model easier to reason about. The point of moving to React/Redux is not to add ceremony. It is to separate UI concerns from server code and give live task state a predictable client-side model.

## Problem Statement

The current Node application combines too many responsibilities in one runtime file and one programming model. The same codebase currently contains:

- a scraper runtime,
- a job runner,
- a persistent queue,
- a viewstate cache,
- an Express API,
- an SSE progress stream,
- a browser UI embedded as an inline HTML string,
- and a legacy read-only browser server that still exists beside the combined app.

That is workable for an experiment, but it is not the best long-term architecture for a maintained application.

The rewrite needs to solve four problems at once:

1. Give the scraper a clearer runtime model for long-running jobs and queue workers.
2. Give the browser app a real frontend structure instead of inline HTML/JS.
3. Preserve the simple deployment story of a single machine and a single database.
4. Improve live progress from the current server-sent events path into a more extensible WebSocket channel that can carry task updates and future operator actions.

## Scope

This document defines:

- target package/layout structure,
- backend responsibilities,
- frontend responsibilities,
- queue and task model,
- WebSocket event model,
- API contracts,
- migration phases,
- developer workflow,
- and operational behavior.

This document does not prescribe every SQL statement or every React component. It defines the architecture and the contracts so those details can be implemented coherently.

## The Big Picture

### Target architecture at a glance

```text
                     ┌───────────────────────────────────┐
                     │ React + Redux Frontend            │
                     │ ui/                               │
                     │                                   │
                     │ - RTK Query for REST reads        │
                     │ - jobSlice / queueSlice           │
                     │ - wsSlice for live task updates   │
                     └──────────────┬────────────────────┘
                                    │
                          HTTP / API│/ WS
                                    │
                     ┌──────────────▼────────────────────┐
                     │ Go Backend                        │
                     │ cmd/nereval                       │
                     │                                   │
                     │ HTTP API        WebSocket Hub     │
                     │ Scheduler       Job Runner        │
                     │ Queue Store     Scraper Runtime   │
                     └──────────────┬────────────────────┘
                                    │
                                    │ SQL
                                    │
                     ┌──────────────▼────────────────────┐
                     │ SQLite                            │
                     │                                   │
                     │ properties / details              │
                     │ jobs / job_items / config         │
                     │ viewstate_cache / events          │
                     └───────────────────────────────────┘
```

### Recommended runtime topology

Development:

- Vite frontend on `:3000`
- Go API + WebSocket server on `:3001`
- Vite proxies `/api/*` and `/ws` to the Go server

Production:

- one Go binary serves `/api/*`, `/ws`, and the compiled SPA from `/`
- frontend assets are embedded with `go:embed`

This follows the same practical model described in the `go-web-frontend-embed` skill: two-process dev loop, one-binary production packaging.

## Proposed Repository Layout

Recommended layout:

```text
cmd/
  nereval/
    main.go

internal/
  app/
    app.go
    config.go
  api/
    router.go
    jobs_handlers.go
    queue_handlers.go
    config_handlers.go
    properties_handlers.go
  websocket/
    hub.go
    client.go
    protocol.go
  scheduler/
    scheduler.go
    runner.go
  scraper/
    fetch/
      client.go
      proxy.go
      retry.go
      aspnet.go
    parse/
      list.go
      detail.go
    runtime/
      list_crawl.go
      detail_fetch.go
      job_runtime.go
  store/
    sqlite/
      db.go
      migrations.go
      jobs.go
      queue.go
      properties.go
      config.go
      events.go
      viewstate.go
  domain/
    job.go
    queue_item.go
    property.go
    progress_event.go
  web/
    embed.go
    embed_none.go
    spa.go
    generate.go
    generate_build.go

ui/
  src/
    app/
      store.ts
      router.tsx
    features/
      jobs/
      queue/
      properties/
      config/
      websocket/
    components/
    pages/
    lib/
  vite.config.ts
  package.json
```

Why this matters for an intern:

- backend packages answer "where does this code belong?",
- frontend features answer "which slice owns this state?",
- shared domain types reduce accidental drift between scheduler/API/UI names.

## Backend Design

### Core backend responsibilities

The Go backend should own:

1. Job lifecycle.
2. Queue item lifecycle.
3. HTTP scraping and ASP.NET pagination logic.
4. Persistence.
5. Progress event fan-out.
6. Read APIs for the browser UI.

The backend should not own:

- inline browser UI code,
- DOM rendering,
- ad hoc client-side polling logic,
- stateful progress UI behavior.

### Why Go fits the backend well

This system is a long-running, I/O-bound worker application with explicit concurrency, cancellation, and restart behavior. Go is a strong fit because:

- goroutines are a natural model for workers,
- `context.Context` gives cancellation a first-class path,
- channels make event fan-out explicit,
- `database/sql` or a thin SQLite wrapper can keep storage disciplined,
- the deployment artifact stays small and simple.

### Backend package responsibilities

`internal/scheduler`

- owns the active job loop,
- claims the next queued job,
- starts the scraper runtime,
- finalizes job status,
- triggers the next queued job automatically.

`internal/scraper/fetch`

- HTTP client setup,
- proxy selection,
- retry/backoff,
- ASP.NET viewstate/eventvalidation POST helpers.

`internal/scraper/parse`

- list-page extraction,
- detail-page extraction,
- parser drift errors with explicit typed failures.

`internal/store/sqlite`

- schema bootstrap,
- queue/job/property persistence,
- query/read models,
- transactional store helpers.

`internal/websocket`

- client registration,
- subscription model,
- write fan-out,
- ping/pong heartbeat,
- message serialization.

`internal/api`

- REST endpoints,
- WebSocket upgrade endpoint,
- auth hook if needed later,
- request validation and response shaping.

## Domain Model

### Jobs

A `Job` is a top-level scrape request.

Suggested fields:

```go
type Job struct {
    ID           int64
    Town         string
    StartPage    int
    EndPage      int // -1 means all
    Workers      int
    RPS          float64
    UseProxy     bool
    Mode         JobMode // Full, ListOnly, DetailsOnly
    Status       JobStatus
    CreatedAt    time.Time
    StartedAt    *time.Time
    FinishedAt   *time.Time
    PagesDone    int
    RowsFound    int
    DetailsDone  int
    DetailsTotal int
    Errors       int
    ErrorMessage string
}
```

### Queue items

A `QueueItem` is one piece of detail work owned by a job.

Suggested fields:

```go
type QueueItem struct {
    ID             int64
    JobID          int64
    Town           string
    AccountNumber  string
    DetailURL      string
    Location       string
    SourcePage     int
    Status         QueueStatus
    Attempts       int
    NextAttemptAt  *time.Time
    LeaseOwner     string
    LeaseExpiresAt *time.Time
    LastErrorCode  string
    LastErrorMsg   string
    CompletedAt    *time.Time
}
```

### Progress events

The backend should emit typed progress events, not free-form log text only.

Suggested event kinds:

- `job.snapshot`
- `job.status`
- `job.page`
- `job.detail`
- `job.error`
- `job.done`
- `queue.stats`

## Queue And Task Semantics

### The conceptual model

The queue should be task-based and job-scoped.

In this rewrite, "task" means a concrete unit of progress that the UI can display and that the backend can retry, cancel, or finish deterministically. Examples:

- fast-forward to page 17,
- process list page 18,
- fetch detail for account `24058`,
- retry detail fetch after backoff,
- complete job finalization.

You do not need a separate database table for every task type. But you do need explicit event types and explicit state transitions.

### Recommended state machine

Job states:

```text
queued -> running -> completed
queued -> running -> failed
queued -> running -> cancelled
queued -> cancelled
queued -> paused
paused -> queued
```

Queue item states:

```text
pending -> leased -> done
pending -> leased -> retry_wait -> pending
pending -> leased -> failed_terminal
pending -> leased -> cancelled
```

### Why this matters

The current Node version confuses these concepts in a few places. The Go rewrite should make them impossible to mix up by accident:

- "cancelled" is not "failed",
- "queued" is not "currently running",
- "job progress" is not the same thing as "global backlog state",
- "task event" is not the same thing as "UI log string".

## WebSocket Design

### Why WebSockets instead of SSE in the rewrite

The current system uses SSE effectively for one-way progress. For the Go/React rewrite, WebSockets are a better fit because they allow:

- one persistent connection for all live updates,
- multiplexed subscriptions,
- ping/pong health checks,
- future bidirectional control messages,
- richer reconnect semantics.

This does not mean the UI should send lots of control traffic over the socket immediately. Initial control operations can still be plain REST. The main benefit is that the transport becomes extensible instead of single-purpose.

### Recommended WebSocket shape

Endpoint:

```text
GET /ws
```

Client sends subscription commands:

```json
{ "type": "subscribe", "topic": "job:42" }
{ "type": "subscribe", "topic": "queue:42" }
{ "type": "unsubscribe", "topic": "job:42" }
{ "type": "ping" }
```

Server sends typed events:

```json
{
  "type": "job.status",
  "jobId": 42,
  "payload": {
    "status": "running",
    "phase": "details"
  }
}
```

```json
{
  "type": "job.page",
  "jobId": 42,
  "payload": {
    "page": 18,
    "rows": 26,
    "rowsFound": 468
  }
}
```

```json
{
  "type": "job.detail",
  "jobId": 42,
  "payload": {
    "accountNumber": "24058",
    "location": "40 Abbott St",
    "seq": 91,
    "total": 212
  }
}
```

```json
{
  "type": "queue.stats",
  "jobId": 42,
  "payload": {
    "pending": 120,
    "leased": 2,
    "retryWait": 4,
    "failedTerminal": 1,
    "done": 85,
    "total": 212
  }
}
```

### Recommended WebSocket server design

```go
type Hub struct {
    mu          sync.RWMutex
    subscribers map[string]map[*Client]struct{}
}

func (h *Hub) Publish(topic string, msg OutboundMessage) {
    h.mu.RLock()
    clients := h.subscribers[topic]
    h.mu.RUnlock()

    for c := range clients {
        c.Send(msg)
    }
}
```

Recommended topics:

- `job:<jobID>`
- `queue:<jobID>`
- `jobs:all`

Why topic-based subscriptions are useful:

- the jobs table screen can subscribe to `jobs:all`,
- the detail progress screen can subscribe to `job:42`,
- the queue screen can subscribe to `queue:42`,
- future operator dashboards can reuse the same transport.

### Heartbeat and reconnect rules

Recommended rules:

1. Server sends periodic ping or keepalive.
2. Client replies with pong or reconnects automatically if connection drops.
3. On reconnect, client immediately resubscribes to active topics.
4. Client requests a fresh REST snapshot after reconnect to avoid missing events.

This matters because progress streams are not only about liveness. They are about eventual consistency after temporary disconnects.

## Frontend Design

### Why React + Redux

This UI has two distinct state types:

1. server-derived state that should be queryable and cacheable,
2. live ephemeral task progress that arrives as events.

Redux Toolkit is a good fit because it gives:

- standardized slices,
- listener middleware,
- ergonomic async flows,
- predictable event reduction,
- and better debugging for queue/task state.

### Recommended frontend stack

- React
- Redux Toolkit
- RTK Query for HTTP APIs
- Redux slices for live WebSocket event reduction
- React Router for page navigation
- plain CSS or a small component library, but not a heavy framework by default

### Recommended frontend state ownership

`jobsSlice`

- selected job,
- last-known job statuses,
- current progress summaries,
- job history filters.

`queueSlice`

- per-job queue stats,
- visible queue rows,
- queue search/filter state,
- last received queue timestamp.

`propertiesApi` via RTK Query

- stats,
- property list,
- property detail,
- landlords,
- multi-unit views.

`configSlice`

- proxy settings form state,
- connection test state,
- saved defaults.

`websocketSlice`

- connection status,
- active subscriptions,
- reconnect counter,
- last socket error.

### Frontend event flow

```text
REST snapshot on page load
  -> Redux initial state
  -> open WebSocket
  -> subscribe to job / queue topics
  -> receive live events
  -> reducers update slices
  -> components re-render
  -> periodic or reconnect-triggered REST refresh reconciles state
```

### Example Redux setup

```ts
export const store = configureStore({
  reducer: {
    [propertiesApi.reducerPath]: propertiesApi.reducer,
    jobs: jobsReducer,
    queue: queueReducer,
    config: configReducer,
    websocket: websocketReducer,
  },
  middleware: (getDefault) =>
    getDefault().concat(propertiesApi.middleware, websocketListenerMiddleware),
});
```

### Example WebSocket reducer logic

```ts
function handleSocketMessage(msg: OutboundMessage) {
  switch (msg.type) {
    case "job.status":
      dispatch(jobStatusReceived(msg));
      break;
    case "job.page":
      dispatch(jobPageReceived(msg));
      break;
    case "job.detail":
      dispatch(jobDetailReceived(msg));
      break;
    case "queue.stats":
      dispatch(queueStatsReceived(msg));
      break;
  }
}
```

## API Design

### REST endpoints

Recommended REST surface:

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/jobs` | create job |
| `GET` | `/api/jobs` | list jobs |
| `GET` | `/api/jobs/:id` | job snapshot |
| `POST` | `/api/jobs/:id/cancel` | cancel job |
| `POST` | `/api/jobs/:id/retry` | clone/requeue a failed or cancelled job |
| `GET` | `/api/jobs/:id/items` | paginated task/queue view |
| `GET` | `/api/jobs/:id/items/stats` | queue/task stats for one job |
| `POST` | `/api/jobs/:id/items/retry-failed` | requeue eligible failed items |
| `GET` | `/api/config` | read safe config snapshot |
| `PUT` | `/api/config` | update config |
| `POST` | `/api/config/proxy/test` | test proxy |
| `GET` | `/api/properties` | list/read model |
| `GET` | `/api/property/:accountNumber` | detail read model |

### REST versus WebSocket responsibility split

REST should handle:

- create/cancel/retry actions,
- initial snapshots,
- paginated data,
- config changes,
- read-only analytical views.

WebSocket should handle:

- live progress,
- queue stats updates,
- job status changes,
- error notifications,
- future operator notifications.

This split keeps the protocol easy to teach:

- "REST for state transfer and commands"
- "WebSocket for live events"

## Persistence Design

### SQLite is still the default

There is no need to abandon SQLite in the rewrite. The current architecture review already shows that SQLite is a good fit for a single-machine worker application. The Go rewrite should keep it unless actual deployment requirements change.

Recommended tables:

- `properties`
- `owners`
- `assessments`
- `prior_assessments`
- `buildings`
- `sales`
- `sub_areas`
- `land`
- `mailing_addresses`
- `jobs`
- `job_items`
- `job_events`
- `config`
- `viewstate_cache`

### New table recommendation: job_events

Add a durable job event log:

```sql
job_events (
  id            INTEGER PRIMARY KEY,
  job_id        INTEGER NOT NULL,
  event_type    TEXT NOT NULL,
  payload_json  TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
```

Why:

- the UI can fetch recent history after reconnect,
- operators can inspect failures after the fact,
- WebSocket messages can be replayed or summarized,
- debugging becomes much easier.

## Scraper Runtime Design In Go

### List crawl runtime

Responsibilities:

- fetch first list page or jump with cached viewstate,
- extract rows,
- write properties,
- enqueue detail tasks,
- emit page progress events,
- update cached viewstates,
- stop cleanly when context is cancelled.

Pseudocode:

```go
func (r *Runtime) RunListCrawl(ctx context.Context, job Job) error {
    page, formState, err := r.listFetcher.Start(ctx, job)
    if err != nil {
        return err
    }

    for {
        rows := r.parser.ParseList(page.Document)
        txErr := r.store.WithTx(ctx, func(tx Store) error {
            for _, row := range rows {
                tx.UpsertProperty(ctx, job.Town, row)
                tx.EnqueueJobItem(ctx, job.ID, row)
            }
            tx.SaveViewstate(ctx, job.Town, page.Number, formState)
            tx.AppendJobEvent(ctx, job.ID, "job.page", ...)
            return nil
        })
        if txErr != nil {
            return txErr
        }

        if page.Done || page.Number >= job.EndPage {
            return nil
        }

        page, formState, err = r.listFetcher.Next(ctx, job, formState)
        if err != nil {
            return err
        }
    }
}
```

### Detail worker runtime

Responsibilities:

- claim job-local task,
- obey rate limiting,
- fetch detail,
- parse detail,
- store canonical rows transactionally,
- emit task progress,
- classify errors,
- retry or fail terminally.

Pseudocode:

```go
func (r *Runtime) RunDetailWorkers(ctx context.Context, job Job) error {
    group, ctx := errgroup.WithContext(ctx)
    limiter := rate.NewLimiter(rate.Limit(job.RPS), 1)

    for i := 0; i < job.Workers; i++ {
        workerID := i
        group.Go(func() error {
            return r.runWorker(ctx, job, workerID, limiter)
        })
    }

    return group.Wait()
}
```

## Developer Workflow

Recommended workflow:

Development:

1. `make dev-backend` runs Go on `:3001`
2. `make dev-frontend` runs Vite on `:3000`
3. Vite proxies `/api` and `/ws`

Production:

1. `go generate ./internal/web`
2. build frontend assets into `ui/dist/public`
3. copy/embed assets under `internal/web/embed/public`
4. `go build -tags embed ./cmd/nereval`

This keeps the rewrite pragmatic and deployable from the start.

## Migration Plan

### Phase 1: backend contracts and storage

1. Define Go domain types and SQLite schema.
2. Implement queue/job store with deterministic semantics.
3. Add job scheduler and job events.
4. Preserve current data model enough to migrate existing DBs if desired.

### Phase 2: scraper port

1. Port request logic from `nereval/fetch.js`.
2. Port parser logic from `nereval/extract.js`.
3. Port queue/job runtime from `nereval/worker.js`.
4. Validate against saved HTML fixtures and a few live smoke runs.

### Phase 3: API and WebSocket hub

1. Build REST endpoints.
2. Add WebSocket hub and topic protocol.
3. Add durable event recording.
4. Verify reconnect and resubscribe behavior.

### Phase 4: React/Redux frontend

1. Build the app shell and routes.
2. Add RTK Query services for REST reads.
3. Add WebSocket listener middleware and slices.
4. Recreate the current operator screens with clearer boundaries.

### Phase 5: cutover

1. Run the Go app against a test database.
2. Verify queue semantics, retry semantics, cancellation, restart behavior.
3. Compare outputs against the current Node path.
4. Retire `nereval/app.mjs`, `nereval/browser.mjs`, and the inline UI once parity is acceptable.

## Design Decisions

### 1. Keep SQLite

Reason:

- proven adequate for current shape,
- simple local deployment,
- easy inspection and backup,
- no extra queue service.

### 2. Use WebSockets for live progress

Reason:

- richer than SSE for future growth,
- allows one connection for multiple subscriptions,
- fits React/Redux event reduction well.

### 3. Use Redux Toolkit, not ad hoc component state

Reason:

- live task progress is shared state,
- queue/task/job screens need coherent updates,
- reconnect behavior is easier to manage centrally.

### 4. Keep production to one Go binary

Reason:

- easiest operator story,
- preserves the lightweight deployment model,
- avoids inventing infrastructure before it is needed.

## Alternatives Considered

### Alternative: Go backend + polling frontend

Rejected because:

- easier initial implementation, but weaker UX,
- higher request volume,
- more complex client reconciliation,
- less useful for task-level progress.

### Alternative: Go backend + SSE frontend

Rejected for the rewrite because:

- SSE is fine for one-way job progress,
- but WebSocket gives a cleaner path for subscriptions, heartbeats, and future operator commands,
- and avoids splitting "some live features on SSE, some later on something else".

### Alternative: keep Node backend, only rewrite the frontend

Rejected because:

- the main correctness issues are in the scraper runtime and queue semantics,
- a frontend-only rewrite would not simplify cancellation, scheduler behavior, or storage contracts.

## Open Questions

1. Should the initial Go rewrite preserve the existing SQLite schema exactly, or is a one-time migration acceptable?
2. Should detail retries be fully automatic, or should some failure classes move jobs into an operator-visible paused state?
3. Do we want one global WebSocket endpoint with topics, or dedicated endpoints such as `/ws/jobs/:id`?
4. Should the frontend store full recent event logs in Redux, or fetch history on demand from `job_events`?
5. Will the Go rewrite need authentication soon, or can it remain localhost-first for now?

## References

Current source files that shaped this design:

- `nereval/app.mjs:1-1517`
- `nereval/browser.mjs:1-565`
- `nereval/db.js:1-502`
- `nereval/worker.js:1-343`
- `nereval/fetch.js:1-207`
- `nereval/extract.js:1-154`
- `nereval/run.js:1-140`

Companion doc in this ticket:

- `ttmp/2026/03/23/NEREVAL-REVIEW--nereval-scraper-code-review-and-redesign-report/design-doc/01-nereval-scraper-architecture-review-and-redesign-guide.md`
