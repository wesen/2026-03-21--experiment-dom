# Tasks

## TODO

- [ ] Add tasks here

- [x] Add detail_queue and viewstates tables + CRUD helpers to db.js
- [x] Split worker.js runScrapeJob into runListCrawl + runDetailFetch
- [x] Phase 1: enqueue properties + save viewstates during list crawl
- [x] Phase 2: pull from detail_queue instead of in-memory list
- [x] Add viewstate cache lookup for fast-forward skip
- [x] Add mode column to jobs (full/list_only/details_only)
- [x] Add queue API endpoints: GET stats, GET items, POST retry-failed, POST clear-done
- [x] Update crash recovery: reset in_progress queue items on startup
- [x] Add queue status UI + mode dropdown to Scraper tab
- [x] Update run.js CLI with --mode flag
- [x] Add viewstate cache display to Scraper tab
- [x] Test full flow: list-only crawl, then details-only fetch, then resume after interruption
