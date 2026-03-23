# Tasks

## TODO

- [ ] Add tasks here

- [ ] Add detail_queue and viewstates tables + CRUD helpers to db.js
- [ ] Split worker.js runScrapeJob into runListCrawl + runDetailFetch
- [ ] Phase 1: enqueue properties + save viewstates during list crawl
- [ ] Phase 2: pull from detail_queue instead of in-memory list
- [ ] Add viewstate cache lookup for fast-forward skip
- [ ] Add mode column to jobs (full/list_only/details_only)
- [ ] Add queue API endpoints: GET stats, GET items, POST retry-failed, POST clear-done
- [ ] Update crash recovery: reset in_progress queue items on startup
- [ ] Add queue status UI + mode dropdown to Scraper tab
- [ ] Update run.js CLI with --mode flag
- [ ] Add viewstate cache display to Scraper tab
- [ ] Test full flow: list-only crawl, then details-only fetch, then resume after interruption
