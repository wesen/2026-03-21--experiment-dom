// 33-github-debug-stars.js — Debug star/social count extraction for popular repos
const { JSDOM } = require('jsdom');

async function main() {
  const url = process.argv[2] || 'https://github.com/anthropics/claude-code';
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; dom-scraper/1.0)' }
  });
  const html = await res.text();
  const { document } = new JSDOM(html).window;

  // Check all BorderGrid rows
  console.log('=== BorderGrid rows ===');
  document.querySelectorAll('.BorderGrid-row').forEach((row, i) => {
    const heading = row.querySelector('h2')?.textContent.trim().replace(/\s+/g, ' ') || '';
    const text = row.textContent.trim().replace(/\s+/g, ' ').slice(0, 200);
    console.log(`  [${i}] "${heading}" → "${text}"`);
  });

  // Check the About row specifically
  console.log('\n=== About row detail ===');
  const aboutRow = [...document.querySelectorAll('.BorderGrid-row')].find(r =>
    r.querySelector('h2')?.textContent.trim() === 'About'
  );
  if (aboutRow) {
    // Check all links/numbers
    aboutRow.querySelectorAll('a, strong, span').forEach(el => {
      const text = el.textContent.trim();
      if (/\d/.test(text) || /star|watch|fork/i.test(text)) {
        console.log(`  <${el.tagName}> class="${el.className}" → "${text}"`);
      }
    });
  }

  // Look for star count with different selectors
  console.log('\n=== Star count search ===');
  const starSelectors = [
    '#repo-stars-counter-star',
    '#repo-stars-counter-unstar',
    '.social-count',
    '[aria-label*="star"]',
    '[data-view-component][id*="star"]',
    'strong[itemprop]',
  ];
  for (const sel of starSelectors) {
    const els = document.querySelectorAll(sel);
    if (els.length) {
      els.forEach(el => {
        const text = el.textContent.trim();
        const ariaLabel = el.getAttribute('aria-label') || '';
        console.log(`  ${sel}: "${text}" aria-label="${ariaLabel}"`);
      });
    }
  }

  // Search for "star" in the whole page
  console.log('\n=== Text containing "star" ===');
  const allText = document.body.textContent;
  const starIdx = allText.indexOf('star');
  if (starIdx !== -1) {
    // Find all occurrences
    let idx = 0;
    let count = 0;
    while ((idx = allText.indexOf('star', idx)) !== -1 && count < 10) {
      const context = allText.slice(Math.max(0, idx - 30), idx + 30).replace(/\s+/g, ' ');
      console.log(`  ...${context}...`);
      idx += 4;
      count++;
    }
  }

  // Check the JSON payload for stars
  console.log('\n=== JSON payload star count ===');
  const reactApp = document.querySelector('react-app');
  const jsonScript = reactApp?.querySelector('script[type="application/json"]');
  if (jsonScript) {
    const text = jsonScript.textContent;
    // Search for "star" in JSON
    const starMatch = text.match(/"stargazers?\w*":\s*(\d+)/i);
    if (starMatch) console.log(`  Found: ${starMatch[0]}`);

    // Check layout route repo
    const data = JSON.parse(text);
    const repo = (data.payload || data).codeViewLayoutRoute?.repo;
    if (repo) console.log(`  repo keys: ${Object.keys(repo)}`);
  }
}

main().catch(console.error);
