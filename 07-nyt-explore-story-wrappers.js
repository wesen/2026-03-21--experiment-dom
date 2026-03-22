// 07-nyt-explore-story-wrappers.js — Explore the story-wrapper elements in detail
const { JSDOM } = require('jsdom');

async function main() {
  const res = await fetch('https://www.nytimes.com/');
  const html = await res.text();
  const { document } = new JSDOM(html).window;

  const wrappers = document.querySelectorAll('.story-wrapper');
  console.log(`Found ${wrappers.length} .story-wrapper elements\n`);

  wrappers.forEach((w, i) => {
    // Find the headline — look for p.indicate-hover or the main <a> text
    const headlineLink = w.querySelector('a');
    const href = headlineLink?.getAttribute('href') || '';

    // The headline text is in a <p> with class "indicate-hover"
    const headlineP = w.querySelector('p.indicate-hover');
    const headline = headlineP?.textContent.trim() || headlineLink?.textContent.trim() || '';

    // Summary is in p.summary-class
    const summaryP = w.querySelector('p.summary-class');
    const summary = summaryP?.textContent.trim() || '';

    // Section/kicker — often in a p before the headline
    const kickerP = w.querySelector('p:not(.indicate-hover):not(.summary-class)');
    const kicker = kickerP?.textContent.trim() || '';

    // Byline
    const byline = w.querySelector('.css-1n7hynb, [class*="byline"]')?.textContent.trim() || '';

    // Read time
    const readTime = [...w.querySelectorAll('p')].find(p => /min read/.test(p.textContent))?.textContent.trim() || '';

    // Related links (li > a pattern)
    const relatedLinks = [...w.querySelectorAll('ul a, li a')].map(a => ({
      text: a.textContent.trim().slice(0, 60),
      href: a.getAttribute('href')
    }));

    if (headline) {
      console.log(`--- Story ${i + 1} ---`);
      console.log(`  kicker: "${kicker}"`);
      console.log(`  headline: "${headline.slice(0, 100)}"`);
      console.log(`  summary: "${summary.slice(0, 120)}"`);
      console.log(`  href: "${href}"`);
      console.log(`  readTime: "${readTime}"`);
      console.log(`  byline: "${byline}"`);
      if (relatedLinks.length) {
        console.log(`  related (${relatedLinks.length}):`);
        relatedLinks.forEach(r => console.log(`    - "${r.text}" → ${r.href}`));
      }
      console.log();
    }
  });

  // Also check if there are stories NOT in .story-wrapper
  // Look for all <a> with article URLs that are direct children of other containers
  console.log('\n=== Stories outside .story-wrapper ===');
  const allStoryHrefs = new Set(
    [...document.querySelectorAll('.story-wrapper a')].map(a => a.getAttribute('href'))
  );

  const otherArticleLinks = [...document.querySelectorAll('[data-testid="programming-node"] a')]
    .filter(a => {
      const href = a.getAttribute('href') || '';
      return /\/20(25|26)\//.test(href) && !allStoryHrefs.has(href);
    });

  const seen = new Set();
  otherArticleLinks.forEach(a => {
    const href = a.getAttribute('href');
    const text = a.textContent.trim().slice(0, 80);
    if (!seen.has(href) && text.length > 10) {
      seen.add(href);
      const parent = a.closest('.story-wrapper, [class*="story"], section, div[class]');
      const parentCls = parent?.className?.split(' ').slice(0, 2).join('.') || 'unknown';
      console.log(`  "${text}" → ${href} (parent: ${parentCls})`);
    }
  });
}

main().catch(console.error);
