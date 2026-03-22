// 28-github-explore-repo-meta.js — Extract repo metadata and README from the JSON
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
  const data = JSON.parse(jsonScript.textContent);
  const payload = data.payload || data;
  const layout = payload.codeViewLayoutRoute;

  // === Repo metadata ===
  console.log('=== Repo object ===');
  const repo = layout?.repo;
  if (repo) {
    console.log('Keys:', Object.keys(repo));
    for (const [key, val] of Object.entries(repo)) {
      if (val === null || val === undefined) continue;
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        console.log(`  ${key}: ${val}`);
      } else if (Array.isArray(val)) {
        console.log(`  ${key}: Array(${val.length}) ${JSON.stringify(val).slice(0, 100)}`);
      } else if (typeof val === 'object') {
        console.log(`  ${key}: Object — ${JSON.stringify(val).slice(0, 150)}`);
      }
    }
  }

  // === README HTML from overviewFiles ===
  console.log('\n=== README (from overviewFiles) ===');
  const overview = payload.codeViewRepoRoute?.overview;
  const readmeFile = overview?.overviewFiles?.find(f => f.tabName === 'README');
  if (readmeFile) {
    console.log(`displayName: ${readmeFile.displayName}`);
    console.log(`richText length: ${readmeFile.richText?.length}`);

    // Parse the README HTML to extract structure
    const readmeDoc = new JSDOM(readmeFile.richText).window.document;

    console.log('\nHeading hierarchy:');
    readmeDoc.querySelectorAll('h1, h2, h3, h4').forEach(h => {
      const indent = '  '.repeat(parseInt(h.tagName[1]) - 1);
      console.log(`${indent}${h.tagName}: ${h.textContent.trim()}`);
    });

    console.log(`\nParagraphs: ${readmeDoc.querySelectorAll('p').length}`);
    console.log(`Code blocks: ${readmeDoc.querySelectorAll('pre').length}`);
    console.log(`Links: ${readmeDoc.querySelectorAll('a').length}`);

    // First few paragraphs
    console.log('\nFirst 5 paragraphs:');
    [...readmeDoc.querySelectorAll('p')].slice(0, 5).forEach((p, i) => {
      console.log(`  p[${i}]: "${p.textContent.trim().slice(0, 120)}"`);
    });
  }

  // === Sidebar from DOM ===
  console.log('\n=== Sidebar (Languages) ===');
  // Languages are in a specific BorderGrid row
  const langRow = [...document.querySelectorAll('.BorderGrid-row')].find(r =>
    r.querySelector('h2')?.textContent.trim() === 'Languages'
  );
  if (langRow) {
    const langItems = langRow.querySelectorAll('.d-inline-flex, li');
    langItems.forEach(li => {
      const text = li.textContent.trim().replace(/\s+/g, ' ');
      if (text) console.log(`  ${text}`);
    });
    // Also try span-based extraction
    langRow.querySelectorAll('span').forEach(span => {
      const text = span.textContent.trim();
      if (text && /\d/.test(text)) console.log(`  raw: "${text}"`);
    });
  }

  // Stars/watchers/forks from sidebar
  console.log('\n=== Social stats ===');
  const aboutRow = [...document.querySelectorAll('.BorderGrid-row')].find(r =>
    r.querySelector('h2')?.textContent.trim() === 'About'
  );
  if (aboutRow) {
    const text = aboutRow.textContent.trim().replace(/\s+/g, ' ');
    // Extract numbers
    const stars = text.match(/(\d+)\s*stars?/i);
    const watchers = text.match(/(\d+)\s*watching/i);
    const forks = text.match(/(\d+)\s*forks?/i);
    console.log(`  Stars: ${stars?.[1] || '?'}`);
    console.log(`  Watching: ${watchers?.[1] || '?'}`);
    console.log(`  Forks: ${forks?.[1] || '?'}`);
  }
}

main().catch(console.error);
