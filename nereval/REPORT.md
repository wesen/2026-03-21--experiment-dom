# Nereval Property Scraper — Technical Report

## What it does

This scraper downloads property assessment data from data.nereval.com (Catalis Tax & CAMA), a public property tax assessment database used by Rhode Island municipalities. It crawls the paginated property list, follows each property's detail link, extracts all assessment/building/sales/land data, and stores everything in a normalized SQLite database.

## Why it was built this way

Nereval is an ASP.NET WebForms application. This means:

- The data is server-rendered in HTML tables (no JavaScript needed — jsdom works perfectly)
- Pagination uses `__doPostBack` — a form POST with `__VIEWSTATE` and `__EVENTVALIDATION` hidden fields, not URL parameters
- Property details are on separate pages linked from the list, each with ~10 data tables

The scraper has two phases: first it crawls the paginated list to discover all properties, then it fetches each property's detail page to extract the full dataset. This two-phase approach means we only hit the detail pages for unique properties (the list page often shows the same property multiple times for different owners).

## Architecture

```
List Page (paginated)          Detail Pages (one per property)
┌─────────────────────┐        ┌──────────────────────────────┐
│ PropertyList.aspx   │        │ PropertyDetail.aspx          │
│                     │        │                              │
│ GridView table:     │  GET   │ Parcel ID table              │
│  View | Map | Owner │───────>│ Assessment table              │
│  View | Map | Owner │        │ Prior Assessments table       │
│  ...26 rows/page... │        │ Location & Owner table        │
│                     │        │ Building Info table            │
│ [Next] (POST)       │        │ Sale Information table         │
└─────────────────────┘        │ Building Sub Areas table       │
       │                       │ Land Information table         │
       │ __doPostBack POST     └──────────────────────────────┘
       │ with __VIEWSTATE               │
       ▼                                ▼
  Next page of results          SQLite database
```

## The six files

### `34-nereval-explore-structure.js` — Initial DOM inventory

The first exploration step. Fetches the list page and counts tags, finds ASP.NET patterns (GridView IDs), lists tables, links, and form elements. This revealed:

- One main data table: `#PropertyList_GridView1` with 28 rows (1 header + 26 data + 1 pager)
- ASP.NET form with `__VIEWSTATE` (5528 chars) and `__EVENTVALIDATION` (152 chars)
- "View" links pointing to `PropertyDetail.aspx?town=Providence&accountnumber=XXXXX&card=1`

### `35-nereval-explore-table.js` — GridView deep dive

Examined the table structure in detail:

- **Headers:** (empty), "Map/Lot", "Owner", "Location"
- **Data rows:** 4 cells each — View link with account URL, map/lot string, owner name, street address
- **Pager row:** single cell with "Next" link using `javascript:__doPostBack('ctl00$PropertyList$GridView1','Page$Next')`
- Multiple rows can share the same account number (multi-owner properties like "Jinwang Xu" and "Qiong Wang" at 40 Abbott St)

### `36-nereval-explore-detail.js` — Property detail page

Explored what data is available on each property's detail page. Found 10 named tables:

| Table ID | Contains |
|---|---|
| `ParcelID_ParcelID` | Map/lot, account #, state code, card |
| `Assessment_Assessment` | Land value, building value, card total, parcel total |
| `PriorInformation_GridView2` | 5 years of prior assessments |
| `LocationOwner_Location` | Address, up to 3 owners, mailing address |
| `BuildingInformation_Building` | Design, year built, heat type, rooms, baths, living area |
| `SaleInformation_Sales` | Sale date, price, legal reference, instrument type |
| `SubArea_SubArea` | Building sub-areas (basement, floors, porches, decks) |
| `LandInformation_Land` | Land area in SF, neighborhood code |
| `Photo_Photo` | Property photo (not extracted) |
| `Sketch_Sketch` | Building sketch (not extracted) |

The ASP.NET tables use a consistent label/value pair layout: alternating `<td>` cells where odd cells are labels and even cells are values. Multi-row tables (prior assessments, sales, sub-areas) have a header row followed by data rows.

### `37-nereval-fetch.js` — HTTP fetcher with ASP.NET pagination

Four exported functions:

- **`fetchListPage(town)`** — GET request for the first page of results
- **`fetchNextPage(town, viewState, eventValidation, pageCommand)`** — POST request that submits the ASP.NET form state to navigate to the next page. The `__EVENTTARGET` is set to the GridView control ID and `__EVENTARGUMENT` to `Page$Next`
- **`getFormState(document)`** — extracts `__VIEWSTATE` and `__EVENTVALIDATION` from the current page (these change on every page load and must be passed back for the next request)
- **`fetchDetailPage(detailPath)`** — simple GET for a property detail page
- **`hasNextPage(document)`** — checks if a "Next" link exists in the GridView

The pagination is the trickiest part. ASP.NET WebForms requires you to POST the exact `__VIEWSTATE` from the current page to get the next page. If you send stale state, you get the first page again. The scraper chains these: fetch page N → extract viewstate → POST for page N+1 → extract viewstate → POST for page N+2 → ...

### `38-nereval-extract.js` — DOM extraction logic

Two main functions:

**`extractListRows(document)`** extracts property rows from the GridView:
- Selects `#PropertyList_GridView1 tr`, skips header and pager rows
- For each data row: extracts View link href, map/lot, owner name, location
- Parses account number from the URL query parameter
- Deduplicates by account+owner (prevents double-counting multi-owner properties)

**`extractDetail(document)`** extracts everything from a detail page:
- Uses `extractTablePairs(table)` helper for label/value pair tables (parcel, assessment, building, land)
- Uses header-row + data-row parsing for multi-row tables (prior assessments, sales, sub-areas)
- Returns a structured object with 8 sections

### `39-nereval-db.js` — SQLite schema and storage

**8 normalized tables:**

```sql
properties          — account_number (PK), map_lot, location, town, state_code, card
owners              — account_number (FK), owner_name (multi-owner support)
assessments         — account_number (FK), land/building/card/parcel values
prior_assessments   — account_number (FK), fiscal_year, all values (5 years)
buildings           — account_number (FK), design, year_built, heat, rooms, baths, area
sales               — account_number (FK), date, price, legal_ref, instrument
sub_areas           — account_number (FK), sub_area name, net_area
land                — account_number (FK), land_area, neighborhood
mailing_addresses   — account_number (FK), address lines
```

All tables use `ON CONFLICT` upsert logic so re-running the scraper updates existing records rather than creating duplicates. Sales and sub-areas are replaced (DELETE + re-INSERT) since they don't have stable unique keys.

### `40-nereval-run.js` — Orchestrator

Two-phase execution:

**Phase 1 — List crawl:** Fetches page 1, extracts rows, stores in `properties` + `owners` tables, checks for "Next" link, POSTs for next page, repeats.

**Phase 2 — Detail fetch:** Deduplicates account numbers from all collected rows, fetches each property's detail page, extracts all data, stores in all 8 tables. Reports progress per-property.

Configurable via CLI arguments:
- `--town`: municipality name (default: Providence)
- `--pages`: number of list pages to crawl, or "all" (default: 3)
- `--db`: SQLite database path (default: `nereval-<town>.db`)
- `--delay`: milliseconds between HTTP requests (default: 500)

## How to query the data

Once scraped, the SQLite database supports queries like:

```sql
-- Properties with current assessment over $1M
SELECT p.location, a.parcel_total, b.year_built, b.design
FROM properties p
JOIN assessments a ON p.account_number = a.account_number
JOIN buildings b ON p.account_number = b.account_number
WHERE CAST(REPLACE(REPLACE(a.parcel_total, '$', ''), ',', '') AS INTEGER) > 1000000
ORDER BY CAST(REPLACE(REPLACE(a.parcel_total, '$', ''), ',', '') AS INTEGER) DESC;

-- Assessment value changes year over year
SELECT account_number, fiscal_year, total_value
FROM prior_assessments
WHERE account_number = '24038'
ORDER BY fiscal_year;

-- Properties sold in the last 5 years with prices
SELECT p.location, s.sale_date, s.sale_price, s.instrument
FROM properties p
JOIN sales s ON p.account_number = s.account_number
WHERE s.sale_price != '$0' AND s.sale_date LIKE '%/202%'
ORDER BY s.sale_date DESC;

-- All owners at a given address
SELECT p.location, o.owner_name
FROM properties p
JOIN owners o ON p.account_number = o.account_number
WHERE p.location LIKE '%ABBOTT ST%'
ORDER BY p.location, o.owner_name;

-- Building age distribution
SELECT b.year_built, COUNT(*) as count
FROM buildings b
WHERE b.year_built != ''
GROUP BY b.year_built
ORDER BY b.year_built;
```

## Limitations

- **Pagination is sequential** — can't jump to page N without crawling pages 1 through N-1 (ASP.NET viewstate dependency)
- **No photo/sketch extraction** — the detail page has photo and sketch tables, but they contain images, not data
- **Values are stored as strings** — dollar amounts include `$` and `,` characters. Use `REPLACE()` in SQL for numeric comparisons.
- **Rate limiting** — the `--delay` flag adds a polite pause between requests. The default 500ms is conservative; the site doesn't seem to rate-limit, but be respectful.
