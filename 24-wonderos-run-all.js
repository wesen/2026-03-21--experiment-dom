// 24-wonderos-run-all.js — Fetch all WonderOS pages, extract, and produce a combined markdown
const { JSDOM } = require('jsdom');
const { extractPage, pageToMarkdown } = require('./23-wonderos-generic-extract');
const fs = require('fs');

const PAGES = [
  'https://wonderos.org/',
  'https://wonderos.org/hello/',
  'https://wonderos.org/poster/',
];

async function fetchAndParse(url) {
  const res = await fetch(url);
  const html = await res.text();
  const { document } = new JSDOM(html).window;
  return document;
}

async function main() {
  const date = new Date().toISOString().slice(0, 10);
  const allPages = [];

  for (const url of PAGES) {
    console.error(`Fetching ${url}...`);
    const document = await fetchAndParse(url);
    const page = extractPage(document, url);
    console.error(`  → ${page.title}: ${page.sections.length} sections`);
    allPages.push(page);
  }

  // Build combined markdown
  const parts = allPages.map(p => pageToMarkdown(p));

  const combined = [
    `# WonderOS — Complete Site`,
    ``,
    `> Fetched: ${date} | ${allPages.length} pages`,
    ``,
    `**Pages:**`,
    ``,
    ...allPages.map(p => `- [${p.title}](${p.url})`),
    ``,
    `---`,
    ``,
    ...parts.flatMap(p => [p, '', '---', '']),
    `*Source: [wonderos.org](https://wonderos.org/)*`,
  ].join('\n');

  fs.writeFileSync('wonderos-all.md', combined);
  console.error(`Written to wonderos-all.md (${allPages.length} pages)`);

  console.log(combined);
}

main().catch(err => { console.error(err); process.exit(1); });
