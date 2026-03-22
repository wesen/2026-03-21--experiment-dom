// 08-nyt-explore-sections.js — Map out the section structure of NYT front page
const { JSDOM } = require('jsdom');

async function main() {
  const res = await fetch('https://www.nytimes.com/');
  const html = await res.text();
  const { document } = new JSDOM(html).window;

  // Each programming-node is a major section block
  const progNodes = document.querySelectorAll('[data-testid="programming-node"]');
  console.log(`Found ${progNodes.length} programming-node sections\n`);

  progNodes.forEach((node, i) => {
    // Find section headers (h2)
    const h2s = [...node.querySelectorAll('h2')].map(h => h.textContent.trim());

    // Find story-wrappers with actual headlines
    const stories = [...node.querySelectorAll('.story-wrapper')].filter(w => {
      const headline = w.querySelector('p.indicate-hover');
      const href = w.querySelector('a')?.getAttribute('href');
      return headline && href;
    });

    // Related links outside story-wrappers (li > a pattern)
    const relatedLinks = [...node.querySelectorAll('ul li a')]
      .filter(a => /\/20(25|26)\//.test(a.getAttribute('href') || ''))
      .map(a => a.textContent.trim().slice(0, 60));

    console.log(`=== Programming Node ${i} ===`);
    console.log(`  h2s: ${JSON.stringify(h2s)}`);
    console.log(`  story-wrappers with headline+href: ${stories.length}`);
    if (relatedLinks.length) {
      console.log(`  related links: ${relatedLinks.length} — ${relatedLinks.slice(0, 5).join(', ')}`);
    }

    stories.forEach((w, j) => {
      const headline = w.querySelector('p.indicate-hover')?.textContent.trim().slice(0, 80);
      const kicker = w.querySelector('p:not(.indicate-hover):not(.summary-class)')?.textContent.trim();
      const href = w.querySelector('a')?.getAttribute('href');
      // Figure out the section by looking at the href path
      const section = href?.match(/nytimes\.com\/(?:20\d\d\/\d\d\/\d\d\/)?([^/]+)/)?.[1] || '';
      console.log(`    [${j}] "${headline}" section="${section}" kicker="${kicker || ''}"`);
    });
    console.log();
  });
}

main().catch(console.error);
