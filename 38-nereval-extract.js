// 38-nereval-extract.js — Extract property data from nereval list and detail pages
//
// List page DOM (ASP.NET GridView):
//   #PropertyList_GridView1        — main data table
//     tr[0]                        — header: th (empty), th "Map/Lot", th "Owner", th "Location"
//     tr[1..N-1]                   — data rows: td (View link), td map/lot, td owner, td location
//     tr[N]                        — pager row (single td with "Next" link)
//
// Detail page DOM (multiple named tables):
//   #ParcelID_ParcelID             — parcel ID, account, state code, card
//   #Assessment_Assessment         — land/building/total values
//   #PriorInformation_GridView2    — prior year assessments
//   #LocationOwner_Location        — address, owner names, mailing address
//   #BuildingInformation_Building  — design, year built, heat, rooms, baths, area
//   #SaleInformation_Sales         — sale date, price, legal ref, instrument
//   #SubArea_SubArea               — building sub-areas (basement, floors, etc.)
//   #LandInformation_Land          — land area, neighborhood

'use strict';

/**
 * Extract property rows from the list page GridView.
 * @param {Document} document
 * @returns {{ mapLot: string, owner: string, location: string, detailUrl: string, accountNumber: string }[]}
 */
function extractListRows(document) {
  const table = document.querySelector('#PropertyList_GridView1');
  if (!table) return [];

  const rows = [...table.querySelectorAll('tr')];
  // Skip header (first) and pager (last) rows
  const dataRows = rows.slice(1).filter(row => {
    const cells = row.querySelectorAll('td');
    return cells.length >= 4; // data rows have 4 cells; pager has 1
  });

  const seen = new Set();
  return dataRows.map(row => {
    const cells = [...row.querySelectorAll('td')];
    const viewLink = cells[0]?.querySelector('a');
    const detailUrl = viewLink?.getAttribute('href') || '';
    const mapLot = cells[1]?.textContent.trim() || '';
    const owner = cells[2]?.textContent.trim() || '';
    const location = cells[3]?.textContent.trim() || '';

    // Extract account number from URL
    const acctMatch = detailUrl.match(/accountnumber=(\d+)/);
    const accountNumber = acctMatch?.[1] || '';

    // Dedup by accountNumber+owner (same property can have multiple owners listed)
    const key = `${accountNumber}:${owner}`;
    if (seen.has(key)) return null;
    seen.add(key);

    return { mapLot, owner, location, detailUrl, accountNumber };
  }).filter(Boolean);
}

/**
 * Helper: extract text from table cells by walking rows.
 * ASP.NET tables have label cells and value cells in alternating <td> pairs.
 */
function extractTablePairs(table) {
  if (!table) return {};
  const result = {};
  const rows = [...table.querySelectorAll('tr')];
  for (const row of rows) {
    const cells = [...row.querySelectorAll('td, th')];
    for (let i = 0; i < cells.length - 1; i += 2) {
      const label = cells[i]?.textContent.trim();
      const value = cells[i + 1]?.textContent.trim();
      if (label && value !== undefined) {
        result[label] = value;
      }
    }
  }
  return result;
}

/**
 * Extract all data from a property detail page.
 * @param {Document} document
 * @returns {object}
 */
function extractDetail(document) {
  const result = {
    parcel: {},
    assessment: {},
    priorAssessments: [],
    location: {},
    building: {},
    sales: [],
    subAreas: [],
    land: {},
  };

  // Parcel Identification
  result.parcel = extractTablePairs(document.querySelector('#ParcelID_ParcelID'));

  // Assessment
  result.assessment = extractTablePairs(document.querySelector('#Assessment_Assessment'));

  // Prior Assessments (multi-row table with header)
  const priorTable = document.querySelector('#PriorInformation_GridView2');
  if (priorTable) {
    const rows = [...priorTable.querySelectorAll('tr')];
    const headers = [...rows[0].querySelectorAll('th, td')].map(c => c.textContent.trim());
    for (let i = 1; i < rows.length; i++) {
      const cells = [...rows[i].querySelectorAll('td')].map(c => c.textContent.trim());
      const entry = {};
      headers.forEach((h, j) => { entry[h] = cells[j] || ''; });
      result.priorAssessments.push(entry);
    }
  }

  // Location and Owner
  result.location = extractTablePairs(document.querySelector('#LocationOwner_Location'));

  // Building Information
  result.building = extractTablePairs(document.querySelector('#BuildingInformation_Building'));

  // Sale Information (multi-row with header)
  const salesTable = document.querySelector('#SaleInformation_Sales');
  if (salesTable) {
    const rows = [...salesTable.querySelectorAll('tr')];
    const headers = [...rows[0].querySelectorAll('th, td')].map(c => c.textContent.trim());
    for (let i = 1; i < rows.length; i++) {
      const cells = [...rows[i].querySelectorAll('td')].map(c => c.textContent.trim());
      const entry = {};
      headers.forEach((h, j) => { entry[h] = cells[j] || ''; });
      result.sales.push(entry);
    }
  }

  // Building Sub Areas (multi-row with header)
  const subTable = document.querySelector('#SubArea_SubArea');
  if (subTable) {
    const rows = [...subTable.querySelectorAll('tr')];
    const headers = [...rows[0].querySelectorAll('th, td')].map(c => c.textContent.trim());
    for (let i = 1; i < rows.length; i++) {
      const cells = [...rows[i].querySelectorAll('td')].map(c => c.textContent.trim());
      const entry = {};
      headers.forEach((h, j) => { entry[h] = cells[j] || ''; });
      result.subAreas.push(entry);
    }
  }

  // Land Information
  result.land = extractTablePairs(document.querySelector('#LandInformation_Land'));

  return result;
}

module.exports = { extractListRows, extractDetail, extractTablePairs };
