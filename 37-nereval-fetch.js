// 37-nereval-fetch.js — Fetch nereval pages with ASP.NET form state for pagination
const { JSDOM } = require('jsdom');

const BASE_URL = 'https://data.nereval.com';
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; dom-scraper/1.0)' };

/**
 * Fetch the property list page (first page).
 * @param {string} town
 * @returns {{ document: Document, html: string }}
 */
async function fetchListPage(town = 'Providence') {
  const url = `${BASE_URL}/PropertyList.aspx?town=${encodeURIComponent(town)}&Search=`;
  const res = await fetch(url, { headers: HEADERS });
  const html = await res.text();
  return { document: new JSDOM(html).window.document, html };
}

/**
 * Fetch the next page of results by POSTing ASP.NET form state.
 * ASP.NET GridView uses __doPostBack('ctl00$PropertyList$GridView1','Page$Next')
 * @param {string} town
 * @param {string} viewState
 * @param {string} eventValidation
 * @param {string} pageCommand - e.g., 'Page$Next', 'Page$2', 'Page$Last'
 * @returns {{ document: Document, html: string }}
 */
async function fetchNextPage(town, viewState, eventValidation, pageCommand = 'Page$Next') {
  const url = `${BASE_URL}/PropertyList.aspx?town=${encodeURIComponent(town)}&Search=`;
  const body = new URLSearchParams({
    '__VIEWSTATE': viewState,
    '__EVENTVALIDATION': eventValidation,
    '__EVENTTARGET': 'ctl00$PropertyList$GridView1',
    '__EVENTARGUMENT': pageCommand,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  const html = await res.text();
  return { document: new JSDOM(html).window.document, html };
}

/**
 * Extract ASP.NET form state from a document (needed for pagination POST).
 */
function getFormState(document) {
  return {
    viewState: document.querySelector('#__VIEWSTATE')?.value || '',
    eventValidation: document.querySelector('#__EVENTVALIDATION')?.value || '',
  };
}

/**
 * Check if there's a "Next" page link.
 */
function hasNextPage(document) {
  const table = document.querySelector('#PropertyList_GridView1');
  if (!table) return false;
  const nextLink = table.querySelector('a[href*="Page$Next"]');
  return !!nextLink;
}

/**
 * Fetch a property detail page.
 * @param {string} detailPath - relative path like "PropertyDetail.aspx?town=Providence&accountnumber=24058&card=1"
 * @returns {{ document: Document, html: string }}
 */
async function fetchDetailPage(detailPath) {
  const url = detailPath.startsWith('http') ? detailPath : `${BASE_URL}/${detailPath}`;
  const res = await fetch(url, { headers: HEADERS });
  const html = await res.text();
  return { document: new JSDOM(html).window.document, html };
}

module.exports = { fetchListPage, fetchNextPage, getFormState, hasNextPage, fetchDetailPage, BASE_URL };
