// 39-nereval-db.js — SQLite storage for nereval property data
const Database = require('better-sqlite3');
const path = require('path');

const DEFAULT_DB_PATH = path.join(__dirname, 'nereval-providence.db');

function openDb(dbPath = DEFAULT_DB_PATH) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  createTables(db);
  return db;
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

module.exports = { openDb, upsertProperty, storeDetail };
