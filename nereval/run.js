// nereval/run.js — CLI scraper using the queue-based worker
//
// Now delegates to worker.js (runScrapeJob/runListCrawl/runDetailFetch)
// which uses the detail_queue and viewstates tables.

const { setProxy } = require('./fetch');
const { openDb, createJob, getJob, getQueueStats } = require('./db');
const { runScrapeJob } = require('./worker');

const HELP = `
Usage: node nereval/run.js [options]

Scrapes property data from data.nereval.com and stores it in SQLite.
Crawls the paginated list, then fetches each property's detail page.

Options:
  --town <name>     Town name (default: Providence)
  --pages <N|all>   Last page number to scrape (default: 3)
  --start <N>       First page to scrape (default: 1). Earlier pages are
                    fast-forwarded (fetched for viewstate but not extracted).
  --db <path>       SQLite database path (default: nereval-<town>.db)
  --workers <N>     Parallel workers for detail fetching (default: 1)
  --rps <N>         Max requests/second across all workers (default: 1)
  --proxy <url>     HTTP proxy URL (e.g. http://user:pass@host:port)
                    Also reads NEREVAL_PROXY or HTTPS_PROXY env vars.
  --mode <mode>     full (default), list_only, details_only
  --help, -h        Show this help message

Examples:
  node nereval/run.js                               # Providence, pages 1-3, 1 rps
  node nereval/run.js --pages 10                    # first 10 pages
  node nereval/run.js --pages all                   # all pages
  node nereval/run.js --start 3 --pages 7           # pages 3 through 7
  node nereval/run.js --workers 3 --rps 2           # 3 workers, max 2 req/s
  node nereval/run.js --mode list_only --pages all  # list crawl only, populate queue
  node nereval/run.js --mode details_only           # fetch pending details from queue
  node nereval/run.js --town Cranston --pages 5     # different town
  node nereval/run.js --proxy http://user:pass@proxy:8000  # via proxy
`.trim();

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP);
    process.exit(0);
  }
  const opts = { town: 'Providence', pages: 3, start: 1, db: null, workers: 1, rps: 1, proxy: null, mode: 'full' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--town') opts.town = args[++i];
    else if (args[i] === '--pages') opts.pages = args[i + 1] === 'all' ? Infinity : parseInt(args[++i]);
    else if (args[i] === '--start') opts.start = parseInt(args[++i]);
    else if (args[i] === '--db') opts.db = args[++i];
    else if (args[i] === '--workers') opts.workers = parseInt(args[++i]);
    else if (args[i] === '--rps') opts.rps = parseFloat(args[++i]);
    else if (args[i] === '--proxy') opts.proxy = args[++i];
    else if (args[i] === '--mode') opts.mode = args[++i];
    // Legacy compat
    else if (args[i] === '--no-details') opts.mode = 'list_only';
    else if (args[i] === '--delay') i++; // skip, no longer used
  }
  if (!opts.db) opts.db = `nereval-${opts.town.toLowerCase()}.db`;
  return opts;
}

async function main() {
  const opts = parseArgs();

  // Configure proxy
  const proxyUrl = opts.proxy || process.env.NEREVAL_PROXY || process.env.HTTPS_PROXY || null;
  if (proxyUrl) {
    console.log(`Using proxy: ${proxyUrl.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@')}`);
  }

  const pagesLabel = opts.pages === Infinity ? 'all' : opts.pages;
  const workerLabel = opts.workers > 1 ? `, ${opts.workers} workers @ ${opts.rps} rps` : '';
  const proxyLabel = proxyUrl ? ', via proxy' : '';
  console.log(`Scraping nereval: town=${opts.town}, mode=${opts.mode}, pages=${opts.start}-${pagesLabel}, db=${opts.db}${workerLabel}${proxyLabel}`);

  const db = openDb(opts.db);

  // Create a job record
  const jobId = createJob(db, {
    town: opts.town,
    startPage: opts.start,
    endPage: opts.pages === Infinity ? -1 : opts.pages,
    workers: opts.workers,
    rps: opts.rps,
    useProxy: !!proxyUrl,
    mode: opts.mode,
  });

  const job = getJob(db, jobId);
  const { emitter, promise } = runScrapeJob(db, job, { proxyUrl });

  // Log events to console
  emitter.on('status', (d) => {
    if (d.phase === 'details') {
      console.log(`\n--- Phase 2: Fetching details (${d.details_total || '?'} pending) ---`);
    } else if (d.status === 'fast-forwarding') {
      console.log(`  Fast-forwarding to page ${d.target_page}...`);
    } else if (typeof d.status === 'string' && d.status.startsWith('using cached')) {
      console.log(`  ${d.status}`);
    }
  });

  emitter.on('page', (d) => {
    console.log(`  Page ${d.page}: ${d.rows} properties (total: ${d.totalRows}, queued: ${d.enqueued || 0})`);
  });

  emitter.on('detail', (d) => {
    console.log(`  [${d.seq}/${d.total}] ${d.account} ${d.location}... OK (${d.sales} sales, ${d.priorYears} prior years)`);
  });

  emitter.on('error', (d) => {
    if (d.fatal) {
      console.error(`FATAL: ${d.error}`);
    } else {
      console.log(`  ERROR ${d.account || ''}: ${d.error}`);
    }
  });

  emitter.on('done', (d) => {
    console.log(`\n--- ${d.status} in ${d.duration_s}s ---`);
  });

  await promise;

  // Summary
  const propCount = db.prepare('SELECT COUNT(*) as c FROM properties').get().c;
  const queueStats = getQueueStats(db);

  console.log(`\n--- Summary ---`);
  console.log(`  Database: ${opts.db}`);
  console.log(`  Properties: ${propCount}`);
  console.log(`  Queue: ${queueStats.pending} pending, ${queueStats.done} done, ${queueStats.failed} failed`);

  db.close();
}

main().catch(err => { console.error(err); process.exit(1); });
