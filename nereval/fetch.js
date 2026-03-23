// nereval/fetch.js — Fetch nereval pages with ASP.NET form state, proxy support, retry
const { JSDOM } = require('jsdom');
const { HttpsProxyAgent } = require('https-proxy-agent');

const BASE_URL = 'https://data.nereval.com';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Proxy state — set via setProxy() or environment
let proxyAgent = null;
let proxyUrl = null;

/**
 * Configure an HTTP proxy for all requests.
 * Supports URLs like:
 *   http://user:pass@host:port
 *   http://host:port
 * Also supports the curl-style format user:pass@host:port (prepends http://)
 * @param {string} url
 */
function setProxy(url) {
  if (!url) { proxyAgent = null; proxyUrl = null; return; }
  // Normalize: if no scheme, prepend http://
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'http://' + url;
  }
  proxyUrl = url;
  proxyAgent = new HttpsProxyAgent(url);
}

/**
 * Get the current proxy URL (masked password) or null.
 */
function getProxyInfo() {
  if (!proxyUrl) return null;
  return proxyUrl.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Build fetch init with optional proxy dispatcher.
 */
function buildInit(init = {}) {
  if (proxyAgent) {
    return { ...init, dispatcher: proxyAgent };
  }
  return init;
}

/**
 * Fetch with retry and exponential backoff.
 * Retries on 403, 429, 500, 502, 503, 529.
 */
async function fetchWithRetry(url, init = {}, { maxRetries = 3, baseDelay = 2000 } = {}) {
  const finalInit = buildInit(init);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Node's fetch doesn't support `dispatcher` for proxy — use the agent's fetch if available
      let res;
      if (proxyAgent) {
        // https-proxy-agent works with Node's http/https modules, not fetch directly.
        // Use a wrapper that creates a proper request through the proxy.
        res = await fetchViaProxy(url, finalInit);
      } else {
        res = await fetch(url, init);
      }

      if (res.ok) return res;

      const retryable = [403, 429, 500, 502, 503, 529].includes(res.status);
      if (!retryable || attempt === maxRetries) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status} for ${url} (after ${attempt + 1} attempts): ${body.slice(0, 200)}`);
      }

      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
      console.error(`  [retry] HTTP ${res.status} — waiting ${(delay / 1000).toFixed(1)}s (attempt ${attempt + 1}/${maxRetries})...`);
      await sleep(delay);
    } catch (err) {
      if (attempt === maxRetries) throw err;
      if (err.message.includes('HTTP ')) throw err; // don't retry our own thrown errors
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
      console.error(`  [retry] ${err.message.slice(0, 80)} — waiting ${(delay / 1000).toFixed(1)}s (attempt ${attempt + 1}/${maxRetries})...`);
      await sleep(delay);
    }
  }
}

/**
 * Fetch a URL through the configured proxy using Node's https module.
 * Returns a Response-like object compatible with the rest of the code.
 */
function fetchViaProxy(url, init = {}) {
  const https = require('https');
  const http = require('http');
  const { URL } = require('url');

  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: init.method || 'GET',
      headers: { ...HEADERS, ...(init.headers || {}) },
      agent: proxyAgent,
    };

    const proto = parsed.protocol === 'https:' ? https : http;
    const req = proto.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          headers: res.headers,
          text: async () => body,
          json: async () => JSON.parse(body),
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(new Error('Request timeout')); });

    if (init.body) {
      req.write(init.body);
    }
    req.end();
  });
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

module.exports = { fetchListPage, fetchNextPage, getFormState, hasNextPage, fetchDetailPage, setProxy, getProxyInfo, BASE_URL };
