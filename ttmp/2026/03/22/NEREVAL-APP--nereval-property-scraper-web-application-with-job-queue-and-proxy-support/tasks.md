# Tasks

## TODO

- [ ] Add tasks here

- [x] Add jobs and config tables to db.js (schema + CRUD helpers)
- [x] Extract scraper worker from run.js into worker.js (reusable, event-emitting)
- [x] Build job runner: queue processing, single-active-job enforcement, crash recovery
- [x] Add SSE endpoint /api/jobs/:id/stream for real-time progress
- [x] Add scraper control API: POST /start, POST /stop, GET /jobs, POST /retry
- [x] Add config API: GET/PUT /api/config, POST /api/config/proxy/test
- [x] Build Scraper tab UI: new job form, live progress bar, job history table
- [x] Build Settings modal: proxy URL input with test button, default rps/workers
- [ ] Enhance Landlords tab: fuzzy name grouping, total portfolio value, linked properties
- [ ] Add multi-unit analysis: filter by design type, sort by unit count, assessment per unit
- [x] Combine browser.mjs + new endpoints into single app.mjs
- [ ] Test full flow: configure proxy, start job, monitor progress, browse results
