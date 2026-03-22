// 40-nereval-run.js — Scrape nereval property list + detail pages, store in SQLite
//
// Usage:
//   node 40-nereval-run.js                          # default: Providence, pages 1-3
//   node 40-nereval-run.js --town Providence --pages 10
//   node 40-nereval-run.js --town Providence --pages all
//   node 40-nereval-run.js --start 3 --pages 7      # scrape pages 3 through 7
//   node 40-nereval-run.js --start 6 --pages 10     # scrape pages 6 through 10
//   node 40-nereval-run.js --no-details              # list pages only, skip detail fetches
//   node 40-nereval-run.js --workers 5               # 5 parallel detail fetchers
//   node 40-nereval-run.js --workers 10 --rps 20     # 10 workers, max 20 req/s
//
// Options:
//   --town <name>    Town name (default: Providence)
//   --pages <N|all>  Last page number to scrape (default: 3)
//   --start <N>      First page number to scrape (default: 1). Pages before this are
//                    fast-forwarded (fetched for viewstate but not extracted).
//   --db <path>      SQLite database path (default: nereval-providence.db)
//   --delay <ms>     Delay between requests in ms for list pages (default: 500)
//   --no-details     Skip phase 2 (detail page fetching). Only crawl the list.
//   --workers <N>    Number of parallel workers for detail fetching (default: 1)
//   --rps <N>        Max requests per second across all workers (default: 5).
//                    Each worker sleeps (1000*workers/rps) ms between requests.

const { fetchListPage, fetchNextPage, getFormState, hasNextPage, fetchDetailPage } = require('./37-nereval-fetch');
const { extractListRows, extractDetail } = require('./38-nereval-extract');
const { openDb, upsertProperty, storeDetail } = require('./39-nereval-db');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { town: 'Providence', pages: 3, start: 1, db: null, delay: 500, noDetails: false, workers: 1, rps: 5 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--town') opts.town = args[++i];
    else if (args[i] === '--pages') opts.pages = args[i + 1] === 'all' ? Infinity : parseInt(args[++i]);
    else if (args[i] === '--start') opts.start = parseInt(args[++i]);
    else if (args[i] === '--db') opts.db = args[++i];
    else if (args[i] === '--delay') opts.delay = parseInt(args[++i]);
    else if (args[i] === '--no-details') opts.noDetails = true;
    else if (args[i] === '--workers') opts.workers = parseInt(args[++i]);
    else if (args[i] === '--rps') opts.rps = parseFloat(args[++i]);
  }
  if (!opts.db) opts.db = `nereval-${opts.town.toLowerCase()}.db`;
  return opts;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Serialized rate limiter — ensures at most `rps` requests per second globally.
 * All workers acquire a slot through a single promise chain, guaranteeing order
 * and preventing burst traffic from overwhelming the server.
 */
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
 * Fetch detail pages using a pool of concurrent workers with shared rate limiting.
 *
 * Workers pull from a shared job array via an atomic index. The rate limiter
 * serializes outbound requests so the server never sees more than `rps` req/s
 * regardless of worker count. Workers add concurrency for the network latency
 * (while one worker waits for a response, another can start its request).
 *
 * DB writes are safe: better-sqlite3 is synchronous and single-threaded.
 */
async function fetchDetailsParallel(db, accounts, opts) {
  const items = [...accounts.entries()].filter(([, row]) => row.detailUrl);
  const total = items.length;
  let completed = 0;
  let errors = 0;
  const limiter = createRateLimiter(opts.rps);

  // Shared atomic-ish index (safe because JS is single-threaded for sync ops)
  let nextIdx = 0;

  async function worker(workerId) {
    // Stagger worker start so they don't all fire simultaneously
    await sleep(workerId * (1000 / opts.rps / opts.workers));

    while (true) {
      const idx = nextIdx++;
      if (idx >= items.length) break;

      const [acct, row] = items[idx];

      await limiter(); // wait for rate-limit slot

      const seq = ++completed;
      const label = `  [${seq}/${total}] (w${workerId}) ${acct} ${row.location}`;
      try {
        const { document: detailDoc } = await fetchDetailPage(row.detailUrl);
        const detail = extractDetail(detailDoc);
        storeDetail(db, acct, detail);
        console.log(`${label}... OK (${detail.sales.length} sales, ${detail.priorAssessments.length} prior years)`);
      } catch (err) {
        errors++;
        console.log(`${label}... ERROR: ${err.message}`);
      }
    }
  }

  const workerPromises = [];
  for (let i = 1; i <= opts.workers; i++) {
    workerPromises.push(worker(i));
  }
  await Promise.all(workerPromises);

  return { completed: total, errors };
}

async function main() {
  const opts = parseArgs();
  const pagesLabel = opts.pages === Infinity ? 'all' : opts.pages;
  const workerLabel = opts.workers > 1 ? `, ${opts.workers} workers @ ${opts.rps} rps` : '';
  console.log(`Scraping nereval: town=${opts.town}, pages=${opts.start}-${pagesLabel}, db=${opts.db}, delay=${opts.delay}ms${workerLabel}`);

  const db = openDb(opts.db);

  // Phase 1: Crawl list pages, collect all property rows
  const allRows = [];
  let pageNum = 1;
  let doc, formState;

  console.log(`\n--- Phase 1: Crawling list pages ---`);
  const { document: firstDoc } = await fetchListPage(opts.town);
  doc = firstDoc;
  formState = getFormState(doc);

  // Fast-forward to the start page (must crawl sequentially due to ASP.NET viewstate)
  if (opts.start > 1) {
    console.log(`  Fast-forwarding to page ${opts.start}...`);
    while (pageNum < opts.start) {
      if (!hasNextPage(doc)) {
        console.log(`  No more pages — only ${pageNum} pages exist.`);
        db.close();
        return;
      }
      await sleep(Math.min(opts.delay, 200)); // faster during skip
      const { document: nextDoc } = await fetchNextPage(opts.town, formState.viewState, formState.eventValidation);
      doc = nextDoc;
      formState = getFormState(doc);
      pageNum++;
    }
    console.log(`  Reached page ${pageNum}.`);
  }

  while (pageNum <= opts.pages) {
    const rows = extractListRows(doc);
    console.log(`  Page ${pageNum}: ${rows.length} properties`);

    for (const row of rows) {
      allRows.push(row);
      upsertProperty(db, opts.town, row);
    }

    if (!hasNextPage(doc)) {
      console.log(`  No more pages.`);
      break;
    }

    if (pageNum >= opts.pages) break;

    await sleep(opts.delay);
    const { document: nextDoc } = await fetchNextPage(opts.town, formState.viewState, formState.eventValidation);
    doc = nextDoc;
    formState = getFormState(doc);
    pageNum++;
  }

  // Deduplicate by account number for detail fetching
  const uniqueAccounts = new Map();
  for (const row of allRows) {
    if (row.accountNumber && !uniqueAccounts.has(row.accountNumber)) {
      uniqueAccounts.set(row.accountNumber, row);
    }
  }
  console.log(`\n  Total: ${allRows.length} rows, ${uniqueAccounts.size} unique properties`);

  // Phase 2: Fetch detail pages
  if (opts.noDetails) {
    console.log(`\n--- Phase 2: Skipped (--no-details) ---`);
  } else {
    console.log(`\n--- Phase 2: Fetching detail pages (${opts.workers} worker${opts.workers > 1 ? 's' : ''}, max ${opts.rps} req/s) ---`);
    const t0 = Date.now();
    const { completed, errors } = await fetchDetailsParallel(db, uniqueAccounts, opts);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n  Detail fetch complete: ${completed} properties in ${elapsed}s (${errors} errors)`);
  }

  // Summary
  const propCount = db.prepare('SELECT COUNT(*) as c FROM properties').get().c;
  const ownerCount = db.prepare('SELECT COUNT(*) as c FROM owners').get().c;
  const salesCount = db.prepare('SELECT COUNT(*) as c FROM sales').get().c;
  const assessCount = db.prepare('SELECT COUNT(*) as c FROM assessments').get().c;

  console.log(`\n--- Summary ---`);
  console.log(`  Database: ${opts.db}`);
  console.log(`  Properties: ${propCount}`);
  console.log(`  Owners: ${ownerCount}`);
  console.log(`  Assessments: ${assessCount}`);
  console.log(`  Sales records: ${salesCount}`);
  console.log(`  Pages scraped: ${pageNum}`);

  db.close();
}

main().catch(err => { console.error(err); process.exit(1); });
