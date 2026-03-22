// 37-nereval-fetch.js — Fetch nereval pages with ASP.NET form state for pagination
// Includes retry with exponential backoff for 403/429/5xx responses.
const { JSDOM } = require('jsdom');

const BASE_URL = 'https://data.nereval.com';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Fetch with retry and exponential backoff.
 * Retries on 403, 429, 500, 502, 503, 529.
 * @param {string} url
 * @param {RequestInit} init
 * @param {{ maxRetries?: number, baseDelay?: number }} opts
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, init = {}, { maxRetries = 3, baseDelay = 2000 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, init);

    if (res.ok) return res;

    const retryable = [403, 429, 500, 502, 503, 529].includes(res.status);
    if (!retryable || attempt === maxRetries) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status} for ${url} (after ${attempt + 1} attempts): ${body.slice(0, 200)}`);
    }

    const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
    console.error(`  [retry] HTTP ${res.status} — waiting ${(delay / 1000).toFixed(1)}s (attempt ${attempt + 1}/${maxRetries})...`);
    await sleep(delay);
  }
}

/**
 * Fetch the property list page (first page).
 */
async function fetchListPage(town = 'Providence') {
  const url = `${BASE_URL}/PropertyList.aspx?town=${encodeURIComponent(town)}&Search=`;
  const res = await fetchWithRetry(url, { headers: HEADERS });
  const html = await res.text();
  return { document: new JSDOM(html).window.document, html };
}

/**
 * Fetch the next page of results by POSTing ASP.NET form state.
 */
async function fetchNextPage(town, viewState, eventValidation, pageCommand = 'Page$Next') {
  const url = `${BASE_URL}/PropertyList.aspx?town=${encodeURIComponent(town)}&Search=`;
  const body = new URLSearchParams({
    '__VIEWSTATE': viewState,
    '__EVENTVALIDATION': eventValidation,
    '__EVENTTARGET': 'ctl00$PropertyList$GridView1',
    '__EVENTARGUMENT': pageCommand,
  });

  const res = await fetchWithRetry(url, {
    method: 'POST',
    headers: { ...HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const html = await res.text();
  return { document: new JSDOM(html).window.document, html };
}

/**
 * Extract ASP.NET form state from a document.
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
  return !!table.querySelector('a[href*="Page$Next"]');
}

/**
 * Fetch a property detail page.
 */
async function fetchDetailPage(detailPath) {
  const url = detailPath.startsWith('http') ? detailPath : `${BASE_URL}/${detailPath}`;
  const res = await fetchWithRetry(url, { headers: HEADERS });
  const html = await res.text();
  return { document: new JSDOM(html).window.document, html };
}

module.exports = { fetchListPage, fetchNextPage, getFormState, hasNextPage, fetchDetailPage, BASE_URL };
