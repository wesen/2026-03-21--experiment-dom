// 04-slashdot-run.js
// Orchestrates the full Slashdot extraction pipeline:
//   fetch → extract → markdown → write file + stdout
//
// Usage:
//   node 04-slashdot-run.js
//
// Output:
//   slashdot-output.md  (written next to this script)
//   stdout              (same markdown content)

'use strict';

const path = require('path');
const fs = require('fs');

const fetchPage  = require('./01-slashdot-fetch');
const extract    = require('./02-slashdot-extract');
const toMarkdown = require('./03-slashdot-to-markdown');

const OUTPUT_FILE = path.join(__dirname, 'slashdot-output.md');

async function run() {
  console.error('⏳  Fetching https://slashdot.org/ ...');
  const { document } = await fetchPage();

  console.error('🔍  Extracting stories...');
  const stories = extract(document);

  if (stories.length === 0) {
    console.error('⚠️   No stories found — the site structure may have changed.');
    process.exit(1);
  }

  console.error(`✅  Found ${stories.length} stories.`);

  // Quick preview to stderr
  stories.forEach((s, i) => {
    console.error(`  ${i + 1}. [${s.topic || 'N/A'}] ${s.title} (${s.comments} comments)`);
  });

  console.error('📝  Converting to Markdown...');
  const markdown = toMarkdown(stories);

  fs.writeFileSync(OUTPUT_FILE, markdown, 'utf8');
  console.error(`💾  Written to: ${OUTPUT_FILE}`);
  console.error('');

  // Print to stdout so callers can pipe / redirect
  process.stdout.write(markdown);
}

run().catch((err) => {
  console.error('❌  Fatal error:', err.message);
  process.exit(1);
});
