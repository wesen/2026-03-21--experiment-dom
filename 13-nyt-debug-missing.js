// 13-nyt-debug-missing.js — Check which stories are extracted vs what we saw in exploration
const { JSDOM } = require('jsdom');
const { extractStories } = require('./10-nyt-extract-stories');

async function main() {
  const res = await fetch('https://www.nytimes.com/');
  const html = await res.text();
  const { document } = new JSDOM(html).window;

  const stories = extractStories(document);

  // Check: is the Baby Reindeer / Gadd story present?
  const gadd = stories.find(s => /Gadd|Baby Reindeer/i.test(s.headline));
  console.log('Baby Reindeer story:', gadd ? `FOUND — section=${gadd.section}` : 'MISSING');

  // Print all sections found
  const sections = new Map();
  stories.forEach(s => {
    const sec = s.section || 'other';
    if (!sections.has(sec)) sections.set(sec, 0);
    sections.set(sec, sections.get(sec) + 1);
  });
  console.log('\nSection counts:');
  [...sections.entries()].sort((a, b) => b[1] - a[1]).forEach(([sec, count]) => {
    console.log(`  ${sec}: ${count}`);
  });

  // List all headlines
  console.log(`\nAll ${stories.length} stories:`);
  stories.forEach((s, i) => {
    const label = s.isSecondary ? ' (related)' : '';
    const live = s.isLive ? ' [LIVE]' : '';
    console.log(`  ${i + 1}. [${s.section}]${live} ${s.headline}${label}`);
  });
}

main().catch(console.error);
