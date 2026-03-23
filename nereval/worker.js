// nereval/worker.js — Reusable scraper worker with EventEmitter progress
//
// Extracted from run.js so the web server can drive scrape jobs and stream
// progress via SSE. The worker emits events for each phase/step/error.

const EventEmitter = require('events');
const { fetchListPage, fetchNextPage, getFormState, hasNextPage, fetchDetailPage, setProxy } = require('./fetch');
const { extractListRows, extractDetail } = require('./extract');
const { upsertProperty, storeDetail, updateJob } = require('./db');

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

/**
 * Run a scrape job. Returns an EventEmitter that emits:
 *   'status'  — { status, pages_done, details_done, details_total, ... }
 *   'page'    — { page, rows, totalRows }
 *   'detail'  — { account, location, sales, priorYears }
 *   'error'   — { account?, error, retrying? }
 *   'done'    — { status, duration_s, properties_added, errors }
 *
 * The returned emitter also has an `abort()` method to cancel the job.
 *
 * @param {object} db         — open better-sqlite3 handle (read/write)
 * @param {object} job        — job row from the jobs table
 * @param {object} opts       — { proxyUrl }
 * @returns {{ emitter: EventEmitter, promise: Promise<void> }}
 */
function runScrapeJob(db, job, opts = {}) {
  const emitter = new EventEmitter();
  let cancelled = false;

  emitter.abort = () => { cancelled = true; };

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

    const endPage = job.end_page === -1 ? Infinity : job.end_page;
    const delay = 500;
    let totalRows = 0;

    try {
      // ── Phase 1: Crawl list pages ────────────────────────────────
      const allRows = [];
      let pageNum = 1;

      const { document: firstDoc } = await fetchListPage(job.town);
      if (cancelled) throw new CancelError();
      let doc = firstDoc;
      let formState = getFormState(doc);

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
        }
      }

      // Extract pages
      while (pageNum <= endPage) {
        if (cancelled) throw new CancelError();

        const rows = extractListRows(doc);
        for (const row of rows) {
          allRows.push(row);
          upsertProperty(db, job.town, row);
        }
        totalRows += rows.length;

        updateJob(db, job.id, { pages_done: pageNum - job.start_page + 1, rows_found: totalRows });
        emitter.emit('page', { page: pageNum, rows: rows.length, totalRows });

        if (!hasNextPage(doc)) break;
        if (pageNum >= endPage) break;

        await sleep(delay);
        if (cancelled) throw new CancelError();
        const { document: nextDoc } = await fetchNextPage(job.town, formState.viewState, formState.eventValidation);
        doc = nextDoc;
        formState = getFormState(doc);
        pageNum++;
      }

      // Deduplicate
      const uniqueAccounts = new Map();
      for (const row of allRows) {
        if (row.accountNumber && !uniqueAccounts.has(row.accountNumber)) {
          uniqueAccounts.set(row.accountNumber, row);
        }
      }

      emitter.emit('status', {
        status: 'running',
        phase: 'details',
        rows_found: totalRows,
        details_total: uniqueAccounts.size,
      });

      // ── Phase 2: Fetch detail pages ──────────────────────────────
      if (!job.no_details) {
        const items = [...uniqueAccounts.entries()].filter(([, row]) => row.detailUrl);
        const total = items.length;
        updateJob(db, job.id, { details_total: total });

        let completed = 0;
        let errors = 0;
        const limiter = createRateLimiter(job.rps || 1);
        let nextIdx = 0;

        async function worker(workerId) {
          await sleep(workerId * (1000 / (job.rps || 1) / (job.workers || 1)));
          while (true) {
            if (cancelled) throw new CancelError();
            const idx = nextIdx++;
            if (idx >= items.length) break;

            const [acct, row] = items[idx];
            await limiter();
            if (cancelled) throw new CancelError();

            try {
              const { document: detailDoc } = await fetchDetailPage(row.detailUrl);
              const detail = extractDetail(detailDoc);
              storeDetail(db, acct, detail);
              completed++;
              updateJob(db, job.id, { details_done: completed, errors });
              emitter.emit('detail', {
                account: acct,
                location: row.location,
                sales: detail.sales.length,
                priorYears: detail.priorAssessments.length,
                seq: completed,
                total,
              });
            } catch (err) {
              errors++;
              updateJob(db, job.id, { details_done: completed, errors });
              emitter.emit('error', { account: acct, error: err.message });
            }
          }
        }

        const workers = [];
        for (let i = 1; i <= (job.workers || 1); i++) {
          workers.push(worker(i));
        }
        await Promise.all(workers);
      }

      // ── Done ─────────────────────────────────────────────────────
      const duration_s = ((Date.now() - t0) / 1000).toFixed(1);
      updateJob(db, job.id, {
        status: 'completed',
        finished_at: new Date().toISOString(),
        properties_added: uniqueAccounts.size,
      });
      emitter.emit('done', { status: 'completed', duration_s, properties_added: uniqueAccounts.size });

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

class CancelError extends Error {
  constructor() { super('Job cancelled'); this.name = 'CancelError'; }
}

module.exports = { runScrapeJob };
