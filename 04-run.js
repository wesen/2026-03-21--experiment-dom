// 04-run.js — Main script: fetch, extract, convert, output
const { fetchHN } = require('./01-fetch-hn');
const { extractStories } = require('./02-extract-stories');
const { toMarkdown } = require('./03-to-markdown');
const fs = require('fs');

async function main() {
  console.error('Fetching Hacker News...');
  const document = await fetchHN();

  console.error('Extracting stories from DOM...');
  const stories = extractStories(document);
  console.error(`Found ${stories.length} stories`);

  const md = toMarkdown(stories);

  fs.writeFileSync('hn-frontpage.md', md);
  console.error('Written to hn-frontpage.md');

  // Also print to stdout
  console.log(md);
}

main().catch(err => { console.error(err); process.exit(1); });
