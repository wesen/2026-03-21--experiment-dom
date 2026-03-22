// 27-github-explore-overview.js — Extract the overview data from GitHub's JSON payload
const { JSDOM } = require('jsdom');

async function main() {
  const url = 'https://github.com/alexobenauer/Wonder';
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; dom-scraper/1.0)' }
  });
  const html = await res.text();
  const { document } = new JSDOM(html).window;

  const reactApp = document.querySelector('react-app');
  const jsonScript = reactApp?.querySelector('script[type="application/json"]');
  if (!jsonScript) { console.log('No JSON payload found'); return; }

  const data = JSON.parse(jsonScript.textContent);
  const payload = data.payload || data;
  const route = payload.codeViewRepoRoute;

  // Overview section
  const overview = route?.overview;
  if (overview) {
    console.log('=== overview keys ===');
    console.log(Object.keys(overview));

    // Print each key's value type and preview
    for (const [key, val] of Object.entries(overview)) {
      if (val === null || val === undefined) {
        console.log(`  ${key}: null`);
      } else if (typeof val === 'string') {
        console.log(`  ${key}: "${val.slice(0, 100)}"`);
      } else if (typeof val === 'number' || typeof val === 'boolean') {
        console.log(`  ${key}: ${val}`);
      } else if (Array.isArray(val)) {
        console.log(`  ${key}: Array(${val.length})`);
        if (val.length > 0 && val.length <= 10) {
          val.forEach((item, i) => {
            if (typeof item === 'object') {
              console.log(`    [${i}]: ${JSON.stringify(item).slice(0, 150)}`);
            } else {
              console.log(`    [${i}]: ${item}`);
            }
          });
        }
      } else if (typeof val === 'object') {
        console.log(`  ${key}: Object(${Object.keys(val).length} keys) — ${Object.keys(val).slice(0, 8).join(', ')}`);
        // Print a preview for small objects
        const json = JSON.stringify(val);
        if (json.length < 300) console.log(`    ${json}`);
      }
    }
  }

  // Tree metadata
  const tree = route?.tree;
  if (tree) {
    console.log('\n=== tree keys ===');
    console.log(Object.keys(tree));

    // Check each tree item for extra metadata
    if (tree.items?.length > 0) {
      console.log('\nTree item keys:', Object.keys(tree.items[0]));
      tree.items.forEach(item => {
        console.log(`  ${item.contentType === 'directory' ? '📁' : '📄'} ${item.name}`);
        // Print all keys except name and contentType
        const extra = Object.entries(item).filter(([k]) => !['name', 'contentType'].includes(k));
        if (extra.length > 0) {
          extra.forEach(([k, v]) => {
            const val = typeof v === 'string' ? `"${v.slice(0, 80)}"` : JSON.stringify(v)?.slice(0, 80);
            console.log(`    ${k}: ${val}`);
          });
        }
      });
    }
  }

  // Layout route (may have repo-level metadata)
  const layout = payload.codeViewLayoutRoute;
  if (layout) {
    console.log('\n=== codeViewLayoutRoute keys ===');
    console.log(Object.keys(layout));
  }
}

main().catch(console.error);
