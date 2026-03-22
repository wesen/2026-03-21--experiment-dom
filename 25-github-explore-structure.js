// 25-github-explore-structure.js — Initial DOM inventory of a GitHub repo page
const { JSDOM } = require('jsdom');

async function main() {
  const url = 'https://github.com/alexobenauer/Wonder';
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; dom-scraper/1.0)' }
  });
  console.log('HTTP status:', res.status);
  const html = await res.text();
  console.log('HTML length:', html.length);

  const { document } = new JSDOM(html).window;

  // Tag inventory
  const tags = ['article', 'section', 'nav', 'header', 'footer', 'main',
                'h1', 'h2', 'h3', 'h4', 'a', 'p', 'li', 'table', 'tr', 'td',
                'details', 'summary', 'svg', 'relative-time'];
  tags.forEach(tag => {
    const count = document.querySelectorAll(tag).length;
    if (count > 0) console.log(`  ${tag}: ${count}`);
  });

  // Check for JSON data embedded in the page (GitHub uses turbo frames / JSON islands)
  console.log('\n--- Script tags with application/json or embedded data ---');
  document.querySelectorAll('script[type="application/json"], script[data-target]').forEach((s, i) => {
    const type = s.getAttribute('type') || '';
    const target = s.getAttribute('data-target') || '';
    const len = s.textContent.length;
    console.log(`  [${i}] type="${type}" target="${target}" length=${len}`);
  });

  // Look for react/turbo data attributes
  console.log('\n--- data-testid elements ---');
  const testids = new Set();
  document.querySelectorAll('[data-testid]').forEach(el =>
    testids.add(el.getAttribute('data-testid'))
  );
  console.log(`  ${testids.size} unique:`, [...testids].slice(0, 30));

  // Key GitHub-specific elements
  console.log('\n--- GitHub-specific elements ---');
  const checks = {
    'repo name': 'strong[itemprop="name"] a, a[data-pjax="#repo-content-pjax-container"]',
    'repo description': '[itemprop="about"], .f4.my-3, .BorderGrid-cell p',
    'language': '[itemprop="programmingLanguage"], [data-ga-click*="language"]',
    'file tree': '.js-details-container .js-navigation-container, [aria-labelledby*="folders"], react-app',
    'readme': '#readme, article.markdown-body, [data-target="readme-toc.content"]',
    'topics': '.topic-tag, a[data-octo-click="topic_click"]',
    'stars': '#repo-stars-counter-star, .social-count',
    'about sidebar': '.BorderGrid-row .BorderGrid-cell',
  };

  for (const [label, selector] of Object.entries(checks)) {
    const els = document.querySelectorAll(selector);
    if (els.length > 0) {
      const text = els[0].textContent.trim().slice(0, 100);
      console.log(`  ${label} (${els.length}): "${text}"`);
    } else {
      console.log(`  ${label}: NOT FOUND`);
    }
  }

  // Headings
  console.log('\n--- Headings ---');
  ['h1', 'h2', 'h3'].forEach(tag => {
    document.querySelectorAll(tag).forEach((h, i) => {
      const text = h.textContent.trim().replace(/\s+/g, ' ').slice(0, 100);
      if (text) console.log(`  ${tag}[${i}]: "${text}"`);
    });
  });

  // Look for the file listing — GitHub renders this in different ways
  console.log('\n--- File listing patterns ---');
  // Traditional: table rows with icons and filenames
  const treeRows = document.querySelectorAll('.js-navigation-item, [class*="TreeView"], tr.react-directory-row');
  console.log(`  .js-navigation-item / TreeView / react-directory-row: ${treeRows.length}`);

  // React app (newer GitHub)
  const reactApp = document.querySelector('react-app');
  if (reactApp) {
    console.log(`  react-app found, length: ${reactApp.textContent.length}`);
    // Check for embedded JSON payload
    const scriptInReact = reactApp.querySelector('script[type="application/json"]');
    if (scriptInReact) {
      const data = scriptInReact.textContent.slice(0, 500);
      console.log(`  react-app script payload (first 500): ${data}`);
    }
  }

  // Check for turbo-frame
  const turboFrames = document.querySelectorAll('turbo-frame');
  console.log(`\n  turbo-frame elements: ${turboFrames.length}`);
  turboFrames.forEach((f, i) => {
    const id = f.getAttribute('id') || '';
    const src = f.getAttribute('src') || '';
    console.log(`    [${i}] id="${id}" src="${src}"`);
  });

  // README content
  console.log('\n--- README ---');
  const readme = document.querySelector('#readme, article.markdown-body');
  if (readme) {
    console.log(`  Found, length: ${readme.textContent.length}`);
    console.log(`  First 300 chars: "${readme.textContent.trim().slice(0, 300)}"`);
  } else {
    console.log('  NOT FOUND in initial HTML');
  }
}

main().catch(console.error);
