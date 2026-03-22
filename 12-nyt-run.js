// 12-nyt-run.js — Main script: fetch NYTimes, extract, convert, output
const { fetchNYT } = require('./09-nyt-fetch');
const { extractStories } = require('./10-nyt-extract-stories');
const { toMarkdown } = require('./11-nyt-to-markdown');
const fs = require('fs');

async function main() {
  console.error('Fetching NYTimes...');
  const document = await fetchNYT();

  console.error('Extracting stories from DOM...');
  const stories = extractStories(document);
  console.error(`Found ${stories.length} stories`);

  const md = toMarkdown(stories);

  fs.writeFileSync('nyt-frontpage.md', md);
  console.error('Written to nyt-frontpage.md');

  console.log(md);
}

main().catch(err => { console.error(err); process.exit(1); });
