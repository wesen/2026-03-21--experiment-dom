// nereval/worker.js — Scraper worker with decoupled phases and persistent queue
//
// Phase 1 (runListCrawl): Fetch paginated list pages, upsert properties,
//   enqueue detail URLs, cache viewstates.
// Phase 2 (runDetailFetch): Pull from detail_queue, fetch detail pages, store.
// runScrapeJob: Orchestrates both phases based on job.mode.

const EventEmitter = require('events');
const { fetchListPage, fetchNextPage, getFormState, hasNextPage, fetchDetailPage, setProxy } = require('./fetch');
const { extractListRows, extractDetail } = require('./extract');
const {
  upsertProperty, storeDetail, updateJob,
  enqueueDetail, claimNextDetail, markDetailDone, markDetailFailed, getQueueStats,
  saveViewstate, getViewstate,
} = require('./db');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function createRateLimiter(rps) {
  const minInterval = 1000 / rps;
  let gate = Promise.resolve();
  return function acquire() {
    const ticket = gate.then(() => sleep(minInterval));
    gate = ticket;
    return ticket;
  };
}

class CancelError extends Error {
  constructor() { super('Job cancelled'); this.name = 'CancelError'; }
}

// ── Phase 1: List Crawl ─────────────────────────────────────────────────────

function runListCrawl(db, job, opts = {}) {
  const emitter = new EventEmitter();
  let cancelled = false;
  emitter.abort = () => { cancelled = true; };

  const promise = (async () => {
    const t0 = Date.now();
    const endPage = job.end_page === -1 ? Infinity : job.end_page;
    const delay = 500;
    let totalRows = 0;
    let enqueued = 0;

    try {
      let pageNum = 1;
      let doc, formState;

      // Check viewstate cache for fast-forward skip
      if (job.start_page > 1) {
        const cached = getViewstate(db, job.town, job.start_page - 1);
        if (cached) {
          emitter.emit('status', { status: 'using cached viewstate for page ' + (job.start_page - 1) });
          // Fetch the start page directly using cached viewstate
          const { document: nextDoc } = await fetchNextPage(
            job.town, cached.view_state, cached.event_validation
          );
          if (cancelled) throw new CancelError();
          doc = nextDoc;
          formState = getFormState(doc);
          pageNum = job.start_page;
          // Save the viewstate for this page too
          saveViewstate(db, { town: job.town, pageNumber: pageNum, viewState: formState.viewState, eventValidation: formState.eventValidation });
        }
      }

      // If we didn't get a cache hit, fetch from page 1
      if (!doc) {
        const { document: firstDoc } = await fetchListPage(job.town);
        if (cancelled) throw new CancelError();
        doc = firstDoc;
        formState = getFormState(doc);
        saveViewstate(db, { town: job.town, pageNumber: 1, viewState: formState.viewState, eventValidation: formState.eventValidation });

        // Fast-forward to start page
        if (job.start_page > 1) {
          emitter.emit('status', { status: 'fast-forwarding', target_page: job.start_page });
          while (pageNum < job.start_page) {
            if (!hasNextPage(doc)) {
              throw new Error(`Only ${pageNum} pages exist, cannot reach page ${job.start_page}`);
            }
            await sleep(Math.min(delay, 200));
            if (cancelled) throw new CancelError();
            const { document: nextDoc } = await fetchNextPage(job.town, formState.viewState, formState.eventValidation);
            doc = nextDoc;
            formState = getFormState(doc);
            pageNum++;
            saveViewstate(db, { town: job.town, pageNumber: pageNum, viewState: formState.viewState, eventValidation: formState.eventValidation });
          }
        }
      }

      // Extract pages
      while (pageNum <= endPage) {
        if (cancelled) throw new CancelError();

        const rows = extractListRows(doc);
        for (const row of rows) {
          upsertProperty(db, job.town, row);
          if (row.detailUrl && row.accountNumber) {
            enqueueDetail(db, {
              accountNumber: row.accountNumber,
              detailUrl: row.detailUrl,
              town: job.town,
              jobId: job.id,
            });
            enqueued++;
          }
        }
        totalRows += rows.length;

        updateJob(db, job.id, { pages_done: pageNum - job.start_page + 1, rows_found: totalRows });
        emitter.emit('page', { page: pageNum, rows: rows.length, totalRows, enqueued });

        if (!hasNextPage(doc)) break;
        if (pageNum >= endPage) break;

        await sleep(delay);
        if (cancelled) throw new CancelError();
        const { document: nextDoc } = await fetchNextPage(job.town, formState.viewState, formState.eventValidation);
        doc = nextDoc;
        formState = getFormState(doc);
        pageNum++;
        saveViewstate(db, { town: job.town, pageNumber: pageNum, viewState: formState.viewState, eventValidation: formState.eventValidation });
      }

      const duration_s = ((Date.now() - t0) / 1000).toFixed(1);
      const queueStats = getQueueStats(db);
      emitter.emit('done', { status: 'completed', duration_s, rows: totalRows, enqueued, queueStats });

    } catch (err) {
      if (err instanceof CancelError) {
        emitter.emit('done', { status: 'cancelled', duration_s: ((Date.now() - t0) / 1000).toFixed(1) });
      } else {
        emitter.emit('error', { error: err.message, fatal: true });
        emitter.emit('done', { status: 'failed', error: err.message, duration_s: ((Date.now() - t0) / 1000).toFixed(1) });
      }
    }
  })();

  return { emitter, promise };
}

// ── Phase 2: Detail Fetch ───────────────────────────────────────────────────

function runDetailFetch(db, job, opts = {}) {
  const emitter = new EventEmitter();
  let cancelled = false;
  emitter.abort = () => { cancelled = true; };

  const promise = (async () => {
    const t0 = Date.now();
    let completed = 0;
    let errors = 0;

    try {
      const stats = getQueueStats(db);
      const total = stats.pending + stats.in_progress;
      updateJob(db, job.id, { details_total: total });
      emitter.emit('status', { status: 'running', phase: 'details', details_total: total, queue: stats });

      if (total === 0) {
        emitter.emit('done', { status: 'completed', duration_s: '0', details: 0 });
        return;
      }

      const limiter = createRateLimiter(job.rps || 1);

      async function worker(workerId) {
        await sleep(workerId * (1000 / (job.rps || 1) / (job.workers || 1)));
        while (true) {
          if (cancelled) throw new CancelError();

          const item = claimNextDetail(db);
          if (!item) break; // queue empty

          await limiter();
          if (cancelled) {
            // Put it back
            markDetailFailed(db, item.id, 'Cancelled');
            throw new CancelError();
          }

          try {
            const { document: detailDoc } = await fetchDetailPage(item.detail_url);
            const detail = extractDetail(detailDoc);
            storeDetail(db, item.account_number, detail);
            markDetailDone(db, item.id);
            completed++;
            updateJob(db, job.id, { details_done: completed, errors });
            emitter.emit('detail', {
              account: item.account_number,
              location: detail.parcel?.['Location'] || item.account_number,
              sales: detail.sales.length,
              priorYears: detail.priorAssessments.length,
              seq: completed,
              total,
            });
          } catch (err) {
            markDetailFailed(db, item.id, err.message);
            errors++;
            updateJob(db, job.id, { details_done: completed, errors });
            emitter.emit('error', { account: item.account_number, error: err.message });
          }
        }
      }

      const workerPromises = [];
      for (let i = 1; i <= (job.workers || 1); i++) {
        workerPromises.push(worker(i));
      }
      await Promise.all(workerPromises);

      const duration_s = ((Date.now() - t0) / 1000).toFixed(1);
      emitter.emit('done', { status: 'completed', duration_s, details: completed, errors });

    } catch (err) {
      if (err instanceof CancelError) {
        emitter.emit('done', { status: 'cancelled', duration_s: ((Date.now() - t0) / 1000).toFixed(1) });
      } else {
        emitter.emit('error', { error: err.message, fatal: true });
        emitter.emit('done', { status: 'failed', error: err.message, duration_s: ((Date.now() - t0) / 1000).toFixed(1) });
      }
    }
  })();

  return { emitter, promise };
}

// ── Combined: runScrapeJob ──────────────────────────────────────────────────

function runScrapeJob(db, job, opts = {}) {
  const emitter = new EventEmitter();
  let cancelled = false;
  let activePhase = null;

  emitter.abort = () => {
    cancelled = true;
    if (activePhase) activePhase.abort();
  };

  const promise = (async () => {
    const t0 = Date.now();

    // Configure proxy
    if (job.use_proxy && opts.proxyUrl) {
      await setProxy(opts.proxyUrl);
    } else {
      await setProxy(null);
    }

    updateJob(db, job.id, { status: 'running', started_at: new Date().toISOString() });
    emitter.emit('status', { status: 'running', job_id: job.id });

    const mode = job.mode || 'full';

    try {
      // ── Phase 1 ────────────────────────────────────────────────────
      if (mode === 'full' || mode === 'list_only') {
        const phase1 = runListCrawl(db, job, opts);
        activePhase = phase1.emitter;

        // Forward events
        for (const evt of ['status', 'page', 'error']) {
          phase1.emitter.on(evt, (data) => emitter.emit(evt, data));
        }

        await new Promise((resolve, reject) => {
          phase1.emitter.on('done', (data) => {
            if (data.status === 'cancelled') reject(new CancelError());
            else if (data.status === 'failed') reject(new Error(data.error));
            else resolve(data);
          });
        });

        activePhase = null;
      }

      if (cancelled) throw new CancelError();

      // ── Phase 2 ────────────────────────────────────────────────────
      if (mode === 'full' || mode === 'details_only') {
        if (mode !== 'full' || !job.no_details) {
          const queueStats = getQueueStats(db);
          emitter.emit('status', {
            status: 'running',
            phase: 'details',
            details_total: queueStats.pending,
            queue: queueStats,
          });

          const phase2 = runDetailFetch(db, job, opts);
          activePhase = phase2.emitter;

          for (const evt of ['status', 'detail', 'error']) {
            phase2.emitter.on(evt, (data) => emitter.emit(evt, data));
          }

          await new Promise((resolve, reject) => {
            phase2.emitter.on('done', (data) => {
              if (data.status === 'cancelled') reject(new CancelError());
              else if (data.status === 'failed') reject(new Error(data.error));
              else resolve(data);
            });
          });

          activePhase = null;
        }
      }

      // ── Done ───────────────────────────────────────────────────────
      const duration_s = ((Date.now() - t0) / 1000).toFixed(1);
      const finalStats = getQueueStats(db);
      updateJob(db, job.id, {
        status: 'completed',
        finished_at: new Date().toISOString(),
        properties_added: finalStats.done,
      });
      emitter.emit('done', { status: 'completed', duration_s, properties_added: finalStats.done });

    } catch (err) {
      if (err instanceof CancelError) {
        updateJob(db, job.id, { status: 'cancelled', finished_at: new Date().toISOString() });
        emitter.emit('done', { status: 'cancelled', duration_s: ((Date.now() - t0) / 1000).toFixed(1) });
      } else {
        updateJob(db, job.id, {
          status: 'failed',
          finished_at: new Date().toISOString(),
          error_msg: err.message,
        });
        emitter.emit('error', { error: err.message, fatal: true });
        emitter.emit('done', { status: 'failed', error: err.message, duration_s: ((Date.now() - t0) / 1000).toFixed(1) });
      }
    }
  })();

  return { emitter, promise };
}

module.exports = { runScrapeJob, runListCrawl, runDetailFetch };
