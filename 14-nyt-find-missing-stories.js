// 14-nyt-find-missing-stories.js — Find stories that our extractor misses
const { JSDOM } = require('jsdom');
const { extractStories } = require('./10-nyt-extract-stories');

async function main() {
  const res = await fetch('https://www.nytimes.com/');
  const html = await res.text();
  const { document } = new JSDOM(html).window;

  const extracted = extractStories(document);
  const extractedHrefs = new Set(extracted.map(s => s.href));

  const mainNode = document.querySelectorAll('[data-testid="programming-node"]')[0];

  // Find all story-wrappers we skipped
  console.log('=== Skipped story-wrappers ===');
  const wrappers = mainNode.querySelectorAll('.story-wrapper');
  let skippedCount = 0;
  wrappers.forEach((w, i) => {
    const link = w.querySelector('a');
    const href = link?.getAttribute('href') || '';
    if (extractedHrefs.has(href)) return;

    const headlineP = w.querySelector('p.indicate-hover');
    const headline = headlineP?.textContent.trim() || '';
    const allText = w.textContent.trim().slice(0, 200);

    // Check if there are any <p> elements at all
    const ps = [...w.querySelectorAll('p')];
    const pTexts = ps.map(p => `"${p.textContent.trim().slice(0, 60)}" cls=${p.className}`);

    if (headline || allText.length > 20) {
      skippedCount++;
      console.log(`\n  wrapper[${i}]:`);
      console.log(`    href: "${href}"`);
      console.log(`    headline (indicate-hover): "${headline}"`);
      console.log(`    ps: ${pTexts.join(' | ')}`);
      console.log(`    raw text: "${allText.slice(0, 150)}"`);

      // Check for alternative headline patterns
      const h3 = w.querySelector('h3');
      const h2 = w.querySelector('h2');
      const strongOrB = w.querySelector('strong, b');
      if (h3) console.log(`    h3: "${h3.textContent.trim().slice(0, 80)}"`);
      if (h2) console.log(`    h2: "${h2.textContent.trim().slice(0, 80)}"`);
      if (strongOrB) console.log(`    strong/b: "${strongOrB.textContent.trim().slice(0, 80)}"`);
    }
  });
  console.log(`\nTotal skipped wrappers with content: ${skippedCount}`);

  // Specifically find the Gadd/Baby Reindeer story
  console.log('\n=== Searching for "Gadd" or "Baby Reindeer" in full HTML ===');
  const gaddIndex = html.indexOf('Gadd');
  if (gaddIndex !== -1) {
    console.log(`Found "Gadd" at index ${gaddIndex}`);
    console.log(`Context: ...${html.slice(gaddIndex - 100, gaddIndex + 200)}...`);
  }

  // Find the magazine article link
  const magazineLink = mainNode.querySelector('a[href*="magazine"]');
  if (magazineLink) {
    console.log(`\nMagazine link found: href="${magazineLink.getAttribute('href')}"`);
    const wrapper = magazineLink.closest('.story-wrapper');
    if (wrapper) {
      console.log('  In a story-wrapper');
      const headlineP = wrapper.querySelector('p.indicate-hover');
      console.log(`  indicate-hover p: "${headlineP?.textContent.trim() || 'NONE'}"`);
      const allPs = [...wrapper.querySelectorAll('p')];
      allPs.forEach((p, j) => console.log(`  p[${j}]: cls="${p.className}" text="${p.textContent.trim().slice(0, 80)}"`));
    } else {
      console.log('  NOT in a story-wrapper');
      const parent = magazineLink.parentElement;
      console.log(`  parent: <${parent?.tagName}> class="${parent?.className}"`);
    }
  }
}

main().catch(console.error);
