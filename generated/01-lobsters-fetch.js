// 01-lobsters-fetch.js
// Fetches the Lobste.rs homepage HTML and returns a parsed jsdom Document.
// Usage: const { fetchPage } = require('./01-lobsters-fetch');
//        const document = await fetchPage();

'use strict';

const { JSDOM } = require('jsdom');

const BASE_URL = 'https://lobste.rs/';

/**
 * Fetch the Lobste.rs homepage and return a jsdom Document.
 * @param {string} [url] - Optional override URL (defaults to lobste.rs homepage)
 * @returns {Promise<{document: Document, url: string}>}
 */
async function fetchPage(url = BASE_URL) {
  const res = await fetch(url, {
    headers: {
      // Be a polite scraper
      'User-Agent': 'Mozilla/5.0 (compatible; lobsters-scraper/1.0)',
      'Accept': 'text/html,application/xhtml+xml',
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
  }

  const html = await res.text();
  const dom = new JSDOM(html, { url });
  return { document: dom.window.document, url };
}

module.exports = { fetchPage, BASE_URL };
