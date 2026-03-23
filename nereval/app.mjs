// nereval/app.mjs — Combined property browser + scraper control server
//
// Usage: node nereval/app.mjs [--db nereval-providence.db] [--port 3000]
//
// Combines the read-only property browser with:
//   - Job queue: start/stop/retry scrape jobs
//   - SSE streaming: real-time progress for running jobs
//   - Config API: proxy URL, default rps/workers
//   - Scraper tab UI: job form, progress bar, history
//   - Settings modal: proxy config with test button

import express from 'express';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const {
  openDb, createJob, getJob, listJobs, updateJob, recoverJobs,
  getConfig, getConfigValue, setConfigBulk,
} = require_('./db');
const { runScrapeJob } = require_('./worker');
const { getProxyInfo } = require_('./fetch');

const __dirname = dirname(fileURLToPath(import.meta.url));

// Parse args
const args = process.argv.slice(2);
let dbPath = join(__dirname, 'nereval-providence.db');
let port = 3000;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--db') dbPath = args[++i];
  if (args[i] === '--port') port = parseInt(args[++i]);
}

const db = openDb(dbPath);

// Crash recovery: mark stale running jobs as failed
const recovered = recoverJobs(db);
if (recovered > 0) console.log(`Recovered ${recovered} stale job(s) from previous crash`);

const app = express();
app.use(express.json());

// ── Active job state ────────────────────────────────────────────────────────
let activeJob = null;  // { id, emitter, promise }
const sseClients = new Map(); // jobId -> Set<res>

// ── Scraper Control API ─────────────────────────────────────────────────────

// Start a new scrape job
app.post('/api/jobs/start', (req, res) => {
  // Don't allow starting if a job is already running
  const running = db.prepare("SELECT id FROM jobs WHERE status = 'running'").get();
  if (running) {
    return res.status(409).json({ error: 'A job is already running', job_id: running.id });
  }

  const {
    town = 'Providence',
    startPage = 1,
    endPage = 3,
    workers = 1,
    rps = 1,
    useProxy = false,
    noDetails = false,
  } = req.body || {};

  const jobId = createJob(db, {
    town,
    startPage: parseInt(startPage),
    endPage: endPage === 'all' ? -1 : parseInt(endPage),
    workers: parseInt(workers),
    rps: parseFloat(rps),
    useProxy: !!useProxy,
    noDetails: !!noDetails,
  });

  startJob(jobId);
  res.json({ job_id: jobId, status: 'queued' });
});

// List jobs
app.get('/api/jobs', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(listJobs(db, limit));
});

// Get single job
app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(db, parseInt(req.params.id));
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

// Stop a running job
app.post('/api/jobs/:id/stop', (req, res) => {
  const id = parseInt(req.params.id);
  if (activeJob && activeJob.id === id) {
    activeJob.emitter.abort();
    res.json({ ok: true, message: 'Cancellation requested' });
  } else {
    // If queued, just mark cancelled
    const job = getJob(db, id);
    if (job && job.status === 'queued') {
      updateJob(db, id, { status: 'cancelled', finished_at: new Date().toISOString() });
      res.json({ ok: true, message: 'Job cancelled' });
    } else {
      res.status(404).json({ error: 'Job not running' });
    }
  }
});

// Retry a failed/cancelled job
app.post('/api/jobs/:id/retry', (req, res) => {
  const id = parseInt(req.params.id);
  const job = getJob(db, id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status !== 'failed' && job.status !== 'cancelled') {
    return res.status(400).json({ error: 'Can only retry failed or cancelled jobs' });
  }

  // Create a new job with the same params
  const newId = createJob(db, {
    town: job.town,
    startPage: job.start_page,
    endPage: job.end_page,
    workers: job.workers,
    rps: job.rps,
    useProxy: !!job.use_proxy,
    noDetails: !!job.no_details,
  });

  const running = db.prepare("SELECT id FROM jobs WHERE status = 'running'").get();
  if (!running) startJob(newId);
  res.json({ job_id: newId, status: 'queued' });
});

// SSE stream for job progress
app.get('/api/jobs/:id/stream', (req, res) => {
  const id = parseInt(req.params.id);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Send current state immediately
  const job = getJob(db, id);
  if (job) {
    res.write(`event: status\ndata: ${JSON.stringify(job)}\n\n`);
    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      res.write(`event: done\ndata: ${JSON.stringify({ status: job.status })}\n\n`);
      res.end();
      return;
    }
  }

  // Register for live events
  if (!sseClients.has(id)) sseClients.set(id, new Set());
  sseClients.get(id).add(res);

  req.on('close', () => {
    const clients = sseClients.get(id);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) sseClients.delete(id);
    }
  });
});

function broadcastSSE(jobId, event, data) {
  const clients = sseClients.get(jobId);
  if (!clients) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    res.write(msg);
  }
}

function startJob(jobId) {
  const job = getJob(db, jobId);
  if (!job) return;

  const proxyUrl = getConfigValue(db, 'proxy_url', null);
  const { emitter, promise } = runScrapeJob(db, job, { proxyUrl });

  activeJob = { id: jobId, emitter, promise };

  // Forward all events to SSE clients
  for (const evt of ['status', 'page', 'detail', 'error', 'done']) {
    emitter.on(evt, (data) => {
      broadcastSSE(jobId, evt, data);
    });
  }

  emitter.on('done', () => {
    activeJob = null;
    // Close SSE connections
    const clients = sseClients.get(jobId);
    if (clients) {
      const finalJob = getJob(db, jobId);
      for (const res of clients) {
        res.write(`event: done\ndata: ${JSON.stringify({ status: finalJob?.status || 'completed' })}\n\n`);
        res.end();
      }
      sseClients.delete(jobId);
    }
  });

  promise.catch(err => {
    console.error(`Job ${jobId} error:`, err.message);
  });
}

// ── Config API ──────────────────────────────────────────────────────────────

app.get('/api/config', (req, res) => {
  const cfg = getConfig(db);
  // Mask proxy password
  if (cfg.proxy_url) {
    cfg.proxy_url_masked = cfg.proxy_url.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
  }
  res.json(cfg);
});

app.put('/api/config', (req, res) => {
  const allowed = ['proxy_url', 'default_rps', 'default_workers', 'default_town'];
  const updates = {};
  for (const k of allowed) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }
  setConfigBulk(db, updates);
  res.json({ ok: true, updated: Object.keys(updates) });
});

app.post('/api/config/proxy/test', async (req, res) => {
  const { proxy_url } = req.body || {};
  if (!proxy_url) return res.status(400).json({ error: 'proxy_url required' });

  try {
    const { HttpsProxyAgent } = await import('https-proxy-agent');
    const httpsModule = await import('https');
    const https = httpsModule.default || httpsModule;

    let url = proxy_url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) url = 'http://' + url;
    const agent = new HttpsProxyAgent(url);

    const t0 = Date.now();
    const result = await new Promise((resolve, reject) => {
      const testUrl = new globalThis.URL('https://httpbin.org/ip');
      const req = https.request({
        hostname: testUrl.hostname,
        port: 443,
        path: testUrl.pathname,
        method: 'GET',
        agent,
        timeout: 15000,
      }, (resp) => {
        const chunks = [];
        resp.on('data', c => chunks.push(c));
        resp.on('end', () => {
          resolve({
            ok: resp.statusCode >= 200 && resp.statusCode < 300,
            status: resp.statusCode,
            body: Buffer.concat(chunks).toString('utf-8'),
          });
        });
      });
      req.on('error', reject);
      req.setTimeout(15000, () => req.destroy(new Error('Timeout')));
      req.end();
    });

    const latency = Date.now() - t0;
    let ip = null;
    try { ip = JSON.parse(result.body).origin; } catch {}

    res.json({ ok: result.ok, status: result.status, latency_ms: latency, ip });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ── Data Browsing API (from browser.mjs) ────────────────────────────────────

app.get('/api/stats', (req, res) => {
  const stats = {
    properties: db.prepare('SELECT COUNT(*) as n FROM properties').get().n,
    owners: db.prepare('SELECT COUNT(DISTINCT owner_name) as n FROM owners').get().n,
    sales: db.prepare('SELECT COUNT(*) as n FROM sales').get().n,
    totalAssessedValue: db.prepare(`
      SELECT SUM(CAST(REPLACE(REPLACE(parcel_total, '$', ''), ',', '') AS INTEGER)) as total
      FROM assessments
    `).get().total || 0,
    avgAssessedValue: db.prepare(`
      SELECT AVG(CAST(REPLACE(REPLACE(parcel_total, '$', ''), ',', '') AS INTEGER)) as avg
      FROM assessments WHERE parcel_total <> ''
    `).get().avg || 0,
    buildingDesigns: db.prepare(`
      SELECT design, COUNT(*) as count FROM buildings
      WHERE design <> '' GROUP BY design ORDER BY count DESC
    `).all(),
    yearBuiltDistribution: db.prepare(`
      SELECT
        CASE
          WHEN CAST(year_built AS INTEGER) < 1850 THEN 'Pre-1850'
          WHEN CAST(year_built AS INTEGER) < 1900 THEN '1850-1899'
          WHEN CAST(year_built AS INTEGER) < 1950 THEN '1900-1949'
          WHEN CAST(year_built AS INTEGER) < 2000 THEN '1950-1999'
          ELSE '2000+'
        END as era,
        COUNT(*) as count
      FROM buildings WHERE year_built <> '' AND CAST(year_built AS INTEGER) > 0
      GROUP BY era ORDER BY era
    `).all(),
  };
  res.json(stats);
});

app.get('/api/landlords', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const minProperties = parseInt(req.query.min) || 2;
  const landlords = db.prepare(`
    SELECT
      o.owner_name,
      COUNT(DISTINCT o.account_number) as property_count,
      GROUP_CONCAT(DISTINCT p.location) as locations,
      SUM(CAST(REPLACE(REPLACE(a.parcel_total, '$', ''), ',', '') AS INTEGER)) as total_assessed
    FROM owners o
    JOIN properties p ON o.account_number = p.account_number
    LEFT JOIN assessments a ON o.account_number = a.account_number
    GROUP BY o.owner_name
    HAVING COUNT(DISTINCT o.account_number) >= ?
    ORDER BY property_count DESC, total_assessed DESC
    LIMIT ?
  `).all(minProperties, limit);
  res.json(landlords);
});

app.get('/api/properties', (req, res) => {
  const { search, sort, order, limit: lim, offset: off, minValue, maxValue, design } = req.query;
  const limit = parseInt(lim) || 50;
  const offset = parseInt(off) || 0;
  const sortCol = { location: 'p.location', value: 'assessed_value', year: 'b.year_built', area: 'area_num' }[sort] || 'p.location';
  const sortOrder = order === 'desc' ? 'DESC' : 'ASC';

  let where = ['1=1'];
  const params = [];

  if (search) {
    where.push("(p.location LIKE ? OR o_agg.owners LIKE ? OR p.account_number LIKE ?)");
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (minValue) {
    where.push("CAST(REPLACE(REPLACE(a.parcel_total, '$', ''), ',', '') AS INTEGER) >= ?");
    params.push(parseInt(minValue));
  }
  if (maxValue) {
    where.push("CAST(REPLACE(REPLACE(a.parcel_total, '$', ''), ',', '') AS INTEGER) <= ?");
    params.push(parseInt(maxValue));
  }
  if (design) {
    where.push("b.design = ?");
    params.push(design);
  }

  const sql = `
    SELECT
      p.account_number, p.location, p.map_lot,
      a.parcel_total as assessed_value, a.land_value, a.building_value,
      CAST(REPLACE(REPLACE(a.parcel_total, '$', ''), ',', '') AS INTEGER) as value_num,
      b.design, b.year_built, b.rooms, b.bedrooms, b.bathrooms, b.above_grade_area,
      CAST(REPLACE(REPLACE(b.above_grade_area, ' SF', ''), ',', '') AS INTEGER) as area_num,
      l.land_area, o_agg.owners,
      (SELECT COUNT(*) FROM sales s WHERE s.account_number = p.account_number) as sale_count
    FROM properties p
    LEFT JOIN assessments a ON p.account_number = a.account_number
    LEFT JOIN buildings b ON p.account_number = b.account_number
    LEFT JOIN land l ON p.account_number = l.account_number
    LEFT JOIN (
      SELECT account_number, GROUP_CONCAT(owner_name, '; ') as owners
      FROM owners GROUP BY account_number
    ) o_agg ON p.account_number = o_agg.account_number
    WHERE ${where.join(' AND ')}
    ORDER BY ${sortCol} ${sortOrder}
    LIMIT ? OFFSET ?
  `;
  params.push(limit, offset);
  const rows = db.prepare(sql).all(...params);

  const countSql = `
    SELECT COUNT(*) as total
    FROM properties p
    LEFT JOIN assessments a ON p.account_number = a.account_number
    LEFT JOIN buildings b ON p.account_number = b.account_number
    LEFT JOIN (
      SELECT account_number, GROUP_CONCAT(owner_name, '; ') as owners
      FROM owners GROUP BY account_number
    ) o_agg ON p.account_number = o_agg.account_number
    WHERE ${where.join(' AND ')}
  `;
  const total = db.prepare(countSql).get(...params.slice(0, -2)).total;
  res.json({ rows, total, limit, offset });
});

app.get('/api/property/:accountNumber', (req, res) => {
  const acct = req.params.accountNumber;
  const property = db.prepare('SELECT * FROM properties WHERE account_number = ?').get(acct);
  if (!property) return res.status(404).json({ error: 'Not found' });

  const owners = db.prepare('SELECT owner_name FROM owners WHERE account_number = ?').all(acct);
  const assessment = db.prepare('SELECT * FROM assessments WHERE account_number = ?').get(acct);
  const priorAssessments = db.prepare('SELECT * FROM prior_assessments WHERE account_number = ? ORDER BY fiscal_year DESC').all(acct);
  const building = db.prepare('SELECT * FROM buildings WHERE account_number = ?').get(acct);
  const sales = db.prepare('SELECT * FROM sales WHERE account_number = ? ORDER BY sale_date DESC').all(acct);
  const subAreas = db.prepare('SELECT * FROM sub_areas WHERE account_number = ?').all(acct);
  const land = db.prepare('SELECT * FROM land WHERE account_number = ?').get(acct);
  const mailing = db.prepare('SELECT * FROM mailing_addresses WHERE account_number = ?').get(acct);

  res.json({ property, owners, assessment, priorAssessments, building, sales, subAreas, land, mailing });
});

app.get('/api/biggest', (req, res) => {
  const by = req.query.by || 'value';
  const limit = parseInt(req.query.limit) || 20;

  let sql;
  if (by === 'area') {
    sql = `
      SELECT p.account_number, p.location, a.parcel_total, b.above_grade_area, b.design, b.year_built,
        CAST(REPLACE(REPLACE(b.above_grade_area, ' SF', ''), ',', '') AS INTEGER) as area_num, o_agg.owners
      FROM properties p
      JOIN buildings b ON p.account_number = b.account_number
      LEFT JOIN assessments a ON p.account_number = a.account_number
      LEFT JOIN (SELECT account_number, GROUP_CONCAT(owner_name, '; ') as owners FROM owners GROUP BY account_number) o_agg ON p.account_number = o_agg.account_number
      WHERE b.above_grade_area <> '' ORDER BY area_num DESC LIMIT ?
    `;
  } else if (by === 'units') {
    sql = `
      SELECT p.account_number, p.location, a.parcel_total, b.design, b.year_built, b.above_grade_area, b.bathrooms, b.rooms, o_agg.owners
      FROM properties p
      JOIN buildings b ON p.account_number = b.account_number
      LEFT JOIN assessments a ON p.account_number = a.account_number
      LEFT JOIN (SELECT account_number, GROUP_CONCAT(owner_name, '; ') as owners FROM owners GROUP BY account_number) o_agg ON p.account_number = o_agg.account_number
      WHERE b.design LIKE '%Family%' OR b.design LIKE '%Apt%' OR b.design LIKE '%Multi%' OR b.design LIKE '%Duplex%' OR b.design LIKE '%Triple%'
      ORDER BY CAST(REPLACE(REPLACE(a.parcel_total, '$', ''), ',', '') AS INTEGER) DESC LIMIT ?
    `;
  } else {
    sql = `
      SELECT p.account_number, p.location, a.parcel_total,
        CAST(REPLACE(REPLACE(a.parcel_total, '$', ''), ',', '') AS INTEGER) as value_num,
        b.design, b.year_built, b.above_grade_area, o_agg.owners
      FROM properties p
      JOIN assessments a ON p.account_number = a.account_number
      LEFT JOIN buildings b ON p.account_number = b.account_number
      LEFT JOIN (SELECT account_number, GROUP_CONCAT(owner_name, '; ') as owners FROM owners GROUP BY account_number) o_agg ON p.account_number = o_agg.account_number
      ORDER BY value_num DESC LIMIT ?
    `;
  }
  res.json(db.prepare(sql).all(limit));
});

app.get('/api/histogram', (req, res) => {
  const bucketSize = parseInt(req.query.bucket) || 100000;
  const rows = db.prepare(`
    SELECT
      (CAST(REPLACE(REPLACE(parcel_total, '$', ''), ',', '') AS INTEGER) / ?) * ? as bucket_start,
      COUNT(*) as count
    FROM assessments WHERE parcel_total <> ''
    GROUP BY bucket_start ORDER BY bucket_start
  `).all(bucketSize, bucketSize);
  res.json({ bucketSize, rows });
});

// ── HTML UI ─────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.type('html').send(HTML);
});

app.listen(port, () => {
  console.log(`Nereval App running at http://localhost:${port}`);
  console.log(`Database: ${dbPath}`);
});

// ── Inline HTML ─────────────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nereval Property Scraper</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #0f1117; color: #e1e4e8; line-height: 1.5; }
  a { color: #58a6ff; text-decoration: none; }
  a:hover { text-decoration: underline; }

  .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
  header { background: #161b22; border-bottom: 1px solid #30363d; padding: 16px 0; margin-bottom: 24px; display: flex; align-items: center; }
  header .inner { max-width: 1200px; margin: 0 auto; padding: 0 20px; width: 100%; display: flex; justify-content: space-between; align-items: center; }
  header h1 { font-size: 20px; font-weight: 600; }
  header h1 span { color: #8b949e; font-weight: 400; }
  .settings-btn { background: #21262d; border: 1px solid #30363d; color: #8b949e; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; }
  .settings-btn:hover { color: #e1e4e8; border-color: #58a6ff; }

  /* Stats cards */
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .stat-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; }
  .stat-card .label { font-size: 12px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; }
  .stat-card .value { font-size: 28px; font-weight: 700; color: #f0f6fc; margin-top: 4px; }
  .stat-card .value.money { color: #3fb950; }

  /* Tabs */
  .tabs { display: flex; gap: 4px; margin-bottom: 20px; border-bottom: 1px solid #30363d; }
  .tab { padding: 8px 16px; cursor: pointer; border-bottom: 2px solid transparent; color: #8b949e; font-size: 14px; }
  .tab:hover { color: #e1e4e8; }
  .tab.active { color: #f0f6fc; border-bottom-color: #f78166; }
  .tab-content { display: none; }
  .tab-content.active { display: block; }

  /* Tables */
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: #161b22; color: #8b949e; font-weight: 600; text-align: left; padding: 8px 12px; border-bottom: 1px solid #30363d; position: sticky; top: 0; cursor: pointer; user-select: none; }
  th:hover { color: #f0f6fc; }
  td { padding: 8px 12px; border-bottom: 1px solid #21262d; }
  tr:hover td { background: #161b22; }
  .text-right { text-align: right; }
  .text-mono { font-family: 'SF Mono', Consolas, monospace; font-size: 12px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
  .badge-blue { background: #1f3a5f; color: #58a6ff; }
  .badge-green { background: #1a3a2a; color: #3fb950; }
  .badge-orange { background: #3d2e00; color: #d29922; }
  .badge-red { background: #3d1418; color: #f85149; }
  .badge-purple { background: #2d1f4e; color: #bc8cff; }

  /* Search */
  .search-bar { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
  .search-bar input, .search-bar select { background: #0d1117; border: 1px solid #30363d; color: #e1e4e8; padding: 8px 12px; border-radius: 6px; font-size: 14px; }
  .search-bar input:focus, .search-bar select:focus { border-color: #58a6ff; outline: none; }
  .search-bar input[type="text"] { flex: 1; min-width: 200px; }
  .search-bar button, .btn { background: #238636; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 14px; }
  .search-bar button:hover, .btn:hover { background: #2ea043; }
  .btn-danger { background: #da3633; }
  .btn-danger:hover { background: #f85149; }
  .btn-secondary { background: #21262d; color: #e1e4e8; border: 1px solid #30363d; }
  .btn-secondary:hover { background: #30363d; }
  .btn-sm { padding: 4px 10px; font-size: 12px; }

  /* Charts */
  .chart-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
  .chart-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; }
  .chart-card h3 { font-size: 14px; color: #8b949e; margin-bottom: 12px; }
  .bar-chart { display: flex; flex-direction: column; gap: 4px; }
  .bar-row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .bar-label { width: 100px; text-align: right; color: #8b949e; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-fill { height: 20px; background: #1f6feb; border-radius: 3px; min-width: 2px; transition: width 0.3s; }
  .bar-value { color: #8b949e; font-size: 11px; flex-shrink: 0; }

  /* Detail panel */
  .detail-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); z-index: 100; }
  .detail-overlay.active { display: flex; justify-content: center; align-items: flex-start; padding: 40px 20px; overflow-y: auto; }
  .detail-panel { background: #161b22; border: 1px solid #30363d; border-radius: 12px; max-width: 800px; width: 100%; padding: 24px; }
  .detail-panel h2 { font-size: 18px; margin-bottom: 16px; }
  .detail-section { margin-bottom: 16px; }
  .detail-section h4 { font-size: 13px; color: #f78166; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
  .detail-grid { display: grid; grid-template-columns: 140px 1fr; gap: 4px 12px; font-size: 13px; }
  .detail-grid .dl { color: #8b949e; }
  .close-btn { float: right; background: none; border: none; color: #8b949e; font-size: 20px; cursor: pointer; padding: 4px 8px; }
  .close-btn:hover { color: #f0f6fc; }

  /* Scraper tab */
  .job-form { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
  .job-form h3 { font-size: 15px; margin-bottom: 12px; color: #f0f6fc; }
  .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 16px; }
  .form-group { display: flex; flex-direction: column; gap: 4px; }
  .form-group label { font-size: 12px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; }
  .form-group input, .form-group select { background: #0d1117; border: 1px solid #30363d; color: #e1e4e8; padding: 8px 12px; border-radius: 6px; font-size: 14px; }
  .form-group input:focus, .form-group select:focus { border-color: #58a6ff; outline: none; }
  .form-actions { display: flex; gap: 8px; align-items: center; }

  /* Progress bar */
  .progress-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 20px; margin-bottom: 20px; display: none; }
  .progress-card.active { display: block; }
  .progress-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
  .progress-header h3 { font-size: 15px; }
  .progress-bar-outer { background: #21262d; border-radius: 4px; height: 8px; margin-bottom: 8px; overflow: hidden; }
  .progress-bar-inner { background: #1f6feb; height: 100%; border-radius: 4px; transition: width 0.3s; width: 0%; }
  .progress-bar-inner.done { background: #3fb950; }
  .progress-bar-inner.error { background: #f85149; }
  .progress-stats { display: flex; gap: 20px; font-size: 13px; color: #8b949e; }
  .progress-stats .num { color: #f0f6fc; font-weight: 600; }
  .progress-log { max-height: 200px; overflow-y: auto; font-family: 'SF Mono', Consolas, monospace; font-size: 12px; background: #0d1117; border: 1px solid #21262d; border-radius: 6px; padding: 8px; margin-top: 12px; color: #8b949e; }
  .progress-log .log-ok { color: #3fb950; }
  .progress-log .log-err { color: #f85149; }

  /* Settings modal */
  .modal-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); z-index: 200; }
  .modal-overlay.active { display: flex; justify-content: center; align-items: flex-start; padding: 80px 20px; }
  .modal { background: #161b22; border: 1px solid #30363d; border-radius: 12px; max-width: 500px; width: 100%; padding: 24px; }
  .modal h2 { font-size: 18px; margin-bottom: 16px; }
  .modal .form-group { margin-bottom: 12px; }
  .modal-actions { display: flex; gap: 8px; margin-top: 16px; }
  .proxy-test-result { font-size: 13px; margin-top: 8px; padding: 8px; border-radius: 6px; }
  .proxy-test-result.ok { background: #1a3a2a; color: #3fb950; }
  .proxy-test-result.fail { background: #3d1418; color: #f85149; }

  @media (max-width: 768px) {
    .chart-row { grid-template-columns: 1fr; }
    .stats-grid { grid-template-columns: repeat(2, 1fr); }
    .form-grid { grid-template-columns: 1fr 1fr; }
  }
</style>
</head>
<body>
<header>
  <div class="inner">
    <h1>Nereval Property Scraper <span>Providence, RI</span></h1>
    <button class="settings-btn" onclick="openSettings()">Settings</button>
  </div>
</header>

<div class="container">
  <div class="stats-grid" id="stats-grid"></div>
  <div class="chart-row" id="charts"></div>

  <div class="tabs">
    <div class="tab active" data-tab="properties">Properties</div>
    <div class="tab" data-tab="landlords">Top Landlords</div>
    <div class="tab" data-tab="biggest">Biggest</div>
    <div class="tab" data-tab="scraper">Scraper</div>
  </div>

  <div class="tab-content active" id="tab-properties">
    <div class="search-bar">
      <input type="text" id="search" placeholder="Search address, owner, or account #...">
      <select id="design-filter"><option value="">All designs</option></select>
      <select id="sort-select">
        <option value="location">Sort: Location</option>
        <option value="value-desc">Sort: Value (high)</option>
        <option value="value-asc">Sort: Value (low)</option>
        <option value="year">Sort: Year Built</option>
        <option value="area-desc">Sort: Area (large)</option>
      </select>
      <button onclick="loadProperties()">Search</button>
    </div>
    <div id="properties-table"></div>
  </div>

  <div class="tab-content" id="tab-landlords">
    <div id="landlords-table"></div>
  </div>

  <div class="tab-content" id="tab-biggest">
    <div class="search-bar">
      <select id="biggest-by" onchange="loadBiggest()">
        <option value="value">By Assessed Value</option>
        <option value="area">By Living Area</option>
        <option value="units">Multi-Family / Big Units</option>
      </select>
    </div>
    <div id="biggest-table"></div>
  </div>

  <div class="tab-content" id="tab-scraper">
    <!-- New Job Form -->
    <div class="job-form" id="job-form">
      <h3>Start New Scrape Job</h3>
      <div class="form-grid">
        <div class="form-group">
          <label>Town</label>
          <input type="text" id="job-town" value="Providence">
        </div>
        <div class="form-group">
          <label>Start Page</label>
          <input type="number" id="job-start" value="1" min="1">
        </div>
        <div class="form-group">
          <label>End Page</label>
          <input type="text" id="job-end" value="3" placeholder="3 or 'all'">
        </div>
        <div class="form-group">
          <label>Workers</label>
          <input type="number" id="job-workers" value="1" min="1" max="10">
        </div>
        <div class="form-group">
          <label>Requests/sec</label>
          <input type="number" id="job-rps" value="1" min="0.1" max="10" step="0.1">
        </div>
        <div class="form-group">
          <label>Options</label>
          <select id="job-options">
            <option value="full">Full (list + details)</option>
            <option value="list-only">List only (no details)</option>
          </select>
        </div>
      </div>
      <div class="form-actions">
        <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#8b949e">
          <input type="checkbox" id="job-proxy"> Use proxy
        </label>
        <button class="btn" onclick="startJob()" style="margin-left:auto">Start Scraping</button>
      </div>
    </div>

    <!-- Live Progress -->
    <div class="progress-card" id="progress-card">
      <div class="progress-header">
        <h3 id="progress-title">Scraping...</h3>
        <button class="btn btn-danger btn-sm" id="stop-btn" onclick="stopJob()">Stop</button>
      </div>
      <div class="progress-bar-outer"><div class="progress-bar-inner" id="progress-bar"></div></div>
      <div class="progress-stats" id="progress-stats"></div>
      <div class="progress-log" id="progress-log"></div>
    </div>

    <!-- Job History -->
    <h3 style="font-size:15px;margin-bottom:12px;color:#8b949e">Job History</h3>
    <div id="jobs-table"></div>
  </div>
</div>

<!-- Property Detail Modal -->
<div class="detail-overlay" id="detail-overlay" onclick="if(event.target===this)closeDetail()">
  <div class="detail-panel" id="detail-panel"></div>
</div>

<!-- Settings Modal -->
<div class="modal-overlay" id="settings-modal" onclick="if(event.target===this)closeSettings()">
  <div class="modal">
    <button class="close-btn" onclick="closeSettings()" style="float:right">&times;</button>
    <h2>Settings</h2>
    <div class="form-group">
      <label>Proxy URL</label>
      <input type="text" id="cfg-proxy" placeholder="http://user:pass@host:port" style="width:100%">
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-sm btn-secondary" onclick="testProxy()">Test Proxy</button>
        <span id="proxy-test-result"></span>
      </div>
    </div>
    <div class="form-group" style="margin-top:12px">
      <label>Default Town</label>
      <input type="text" id="cfg-town" value="Providence" style="width:100%">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
      <div class="form-group">
        <label>Default Workers</label>
        <input type="number" id="cfg-workers" value="1" min="1" max="10" style="width:100%">
      </div>
      <div class="form-group">
        <label>Default RPS</label>
        <input type="number" id="cfg-rps" value="1" min="0.1" max="10" step="0.1" style="width:100%">
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn" onclick="saveSettings()">Save</button>
      <button class="btn btn-secondary" onclick="closeSettings()">Cancel</button>
    </div>
  </div>
</div>

<script>
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const fmt = n => n ? '$' + Number(n).toLocaleString() : '\\u2014';
const fmtN = n => n ? Number(n).toLocaleString() : '\\u2014';

// \\u2500\\u2500 Tabs \\u2500\\u2500
$$('.tab').forEach(t => t.addEventListener('click', () => {
  $$('.tab').forEach(x => x.classList.remove('active'));
  $$('.tab-content').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  $('#tab-' + t.dataset.tab).classList.add('active');
  if (t.dataset.tab === 'scraper') loadJobs();
}));

// \\u2500\\u2500 Stats \\u2500\\u2500
function loadStats() {
  fetch('/api/stats').then(r => r.json()).then(s => {
    $('#stats-grid').innerHTML = [
      card('Properties', fmtN(s.properties)),
      card('Owners', fmtN(s.owners)),
      card('Sales Records', fmtN(s.sales)),
      card('Total Assessed', fmt(s.totalAssessedValue), 'money'),
      card('Avg Assessed', fmt(Math.round(s.avgAssessedValue)), 'money'),
    ].join('');

    const maxDesign = Math.max(...s.buildingDesigns.map(d => d.count));
    const maxYear = Math.max(...s.yearBuiltDistribution.map(d => d.count));
    $('#charts').innerHTML =
      chartCard('Building Design', s.buildingDesigns.map(d => barRow(d.design, d.count, maxDesign)).join('')) +
      chartCard('Year Built', s.yearBuiltDistribution.map(d => barRow(d.era, d.count, maxYear)).join(''));

    const sel = $('#design-filter');
    const existing = new Set([...sel.options].map(o => o.value));
    s.buildingDesigns.forEach(d => {
      if (!existing.has(d.design)) {
        const opt = document.createElement('option');
        opt.value = d.design; opt.textContent = d.design + ' (' + d.count + ')';
        sel.appendChild(opt);
      }
    });
  });
}

function card(label, value, cls = '') {
  return '<div class="stat-card"><div class="label">' + label + '</div><div class="value ' + cls + '">' + value + '</div></div>';
}
function chartCard(title, bars) {
  return '<div class="chart-card"><h3>' + title + '</h3><div class="bar-chart">' + bars + '</div></div>';
}
function barRow(label, value, max) {
  const pct = (value / max * 100).toFixed(0);
  return '<div class="bar-row"><span class="bar-label" title="' + label + '">' + label + '</span><div class="bar-fill" style="width:' + pct + '%"></div><span class="bar-value">' + value + '</span></div>';
}

// \\u2500\\u2500 Properties \\u2500\\u2500
function loadProperties() {
  const search = $('#search').value;
  const design = $('#design-filter').value;
  const sortVal = $('#sort-select').value;
  const [sort, order] = sortVal.includes('-') ? sortVal.split('-') : [sortVal, 'asc'];
  const params = new URLSearchParams({ search, sort, order, design, limit: 100 });
  fetch('/api/properties?' + params).then(r => r.json()).then(d => {
    $('#properties-table').innerHTML = '<table><thead><tr>' +
      '<th>Location</th><th>Owner(s)</th><th class="text-right">Assessed</th><th>Design</th><th>Year</th><th class="text-right">Area</th><th>Sales</th>' +
      '</tr></thead><tbody>' +
      d.rows.map(r => '<tr onclick="showDetail(\\'' + r.account_number + '\\')" style="cursor:pointer">' +
        '<td><strong>' + (r.location || '') + '</strong><br><span class="text-mono" style="color:#8b949e">' + (r.account_number || '') + '</span></td>' +
        '<td>' + (r.owners || '').split('; ').slice(0, 2).join('<br>') + (r.owners && r.owners.split('; ').length > 2 ? '<br><span style="color:#8b949e">+' + (r.owners.split('; ').length - 2) + ' more</span>' : '') + '</td>' +
        '<td class="text-right text-mono" style="color:#3fb950">' + (r.assessed_value || '\\u2014') + '</td>' +
        '<td><span class="badge badge-blue">' + (r.design || '\\u2014') + '</span></td>' +
        '<td>' + (r.year_built || '\\u2014') + '</td>' +
        '<td class="text-right text-mono">' + (r.above_grade_area || '\\u2014') + '</td>' +
        '<td class="text-right">' + (r.sale_count || 0) + '</td>' +
        '</tr>').join('') +
      '</tbody></table>' +
      '<p style="margin-top:12px;color:#8b949e;font-size:12px">Showing ' + d.rows.length + ' of ' + d.total + ' properties</p>';
  });
}

// \\u2500\\u2500 Landlords \\u2500\\u2500
function loadLandlords() {
  fetch('/api/landlords?min=1&limit=100').then(r => r.json()).then(data => {
    $('#landlords-table').innerHTML = '<table><thead><tr>' +
      '<th>Owner</th><th class="text-right">Properties</th><th class="text-right">Total Assessed</th><th>Locations</th>' +
      '</tr></thead><tbody>' +
      data.map(r => '<tr>' +
        '<td><strong>' + r.owner_name + '</strong></td>' +
        '<td class="text-right"><span class="badge ' + (r.property_count >= 3 ? 'badge-orange' : 'badge-green') + '">' + r.property_count + '</span></td>' +
        '<td class="text-right text-mono" style="color:#3fb950">' + fmt(r.total_assessed) + '</td>' +
        '<td style="font-size:12px;color:#8b949e">' + (r.locations || '').split(',').join(', ') + '</td>' +
        '</tr>').join('') +
      '</tbody></table>';
  });
}

// \\u2500\\u2500 Biggest \\u2500\\u2500
function loadBiggest() {
  const by = $('#biggest-by').value;
  fetch('/api/biggest?by=' + by + '&limit=30').then(r => r.json()).then(data => {
    $('#biggest-table').innerHTML = '<table><thead><tr>' +
      '<th>Location</th><th>Owner(s)</th><th class="text-right">Assessed</th><th>Design</th><th>Year</th><th class="text-right">Area</th>' +
      '</tr></thead><tbody>' +
      data.map(r => '<tr onclick="showDetail(\\'' + r.account_number + '\\')" style="cursor:pointer">' +
        '<td><strong>' + (r.location || '') + '</strong></td>' +
        '<td style="font-size:12px">' + (r.owners || '').split('; ').slice(0, 2).join(', ') + '</td>' +
        '<td class="text-right text-mono" style="color:#3fb950">' + (r.parcel_total || '\\u2014') + '</td>' +
        '<td><span class="badge badge-blue">' + (r.design || '\\u2014') + '</span></td>' +
        '<td>' + (r.year_built || '\\u2014') + '</td>' +
        '<td class="text-right text-mono">' + (r.above_grade_area || '\\u2014') + '</td>' +
        '</tr>').join('') +
      '</tbody></table>';
  });
}

// \\u2500\\u2500 Property Detail Modal \\u2500\\u2500
function showDetail(acct) {
  fetch('/api/property/' + acct).then(r => r.json()).then(d => {
    const p = d.property, a = d.assessment || {}, b = d.building || {}, l = d.land || {};
    let html = '<button class="close-btn" onclick="closeDetail()">&times;</button>';
    html += '<h2>' + (p.location || acct) + '</h2>';
    html += section('Parcel', grid({ 'Account': p.account_number, 'Map/Lot': p.map_lot, 'State Code': p.state_code, 'Card': p.card }));
    html += section('Owners', d.owners.map(o => o.owner_name).join('<br>'));
    html += section('Assessment', grid({ 'Land': a.land_value, 'Building': a.building_value, 'Card Total': a.card_total, 'Parcel Total': a.parcel_total }));
    if (d.priorAssessments.length) {
      html += section('Assessment History',
        '<table style="width:100%"><thead><tr><th>Year</th><th class="text-right">Land</th><th class="text-right">Building</th><th class="text-right">Total</th></tr></thead><tbody>' +
        d.priorAssessments.map(pa => '<tr><td>' + pa.fiscal_year + '</td><td class="text-right">' + pa.land_value + '</td><td class="text-right">' + pa.building_value + '</td><td class="text-right" style="color:#3fb950">' + pa.total_value + '</td></tr>').join('') +
        '</tbody></table>');
    }
    html += section('Building', grid({ 'Design': b.design, 'Year Built': b.year_built, 'Heat': b.heat, 'Fireplaces': b.fireplaces, 'Rooms': b.rooms, 'Bedrooms': b.bedrooms, 'Bathrooms': b.bathrooms, 'Living Area': b.above_grade_area }));
    if (d.sales.length) {
      html += section('Sales History',
        '<table style="width:100%"><thead><tr><th>Date</th><th class="text-right">Price</th><th>Ref</th><th>Instrument</th></tr></thead><tbody>' +
        d.sales.map(s => '<tr><td>' + s.sale_date + '</td><td class="text-right" style="color:#3fb950">' + s.sale_price + '</td><td class="text-mono">' + s.legal_reference + '</td><td>' + s.instrument + '</td></tr>').join('') +
        '</tbody></table>');
    }
    if (d.subAreas.length) {
      html += section('Building Sub Areas',
        d.subAreas.map(sa => '<div style="display:flex;justify-content:space-between;font-size:13px;padding:2px 0"><span>' + sa.sub_area + '</span><span class="text-mono">' + sa.net_area + '</span></div>').join(''));
    }
    html += section('Land', grid({ 'Area': l?.land_area, 'Neighborhood': l?.neighborhood }));
    $('#detail-panel').innerHTML = html;
    $('#detail-overlay').classList.add('active');
  });
}
function closeDetail() { $('#detail-overlay').classList.remove('active'); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDetail(); closeSettings(); }});
function section(title, content) {
  return '<div class="detail-section"><h4>' + title + '</h4>' + content + '</div>';
}
function grid(obj) {
  return '<div class="detail-grid">' + Object.entries(obj).filter(([,v]) => v).map(([k,v]) => '<span class="dl">' + k + '</span><span>' + v + '</span>').join('') + '</div>';
}

// \\u2500\\u2500 Scraper \\u2500\\u2500
let currentJobId = null;
let eventSource = null;

function startJob() {
  const body = {
    town: $('#job-town').value,
    startPage: parseInt($('#job-start').value),
    endPage: $('#job-end').value === 'all' ? 'all' : parseInt($('#job-end').value),
    workers: parseInt($('#job-workers').value),
    rps: parseFloat($('#job-rps').value),
    useProxy: $('#job-proxy').checked,
    noDetails: $('#job-options').value === 'list-only',
  };

  fetch('/api/jobs/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(r => r.json())
    .then(d => {
      if (d.error) { alert(d.error); return; }
      currentJobId = d.job_id;
      showProgress(d.job_id);
      loadJobs();
    });
}

function showProgress(jobId) {
  const card = $('#progress-card');
  card.classList.add('active');
  $('#progress-title').textContent = 'Job #' + jobId + ' \\u2014 Starting...';
  $('#progress-bar').style.width = '0%';
  $('#progress-bar').className = 'progress-bar-inner';
  $('#progress-stats').innerHTML = '';
  $('#progress-log').innerHTML = '';
  $('#stop-btn').style.display = '';

  if (eventSource) eventSource.close();
  eventSource = new EventSource('/api/jobs/' + jobId + '/stream');

  eventSource.addEventListener('status', e => {
    const d = JSON.parse(e.data);
    if (d.phase === 'details') {
      $('#progress-title').textContent = 'Job #' + jobId + ' \\u2014 Fetching details...';
    } else if (d.status === 'fast-forwarding') {
      $('#progress-title').textContent = 'Job #' + jobId + ' \\u2014 Fast-forwarding to page ' + d.target_page + '...';
    } else {
      $('#progress-title').textContent = 'Job #' + jobId + ' \\u2014 Running';
    }
    updateProgressStats(d);
  });

  eventSource.addEventListener('page', e => {
    const d = JSON.parse(e.data);
    addLog('Page ' + d.page + ': ' + d.rows + ' properties (total: ' + d.totalRows + ')', 'ok');
  });

  eventSource.addEventListener('detail', e => {
    const d = JSON.parse(e.data);
    const pct = d.total > 0 ? ((d.seq / d.total) * 100).toFixed(0) : 0;
    $('#progress-bar').style.width = pct + '%';
    $('#progress-stats').innerHTML =
      '<span>Details: <span class="num">' + d.seq + '/' + d.total + '</span></span>' +
      '<span>Current: <span class="num">' + d.location + '</span></span>';
    if (d.seq % 5 === 0 || d.seq === d.total) {
      addLog('[' + d.seq + '/' + d.total + '] ' + d.account + ' ' + d.location + ' (' + d.sales + ' sales)', 'ok');
    }
  });

  eventSource.addEventListener('error', e => {
    try {
      const d = JSON.parse(e.data);
      addLog('ERROR: ' + (d.account ? d.account + ' ' : '') + d.error, 'err');
    } catch {}
  });

  eventSource.addEventListener('done', e => {
    const d = JSON.parse(e.data);
    eventSource.close();
    eventSource = null;
    currentJobId = null;
    $('#stop-btn').style.display = 'none';

    if (d.status === 'completed') {
      $('#progress-title').textContent = 'Job #' + jobId + ' \\u2014 Completed';
      $('#progress-bar').style.width = '100%';
      $('#progress-bar').classList.add('done');
      addLog('Done! ' + (d.properties_added || 0) + ' properties in ' + (d.duration_s || '?') + 's', 'ok');
    } else if (d.status === 'cancelled') {
      $('#progress-title').textContent = 'Job #' + jobId + ' \\u2014 Cancelled';
      $('#progress-bar').classList.add('error');
    } else {
      $('#progress-title').textContent = 'Job #' + jobId + ' \\u2014 Failed';
      $('#progress-bar').classList.add('error');
      addLog('FAILED: ' + (d.error || 'Unknown error'), 'err');
    }
    loadJobs();
    loadStats();
  });
}

function addLog(msg, type) {
  const log = $('#progress-log');
  const cls = type === 'err' ? 'log-err' : 'log-ok';
  log.innerHTML += '<div class="' + cls + '">' + msg + '</div>';
  log.scrollTop = log.scrollHeight;
}

function stopJob() {
  if (!currentJobId) return;
  fetch('/api/jobs/' + currentJobId + '/stop', { method: 'POST' }).then(r => r.json()).then(d => {
    if (d.error) alert(d.error);
  });
}

function updateProgressStats(d) {
  let parts = [];
  if (d.pages_done) parts.push('<span>Pages: <span class="num">' + d.pages_done + '</span></span>');
  if (d.rows_found) parts.push('<span>Rows: <span class="num">' + d.rows_found + '</span></span>');
  if (d.details_done != null) parts.push('<span>Details: <span class="num">' + d.details_done + '/' + (d.details_total || '?') + '</span></span>');
  if (d.errors) parts.push('<span>Errors: <span class="num" style="color:#f85149">' + d.errors + '</span></span>');
  if (parts.length) $('#progress-stats').innerHTML = parts.join('');
}

function loadJobs() {
  fetch('/api/jobs?limit=20').then(r => r.json()).then(jobs => {
    if (!jobs.length) {
      $('#jobs-table').innerHTML = '<p style="color:#8b949e;font-size:13px">No jobs yet. Start a scrape above.</p>';
      return;
    }
    const statusBadge = s => {
      const cls = { queued: 'badge-purple', running: 'badge-blue', completed: 'badge-green', failed: 'badge-red', cancelled: 'badge-orange' }[s] || '';
      return '<span class="badge ' + cls + '">' + s + '</span>';
    };
    $('#jobs-table').innerHTML = '<table><thead><tr>' +
      '<th>#</th><th>Town</th><th>Status</th><th>Pages</th><th>Properties</th><th>Details</th><th>Errors</th><th>Created</th><th>Actions</th>' +
      '</tr></thead><tbody>' +
      jobs.map(j => '<tr>' +
        '<td>' + j.id + '</td>' +
        '<td>' + j.town + '</td>' +
        '<td>' + statusBadge(j.status) + '</td>' +
        '<td>' + j.pages_done + '/' + (j.end_page === -1 ? 'all' : j.end_page) + '</td>' +
        '<td>' + j.rows_found + '</td>' +
        '<td>' + j.details_done + '/' + j.details_total + '</td>' +
        '<td>' + (j.errors || 0) + '</td>' +
        '<td class="text-mono" style="font-size:11px">' + (j.created_at || '').replace('T', ' ').slice(0, 19) + '</td>' +
        '<td>' +
          (j.status === 'running' ? '<button class="btn btn-danger btn-sm" onclick="stopJobById(' + j.id + ')">Stop</button>' : '') +
          (j.status === 'failed' || j.status === 'cancelled' ? '<button class="btn btn-sm btn-secondary" onclick="retryJob(' + j.id + ')">Retry</button>' : '') +
        '</td>' +
        '</tr>').join('') +
      '</tbody></table>';
  });
}

function stopJobById(id) {
  fetch('/api/jobs/' + id + '/stop', { method: 'POST' }).then(() => loadJobs());
}
function retryJob(id) {
  fetch('/api/jobs/' + id + '/retry', { method: 'POST' }).then(r => r.json()).then(d => {
    if (d.job_id) { currentJobId = d.job_id; showProgress(d.job_id); }
    loadJobs();
  });
}

// \\u2500\\u2500 Settings \\u2500\\u2500
function openSettings() {
  fetch('/api/config').then(r => r.json()).then(cfg => {
    $('#cfg-proxy').value = cfg.proxy_url || '';
    $('#cfg-town').value = cfg.default_town || 'Providence';
    $('#cfg-workers').value = cfg.default_workers || '1';
    $('#cfg-rps').value = cfg.default_rps || '1';
    $('#settings-modal').classList.add('active');
  });
}
function closeSettings() { $('#settings-modal').classList.remove('active'); }

function saveSettings() {
  const body = {
    proxy_url: $('#cfg-proxy').value,
    default_town: $('#cfg-town').value,
    default_workers: $('#cfg-workers').value,
    default_rps: $('#cfg-rps').value,
  };
  fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(r => r.json()).then(() => {
      closeSettings();
      // Apply defaults to job form
      $('#job-town').value = body.default_town;
      $('#job-workers').value = body.default_workers;
      $('#job-rps').value = body.default_rps;
      if (body.proxy_url) $('#job-proxy').checked = true;
    });
}

function testProxy() {
  const url = $('#cfg-proxy').value;
  if (!url) { alert('Enter a proxy URL first'); return; }
  const el = $('#proxy-test-result');
  el.textContent = 'Testing...';
  el.className = '';
  fetch('/api/config/proxy/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proxy_url: url }),
  }).then(r => r.json()).then(d => {
    if (d.ok) {
      el.innerHTML = '<span class="proxy-test-result ok">OK \\u2014 IP: ' + (d.ip || '?') + ', ' + d.latency_ms + 'ms</span>';
    } else {
      el.innerHTML = '<span class="proxy-test-result fail">Failed: ' + (d.error || 'HTTP ' + d.status) + '</span>';
    }
  }).catch(err => {
    el.innerHTML = '<span class="proxy-test-result fail">Error: ' + err.message + '</span>';
  });
}

// \\u2500\\u2500 Init \\u2500\\u2500
loadStats();
loadProperties();
loadBiggest();
loadLandlords();

$('#search').addEventListener('keydown', e => { if (e.key === 'Enter') loadProperties(); });

// Load config defaults into form
fetch('/api/config').then(r => r.json()).then(cfg => {
  if (cfg.default_town) $('#job-town').value = cfg.default_town;
  if (cfg.default_workers) $('#job-workers').value = cfg.default_workers;
  if (cfg.default_rps) $('#job-rps').value = cfg.default_rps;
  if (cfg.proxy_url) $('#job-proxy').checked = true;
});
</script>
</body>
</html>`;
