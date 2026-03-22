// server/property-browser.mjs — Web UI for browsing nereval property data
//
// Usage: node server/property-browser.mjs [--db nereval-providence.db] [--port 3000]

import express from 'express';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

// Parse args
const args = process.argv.slice(2);
let dbPath = join(PROJECT_ROOT, 'nereval-providence.db');
let port = 3000;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--db') dbPath = args[++i];
  if (args[i] === '--port') port = parseInt(args[++i]);
}

const db = new Database(dbPath, { readonly: true });
db.pragma('journal_mode = WAL');

const app = express();

// ── API Routes ──────────────────────────────────────────────────────────────

// Stats overview
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

// Top landlords (owners with most properties)
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

// Properties list with search/filter
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
      p.account_number,
      p.location,
      p.map_lot,
      a.parcel_total as assessed_value,
      a.land_value,
      a.building_value,
      CAST(REPLACE(REPLACE(a.parcel_total, '$', ''), ',', '') AS INTEGER) as value_num,
      b.design,
      b.year_built,
      b.rooms,
      b.bedrooms,
      b.bathrooms,
      b.above_grade_area,
      CAST(REPLACE(REPLACE(b.above_grade_area, ' SF', ''), ',', '') AS INTEGER) as area_num,
      l.land_area,
      o_agg.owners,
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

// Single property detail
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

// Biggest properties by assessed value
app.get('/api/biggest', (req, res) => {
  const by = req.query.by || 'value'; // value, area, units
  const limit = parseInt(req.query.limit) || 20;

  let sql;
  if (by === 'area') {
    sql = `
      SELECT p.account_number, p.location, a.parcel_total,
        b.above_grade_area, b.design, b.year_built,
        CAST(REPLACE(REPLACE(b.above_grade_area, ' SF', ''), ',', '') AS INTEGER) as area_num,
        o_agg.owners
      FROM properties p
      JOIN buildings b ON p.account_number = b.account_number
      LEFT JOIN assessments a ON p.account_number = a.account_number
      LEFT JOIN (SELECT account_number, GROUP_CONCAT(owner_name, '; ') as owners FROM owners GROUP BY account_number) o_agg ON p.account_number = o_agg.account_number
      WHERE b.above_grade_area <> ''
      ORDER BY area_num DESC LIMIT ?
    `;
  } else if (by === 'units') {
    sql = `
      SELECT p.account_number, p.location, a.parcel_total,
        b.design, b.year_built, b.above_grade_area, b.bathrooms, b.rooms,
        o_agg.owners
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
        b.design, b.year_built, b.above_grade_area,
        o_agg.owners
      FROM properties p
      JOIN assessments a ON p.account_number = a.account_number
      LEFT JOIN buildings b ON p.account_number = b.account_number
      LEFT JOIN (SELECT account_number, GROUP_CONCAT(owner_name, '; ') as owners FROM owners GROUP BY account_number) o_agg ON p.account_number = o_agg.account_number
      ORDER BY value_num DESC LIMIT ?
    `;
  }
  res.json(db.prepare(sql).all(limit));
});

// Value distribution histogram
app.get('/api/histogram', (req, res) => {
  const bucketSize = parseInt(req.query.bucket) || 100000;
  const rows = db.prepare(`
    SELECT
      (CAST(REPLACE(REPLACE(parcel_total, '$', ''), ',', '') AS INTEGER) / ?) * ? as bucket_start,
      COUNT(*) as count
    FROM assessments
    WHERE parcel_total <> ''
    GROUP BY bucket_start
    ORDER BY bucket_start
  `).all(bucketSize, bucketSize);
  res.json({ bucketSize, rows });
});

// ── HTML UI ─────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.send(HTML);
});

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Providence Property Browser</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #0f1117; color: #e1e4e8; line-height: 1.5; }
  a { color: #58a6ff; text-decoration: none; }
  a:hover { text-decoration: underline; }

  .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
  header { background: #161b22; border-bottom: 1px solid #30363d; padding: 16px 0; margin-bottom: 24px; }
  header h1 { max-width: 1200px; margin: 0 auto; padding: 0 20px; font-size: 20px; font-weight: 600; }
  header h1 span { color: #8b949e; font-weight: 400; }

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

  /* Search */
  .search-bar { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
  .search-bar input, .search-bar select { background: #0d1117; border: 1px solid #30363d; color: #e1e4e8; padding: 8px 12px; border-radius: 6px; font-size: 14px; }
  .search-bar input:focus, .search-bar select:focus { border-color: #58a6ff; outline: none; }
  .search-bar input[type="text"] { flex: 1; min-width: 200px; }
  .search-bar button { background: #238636; color: #fff; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 14px; }
  .search-bar button:hover { background: #2ea043; }

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

  @media (max-width: 768px) {
    .chart-row { grid-template-columns: 1fr; }
    .stats-grid { grid-template-columns: repeat(2, 1fr); }
  }
</style>
</head>
<body>
<header><h1>Providence Property Browser <span>nereval data</span></h1></header>

<div class="container">
  <div class="stats-grid" id="stats-grid"></div>

  <div class="chart-row" id="charts"></div>

  <div class="tabs">
    <div class="tab active" data-tab="properties">Properties</div>
    <div class="tab" data-tab="landlords">Top Landlords</div>
    <div class="tab" data-tab="biggest">Biggest</div>
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
</div>

<div class="detail-overlay" id="detail-overlay" onclick="if(event.target===this)closeDetail()">
  <div class="detail-panel" id="detail-panel"></div>
</div>

<script>
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const fmt = n => n ? '$' + Number(n).toLocaleString() : '—';
const fmtN = n => n ? Number(n).toLocaleString() : '—';

// Tabs
$$('.tab').forEach(t => t.addEventListener('click', () => {
  $$('.tab').forEach(x => x.classList.remove('active'));
  $$('.tab-content').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  $('#tab-' + t.dataset.tab).classList.add('active');
}));

// Stats
fetch('/api/stats').then(r => r.json()).then(s => {
  $('#stats-grid').innerHTML = [
    card('Properties', fmtN(s.properties)),
    card('Owners', fmtN(s.owners)),
    card('Sales Records', fmtN(s.sales)),
    card('Total Assessed', fmt(s.totalAssessedValue), 'money'),
    card('Avg Assessed', fmt(Math.round(s.avgAssessedValue)), 'money'),
  ].join('');

  // Charts
  const maxDesign = Math.max(...s.buildingDesigns.map(d => d.count));
  const maxYear = Math.max(...s.yearBuiltDistribution.map(d => d.count));
  $('#charts').innerHTML =
    chartCard('Building Design', s.buildingDesigns.map(d =>
      barRow(d.design, d.count, maxDesign)
    ).join('')) +
    chartCard('Year Built', s.yearBuiltDistribution.map(d =>
      barRow(d.era, d.count, maxYear)
    ).join(''));

  // Populate design filter
  const sel = $('#design-filter');
  s.buildingDesigns.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.design; opt.textContent = d.design + ' (' + d.count + ')';
    sel.appendChild(opt);
  });
});

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

// Properties
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
        '<td class="text-right text-mono" style="color:#3fb950">' + (r.assessed_value || '—') + '</td>' +
        '<td><span class="badge badge-blue">' + (r.design || '—') + '</span></td>' +
        '<td>' + (r.year_built || '—') + '</td>' +
        '<td class="text-right text-mono">' + (r.above_grade_area || '—') + '</td>' +
        '<td class="text-right">' + (r.sale_count || 0) + '</td>' +
        '</tr>').join('') +
      '</tbody></table>' +
      '<p style="margin-top:12px;color:#8b949e;font-size:12px">Showing ' + d.rows.length + ' of ' + d.total + ' properties</p>';
  });
}

// Landlords
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

// Biggest
function loadBiggest() {
  const by = $('#biggest-by').value;
  fetch('/api/biggest?by=' + by + '&limit=30').then(r => r.json()).then(data => {
    $('#biggest-table').innerHTML = '<table><thead><tr>' +
      '<th>Location</th><th>Owner(s)</th><th class="text-right">Assessed</th><th>Design</th><th>Year</th><th class="text-right">Area</th>' +
      '</tr></thead><tbody>' +
      data.map(r => '<tr onclick="showDetail(\\'' + r.account_number + '\\')" style="cursor:pointer">' +
        '<td><strong>' + (r.location || '') + '</strong></td>' +
        '<td style="font-size:12px">' + (r.owners || '').split('; ').slice(0, 2).join(', ') + '</td>' +
        '<td class="text-right text-mono" style="color:#3fb950">' + (r.parcel_total || '—') + '</td>' +
        '<td><span class="badge badge-blue">' + (r.design || '—') + '</span></td>' +
        '<td>' + (r.year_built || '—') + '</td>' +
        '<td class="text-right text-mono">' + (r.above_grade_area || '—') + '</td>' +
        '</tr>').join('') +
      '</tbody></table>';
  });
}

// Property detail modal
function showDetail(acct) {
  fetch('/api/property/' + acct).then(r => r.json()).then(d => {
    const p = d.property, a = d.assessment || {}, b = d.building || {}, l = d.land || {};
    let html = '<button class="close-btn" onclick="closeDetail()">&times;</button>';
    html += '<h2>' + (p.location || acct) + '</h2>';

    html += section('Parcel', grid({
      'Account': p.account_number, 'Map/Lot': p.map_lot, 'State Code': p.state_code, 'Card': p.card,
    }));

    html += section('Owners', d.owners.map(o => o.owner_name).join('<br>'));

    html += section('Assessment', grid({
      'Land': a.land_value, 'Building': a.building_value, 'Card Total': a.card_total, 'Parcel Total': a.parcel_total,
    }));

    if (d.priorAssessments.length) {
      html += section('Assessment History',
        '<table style="width:100%"><thead><tr><th>Year</th><th class="text-right">Land</th><th class="text-right">Building</th><th class="text-right">Total</th></tr></thead><tbody>' +
        d.priorAssessments.map(pa => '<tr><td>' + pa.fiscal_year + '</td><td class="text-right">' + pa.land_value + '</td><td class="text-right">' + pa.building_value + '</td><td class="text-right" style="color:#3fb950">' + pa.total_value + '</td></tr>').join('') +
        '</tbody></table>');
    }

    html += section('Building', grid({
      'Design': b.design, 'Year Built': b.year_built, 'Heat': b.heat, 'Fireplaces': b.fireplaces,
      'Rooms': b.rooms, 'Bedrooms': b.bedrooms, 'Bathrooms': b.bathrooms, 'Living Area': b.above_grade_area,
    }));

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
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });

function section(title, content) {
  return '<div class="detail-section"><h4>' + title + '</h4>' + content + '</div>';
}
function grid(obj) {
  return '<div class="detail-grid">' + Object.entries(obj).filter(([,v]) => v).map(([k,v]) => '<span class="dl">' + k + '</span><span>' + v + '</span>').join('') + '</div>';
}

// Initial load
loadProperties();
loadBiggest();

// Enter key search
$('#search').addEventListener('keydown', e => { if (e.key === 'Enter') loadProperties(); });
</script>
</body>
</html>`;

app.listen(port, () => {
  console.log(`Property Browser running at http://localhost:${port}`);
  console.log(`Database: ${dbPath}`);
});
