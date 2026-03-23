// 39-nereval-db.js — SQLite storage for nereval property data
const Database = require('better-sqlite3');
const path = require('path');

const DEFAULT_DB_PATH = path.join(__dirname, 'nereval-providence.db');

function openDb(dbPath = DEFAULT_DB_PATH) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  createTables(db);
  migrate(db);
  return db;
}

function migrate(db) {
  // Add columns that may be missing in older DBs
  const addCol = (table, col, type) => {
    try { db.prepare(`SELECT ${col} FROM ${table} LIMIT 0`).get(); } catch {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
    }
  };
  addCol('detail_queue', 'location', 'TEXT');
  addCol('jobs', 'mode', "TEXT NOT NULL DEFAULT 'full'");
  // Backfill queue locations from properties
  db.prepare(`
    UPDATE detail_queue SET location = (
      SELECT location FROM properties WHERE properties.account_number = detail_queue.account_number
    ) WHERE location IS NULL
  `).run();
}

function createTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS properties (
      account_number  TEXT PRIMARY KEY,
      map_lot         TEXT,
      location        TEXT,
      town            TEXT,
      state_code      TEXT,
      card            TEXT,
      user_account    TEXT,
      detail_url      TEXT,
      fetched_at      TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS owners (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      account_number  TEXT NOT NULL REFERENCES properties(account_number),
      owner_name      TEXT,
      owner_order     INTEGER DEFAULT 1,
      UNIQUE(account_number, owner_name)
    );

    CREATE TABLE IF NOT EXISTS assessments (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      account_number  TEXT NOT NULL REFERENCES properties(account_number),
      land_value      TEXT,
      building_value  TEXT,
      card_total      TEXT,
      parcel_total    TEXT,
      UNIQUE(account_number)
    );

    CREATE TABLE IF NOT EXISTS prior_assessments (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      account_number  TEXT NOT NULL REFERENCES properties(account_number),
      fiscal_year     TEXT,
      land_value      TEXT,
      building_value  TEXT,
      outbuilding_value TEXT,
      total_value     TEXT,
      UNIQUE(account_number, fiscal_year)
    );

    CREATE TABLE IF NOT EXISTS buildings (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      account_number  TEXT NOT NULL REFERENCES properties(account_number),
      design          TEXT,
      year_built      TEXT,
      heat            TEXT,
      fireplaces      TEXT,
      rooms           TEXT,
      bedrooms        TEXT,
      bathrooms       TEXT,
      full_bath       TEXT,
      above_grade_area TEXT,
      UNIQUE(account_number)
    );

    CREATE TABLE IF NOT EXISTS sales (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      account_number  TEXT NOT NULL REFERENCES properties(account_number),
      sale_date       TEXT,
      sale_price      TEXT,
      legal_reference TEXT,
      instrument      TEXT
    );

    CREATE TABLE IF NOT EXISTS sub_areas (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      account_number  TEXT NOT NULL REFERENCES properties(account_number),
      sub_area        TEXT,
      net_area        TEXT
    );

    CREATE TABLE IF NOT EXISTS land (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      account_number  TEXT NOT NULL REFERENCES properties(account_number),
      land_area       TEXT,
      neighborhood    TEXT,
      UNIQUE(account_number)
    );

    CREATE TABLE IF NOT EXISTS mailing_addresses (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      account_number  TEXT NOT NULL REFERENCES properties(account_number),
      address1        TEXT,
      address2        TEXT,
      address3        TEXT,
      UNIQUE(account_number)
    );

    -- Job queue: tracks scrape jobs and their progress
    CREATE TABLE IF NOT EXISTS jobs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      town            TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'queued',
      start_page      INTEGER DEFAULT 1,
      end_page        INTEGER DEFAULT 3,
      workers         INTEGER DEFAULT 1,
      rps             REAL DEFAULT 1.0,
      use_proxy       INTEGER DEFAULT 0,
      no_details      INTEGER DEFAULT 0,
      created_at      TEXT DEFAULT (datetime('now')),
      started_at      TEXT,
      finished_at     TEXT,
      pages_done      INTEGER DEFAULT 0,
      rows_found      INTEGER DEFAULT 0,
      details_done    INTEGER DEFAULT 0,
      details_total   INTEGER DEFAULT 0,
      errors          INTEGER DEFAULT 0,
      error_msg       TEXT,
      properties_added   INTEGER DEFAULT 0,
      properties_updated INTEGER DEFAULT 0
    );

    -- Persistent configuration (key-value)
    CREATE TABLE IF NOT EXISTS config (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    -- Detail fetch queue: persistent work items for phase 2
    CREATE TABLE IF NOT EXISTS detail_queue (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      account_number  TEXT NOT NULL,
      detail_url      TEXT NOT NULL,
      town            TEXT NOT NULL,
      location        TEXT,
      status          TEXT NOT NULL DEFAULT 'pending',
      job_id          INTEGER,
      attempts        INTEGER DEFAULT 0,
      last_error      TEXT,
      last_attempt_at TEXT,
      completed_at    TEXT,
      UNIQUE(account_number)
    );
    CREATE INDEX IF NOT EXISTS idx_detail_queue_status ON detail_queue(status);

    -- Cached ASP.NET viewstates for page position resume
    CREATE TABLE IF NOT EXISTS viewstates (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      town             TEXT NOT NULL,
      page_number      INTEGER NOT NULL,
      view_state       TEXT NOT NULL,
      event_validation TEXT NOT NULL,
      fetched_at       TEXT DEFAULT (datetime('now')),
      UNIQUE(town, page_number)
    );
  `);
}

/**
 * Upsert a property from list page data.
 */
function upsertProperty(db, town, row) {
  db.prepare(`
    INSERT INTO properties (account_number, map_lot, location, town, detail_url)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(account_number) DO UPDATE SET
      map_lot = excluded.map_lot,
      location = excluded.location,
      detail_url = excluded.detail_url,
      fetched_at = datetime('now')
  `).run(row.accountNumber, row.mapLot, row.location, town, row.detailUrl);

  // Insert owner (ignore dupes)
  if (row.owner) {
    db.prepare(`
      INSERT OR IGNORE INTO owners (account_number, owner_name)
      VALUES (?, ?)
    `).run(row.accountNumber, row.owner);
  }
}

/**
 * Store detail page data for a property.
 */
function storeDetail(db, accountNumber, detail) {
  const p = detail.parcel;
  db.prepare(`
    UPDATE properties SET
      state_code = ?, card = ?, user_account = ?
    WHERE account_number = ?
  `).run(p['State Code'] || '', p['Card'] || '', p['User Account'] || '', accountNumber);

  // Assessment
  const a = detail.assessment;
  db.prepare(`
    INSERT INTO assessments (account_number, land_value, building_value, card_total, parcel_total)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(account_number) DO UPDATE SET
      land_value = excluded.land_value,
      building_value = excluded.building_value,
      card_total = excluded.card_total,
      parcel_total = excluded.parcel_total
  `).run(accountNumber, a['Land'] || '', a['Building'] || '', a['Card Total'] || '', a['Parcel Total'] || '');

  // Prior assessments
  const priorStmt = db.prepare(`
    INSERT INTO prior_assessments (account_number, fiscal_year, land_value, building_value, outbuilding_value, total_value)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_number, fiscal_year) DO UPDATE SET
      land_value = excluded.land_value,
      building_value = excluded.building_value,
      outbuilding_value = excluded.outbuilding_value,
      total_value = excluded.total_value
  `);
  for (const pa of detail.priorAssessments) {
    priorStmt.run(accountNumber,
      pa['Fiscal Year'] || '', pa['Land Value'] || '', pa['Building Value'] || '',
      pa['Outbuilding Value'] || '', pa['Total Value'] || '');
  }

  // Building
  const b = detail.building;
  db.prepare(`
    INSERT INTO buildings (account_number, design, year_built, heat, fireplaces, rooms, bedrooms, bathrooms, full_bath, above_grade_area)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_number) DO UPDATE SET
      design = excluded.design, year_built = excluded.year_built, heat = excluded.heat,
      fireplaces = excluded.fireplaces, rooms = excluded.rooms, bedrooms = excluded.bedrooms,
      bathrooms = excluded.bathrooms, full_bath = excluded.full_bath, above_grade_area = excluded.above_grade_area
  `).run(accountNumber, b['Design'] || '', b['Year Built'] || '', b['Heat'] || '',
    b['Fireplaces'] || '', b['Rooms'] || '', b['Bedrooms'] || '',
    b['Bathrooms'] || '', b['Full Bath'] || '', b['Above Grade Living Area'] || '');

  // Location / owners / mailing address
  const loc = detail.location;
  // Additional owners from detail page
  for (const key of ['Owner', 'Owner2', 'Owner3']) {
    if (loc[key]) {
      db.prepare(`INSERT OR IGNORE INTO owners (account_number, owner_name) VALUES (?, ?)`)
        .run(accountNumber, loc[key]);
    }
  }
  // Mailing address
  db.prepare(`
    INSERT INTO mailing_addresses (account_number, address1, address2, address3)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(account_number) DO UPDATE SET
      address1 = excluded.address1, address2 = excluded.address2, address3 = excluded.address3
  `).run(accountNumber, loc['Address'] || '', loc['Address2'] || '', loc['Address3'] || '');

  // Sales
  db.prepare(`DELETE FROM sales WHERE account_number = ?`).run(accountNumber);
  const saleStmt = db.prepare(`
    INSERT INTO sales (account_number, sale_date, sale_price, legal_reference, instrument)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const s of detail.sales) {
    saleStmt.run(accountNumber,
      s['Sale Date'] || '', s['Sale Price'] || '', s['Legal Reference'] || '', s['Instrument'] || '');
  }

  // Sub areas
  db.prepare(`DELETE FROM sub_areas WHERE account_number = ?`).run(accountNumber);
  const subStmt = db.prepare(`INSERT INTO sub_areas (account_number, sub_area, net_area) VALUES (?, ?, ?)`);
  for (const sa of detail.subAreas) {
    subStmt.run(accountNumber, sa['Sub Area'] || '', sa['Net Area'] || '');
  }

  // Land
  const l = detail.land;
  db.prepare(`
    INSERT INTO land (account_number, land_area, neighborhood)
    VALUES (?, ?, ?)
    ON CONFLICT(account_number) DO UPDATE SET
      land_area = excluded.land_area, neighborhood = excluded.neighborhood
  `).run(accountNumber, l['Land Area'] || '', l['View - Neighborhood'] || l['Neighborhood'] || '');
}

// ── Job CRUD ────────────────────────────────────────────────────────────────

function createJob(db, { town, startPage = 1, endPage = 3, workers = 1, rps = 1, useProxy = false, noDetails = false, mode = 'full' }) {
  const info = db.prepare(`
    INSERT INTO jobs (town, status, start_page, end_page, workers, rps, use_proxy, no_details, mode)
    VALUES (?, 'queued', ?, ?, ?, ?, ?, ?, ?)
  `).run(town, startPage, endPage, workers, rps, useProxy ? 1 : 0, noDetails ? 1 : 0, mode);
  return info.lastInsertRowid;
}

function getJob(db, id) {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
}

function listJobs(db, limit = 50) {
  return db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?').all(limit);
}

function updateJob(db, id, fields) {
  const allowed = [
    'status', 'started_at', 'finished_at', 'pages_done', 'rows_found',
    'details_done', 'details_total', 'errors', 'error_msg',
    'properties_added', 'properties_updated',
  ];
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    if (allowed.includes(k)) {
      sets.push(`${k} = ?`);
      vals.push(v);
    }
  }
  if (sets.length === 0) return;
  vals.push(id);
  db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

/**
 * Mark any running jobs as failed (crash recovery on startup).
 */
function recoverJobs(db) {
  const stale = db.prepare("SELECT id FROM jobs WHERE status = 'running'").all();
  if (stale.length > 0) {
    db.prepare("UPDATE jobs SET status = 'failed', error_msg = 'Server restarted', finished_at = datetime('now') WHERE status = 'running'").run();
  }
  return stale.length;
}

// ── Config CRUD ─────────────────────────────────────────────────────────────

function getConfig(db) {
  const rows = db.prepare('SELECT key, value FROM config').all();
  const cfg = {};
  for (const { key, value } of rows) cfg[key] = value;
  return cfg;
}

function getConfigValue(db, key, defaultValue = null) {
  const row = db.prepare('SELECT value FROM config WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}

function setConfig(db, key, value) {
  db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

function setConfigBulk(db, obj) {
  const stmt = db.prepare('INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(obj)) {
      stmt.run(k, v == null ? '' : String(v));
    }
  });
  tx();
}

// ── Detail Queue CRUD ────────────────────────────────────────────────────────

function enqueueDetail(db, { accountNumber, detailUrl, town, location = null, jobId = null }) {
  db.prepare(`
    INSERT OR IGNORE INTO detail_queue (account_number, detail_url, town, location, job_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(accountNumber, detailUrl, town, location, jobId);
}

/**
 * Atomically claim the next pending queue item. Returns the row or null.
 */
const claimNextDetail = function(db) {
  const tx = db.transaction(() => {
    const item = db.prepare(
      "SELECT * FROM detail_queue WHERE status = 'pending' LIMIT 1"
    ).get();
    if (!item) return null;
    db.prepare(
      "UPDATE detail_queue SET status = 'in_progress', last_attempt_at = datetime('now') WHERE id = ?"
    ).run(item.id);
    return { ...item, status: 'in_progress' };
  });
  return tx();
};

function markDetailDone(db, id) {
  db.prepare(
    "UPDATE detail_queue SET status = 'done', completed_at = datetime('now') WHERE id = ?"
  ).run(id);
}

function markDetailFailed(db, id, error) {
  db.prepare(
    "UPDATE detail_queue SET status = 'failed', attempts = attempts + 1, last_error = ? WHERE id = ?"
  ).run(error, id);
}

function resetInProgressDetails(db) {
  const info = db.prepare(
    "UPDATE detail_queue SET status = 'pending' WHERE status = 'in_progress'"
  ).run();
  return info.changes;
}

function getQueueStats(db) {
  const rows = db.prepare(
    "SELECT status, COUNT(*) as count FROM detail_queue GROUP BY status"
  ).all();
  const stats = { pending: 0, in_progress: 0, done: 0, failed: 0, total: 0 };
  for (const { status, count } of rows) {
    stats[status] = count;
    stats.total += count;
  }
  return stats;
}

function getQueueItems(db, { status = null, search = null, limit = 50, offset = 0 } = {}) {
  let where = '1=1';
  const params = [];
  if (status) { where += ' AND status = ?'; params.push(status); }
  if (search) { where += ' AND (account_number LIKE ? OR location LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  const rows = db.prepare(`SELECT * FROM detail_queue WHERE ${where} ORDER BY id LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) as n FROM detail_queue WHERE ${where}`).get(...params).n;
  return { rows, total, limit, offset };
}

function retryFailedDetails(db, { maxAttempts = 10 } = {}) {
  const info = db.prepare(
    "UPDATE detail_queue SET status = 'pending', last_error = NULL WHERE status = 'failed' AND attempts < ?"
  ).run(maxAttempts);
  return info.changes;
}

function clearDoneDetails(db) {
  const info = db.prepare("DELETE FROM detail_queue WHERE status = 'done'").run();
  return info.changes;
}

// ── Viewstate Cache CRUD ────────────────────────────────────────────────────

function saveViewstate(db, { town, pageNumber, viewState, eventValidation }) {
  db.prepare(`
    INSERT INTO viewstates (town, page_number, view_state, event_validation)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(town, page_number) DO UPDATE SET
      view_state = excluded.view_state,
      event_validation = excluded.event_validation,
      fetched_at = datetime('now')
  `).run(town, pageNumber, viewState, eventValidation);
}

function getViewstate(db, town, pageNumber, maxAgeMinutes = 2880) {
  const row = db.prepare(`
    SELECT * FROM viewstates
    WHERE town = ? AND page_number = ?
      AND fetched_at > datetime('now', '-' || ? || ' minutes')
  `).get(town, pageNumber, maxAgeMinutes);
  return row || null;
}

function listViewstates(db, town) {
  return db.prepare(`
    SELECT page_number, fetched_at,
      ROUND((julianday('now') - julianday(fetched_at)) * 24 * 60, 1) as age_minutes
    FROM viewstates WHERE town = ? ORDER BY page_number
  `).all(town);
}

function clearViewstates(db, town) {
  db.prepare('DELETE FROM viewstates WHERE town = ?').run(town);
}

module.exports = {
  openDb, upsertProperty, storeDetail,
  createJob, getJob, listJobs, updateJob, recoverJobs,
  getConfig, getConfigValue, setConfig, setConfigBulk,
  enqueueDetail, claimNextDetail, markDetailDone, markDetailFailed,
  resetInProgressDetails, getQueueStats, getQueueItems, retryFailedDetails, clearDoneDetails,
  saveViewstate, getViewstate, listViewstates, clearViewstates,
};
