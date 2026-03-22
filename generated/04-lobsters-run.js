// 04-lobsters-run.js
// Orchestrates the full Lobste.rs scraping pipeline:
//   fetch → extract → markdown → write file + print to stdout
//
// Usage:
//   node 04-lobsters-run.js                   # scrapes lobste.rs homepage
//   node 04-lobsters-run.js [url] [outfile]   # optional overrides

'use strict';

const fs   = require('fs');
const path = require('path');

const { fetchPage }     = require('./01-lobsters-fetch');
const { extractStories } = require('./02-lobsters-extract');
const { toMarkdown }    = require('./03-lobsters-to-markdown');

async function main() {
  const url     = process.argv[2] || undefined;           // optional override
  const outFile = process.argv[3] || 'lobsters-output.md';

  console.log(`⏳  Fetching ${url || 'https://lobste.rs/'} ...`);

  const { document, url: fetchedUrl } = await fetchPage(url);

  console.log('🔍  Extracting stories...');
  const stories = extractStories(document);
  console.log(`✅  Found ${stories.length} stories.`);

  const fetchedAt = new Date();
  const md = toMarkdown(stories, { sourceUrl: fetchedUrl, fetchedAt });

  // Write to file
  const outPath = path.resolve(outFile);
  fs.writeFileSync(outPath, md, 'utf8');
  console.log(`📄  Written to: ${outPath}`);
  console.log('');

  // Also print to stdout
  console.log(md);
}

main().catch(err => {
  console.error('❌  Error:', err.message);
  process.exit(1);
});
