// 26-github-explore-data.js — Extract structured data from GitHub's JSON payload and sidebar
const { JSDOM } = require('jsdom');

async function main() {
  const url = 'https://github.com/alexobenauer/Wonder';
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; dom-scraper/1.0)' }
  });
  const html = await res.text();
  const { document } = new JSDOM(html).window;

  // === 1. File tree from JSON payload ===
  console.log('=== File Tree (from react-app JSON) ===');
  const reactApp = document.querySelector('react-app');
  const jsonScript = reactApp?.querySelector('script[type="application/json"]');
  if (jsonScript) {
    const data = JSON.parse(jsonScript.textContent);
    const payload = data.payload || data;

    // Tree items
    const tree = payload.codeViewRepoRoute?.tree || payload.tree;
    if (tree?.items) {
      console.log(`\nFiles/folders (${tree.items.length}):`);
      tree.items.forEach(item => {
        const icon = item.contentType === 'directory' ? '📁' : '📄';
        console.log(`  ${icon} ${item.name} (${item.contentType})`);
      });
    }

    // Ref info (branch)
    const refInfo = payload.codeViewRepoRoute?.refInfo;
    if (refInfo) {
      console.log(`\nBranch: ${refInfo.name} (${refInfo.refType})`);
      console.log(`Current OID: ${refInfo.currentOid}`);
    }

    // Check what other keys are in the payload
    console.log('\nTop-level payload keys:', Object.keys(payload));
    if (payload.codeViewRepoRoute) {
      console.log('codeViewRepoRoute keys:', Object.keys(payload.codeViewRepoRoute));
    }

    // Overview (repo metadata might be here)
    if (payload.overview) {
      console.log('\noverview keys:', Object.keys(payload.overview));
    }
  }

  // === 2. Sidebar metadata from DOM ===
  console.log('\n\n=== Sidebar (from DOM) ===');

  // About section
  const aboutCell = document.querySelector('.BorderGrid-row .BorderGrid-cell');
  if (aboutCell) {
    const aboutText = aboutCell.textContent.trim().replace(/\s+/g, ' ').slice(0, 200);
    console.log(`About: "${aboutText}"`);
  }

  // All BorderGrid rows (sidebar sections)
  const borderRows = document.querySelectorAll('.BorderGrid-row');
  console.log(`\nBorderGrid rows: ${borderRows.length}`);
  borderRows.forEach((row, i) => {
    const heading = row.querySelector('h2, h3');
    const headingText = heading?.textContent.trim().replace(/\s+/g, ' ') || '';
    const cellText = row.textContent.trim().replace(/\s+/g, ' ').slice(0, 150);
    console.log(`  [${i}] "${headingText}" → "${cellText}"`);
  });

  // Languages
  console.log('\n--- Languages ---');
  document.querySelectorAll('[itemprop="programmingLanguage"]').forEach(el => {
    const lang = el.textContent.trim();
    const pct = el.parentElement?.textContent.trim().replace(/\s+/g, ' ');
    console.log(`  ${pct}`);
  });

  // Stars, watchers, forks
  console.log('\n--- Social counts ---');
  document.querySelectorAll('.social-count, [id*="counter"]').forEach(el => {
    const label = el.getAttribute('aria-label') || el.textContent.trim();
    console.log(`  ${label}`);
  });

  // === 3. README structure ===
  console.log('\n\n=== README ===');
  const readme = document.querySelector('#readme article, article.markdown-body');
  if (readme) {
    // Extract headings and their hierarchy
    console.log('Headings:');
    readme.querySelectorAll('h1, h2, h3, h4').forEach(h => {
      const level = h.tagName;
      const text = h.textContent.trim().replace(/\s+/g, ' ');
      console.log(`  ${level}: ${text}`);
    });

    // Count elements
    console.log(`\nParagraphs: ${readme.querySelectorAll('p').length}`);
    console.log(`Code blocks: ${readme.querySelectorAll('pre').length}`);
    console.log(`Lists: ${readme.querySelectorAll('ul, ol').length}`);
    console.log(`Links: ${readme.querySelectorAll('a').length}`);
    console.log(`Images: ${readme.querySelectorAll('img').length}`);
  }

  // === 4. Commits info ===
  console.log('\n\n=== Commits ===');
  const commitDetails = document.querySelector('[data-testid="latest-commit-details"]');
  if (commitDetails) {
    console.log(`Latest commit: "${commitDetails.textContent.trim().replace(/\s+/g, ' ').slice(0, 200)}"`);
  }

  // Relative time
  document.querySelectorAll('relative-time').forEach(rt => {
    const datetime = rt.getAttribute('datetime') || '';
    const text = rt.textContent.trim();
    console.log(`  relative-time: ${datetime} → "${text}"`);
  });
}

main().catch(console.error);
