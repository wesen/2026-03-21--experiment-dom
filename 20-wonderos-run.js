// 20-wonderos-run.js — Main script: fetch WonderOS, extract, convert, output
const { fetchWonderOS } = require('./17-wonderos-fetch');
const { extractContent } = require('./18-wonderos-extract');
const { toMarkdown } = require('./19-wonderos-to-markdown');
const fs = require('fs');

async function main() {
  console.error('Fetching WonderOS...');
  const document = await fetchWonderOS();

  console.error('Extracting content from DOM...');
  const content = extractContent(document);
  console.error(`Found ${content.pillars.length} pillars, ${content.description.length} description paragraphs, ${content.outputs.length} output sections`);

  const md = toMarkdown(content);

  fs.writeFileSync('wonderos.md', md);
  console.error('Written to wonderos.md');

  console.log(md);
}

main().catch(err => { console.error(err); process.exit(1); });
