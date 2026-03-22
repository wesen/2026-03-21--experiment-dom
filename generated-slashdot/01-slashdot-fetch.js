// 01-slashdot-fetch.js
// Fetches the Slashdot homepage HTML and returns a parsed jsdom Document.
//
// Usage (as a module):
//   const fetchPage = require('./01-slashdot-fetch');
//   const { document, html } = await fetchPage();
//
// Exports: async () => { document, html }

'use strict';

const https = require('https');
const { JSDOM } = require('jsdom');

const URL = 'https://slashdot.org/';

/**
 * Fetch the Slashdot homepage and parse it into a jsdom Document.
 * Returns { document, html }.
 */
async function fetchPage() {
  const html = await new Promise((resolve, reject) => {
    const options = {
      headers: {
        // Mimic a real browser to avoid bot-detection blocks
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    };

    https.get(URL, options, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${URL}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    }).on('error', reject);
  });

  const dom = new JSDOM(html, { url: URL });
  return { document: dom.window.document, html };
}

module.exports = fetchPage;
