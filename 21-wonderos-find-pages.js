// 21-wonderos-find-pages.js — Find all internal pages linked from wonderos.org
const { JSDOM } = require('jsdom');

async function main() {
  const res = await fetch('https://wonderos.org/');
  const html = await res.text();
  const { document } = new JSDOM(html).window;

  // Collect all internal links
  const internal = new Set();
  const external = new Set();

  document.querySelectorAll('a').forEach(a => {
    const href = a.getAttribute('href') || '';
    const text = a.textContent.trim();
    if (href.startsWith('/') && href !== '/') {
      internal.add(href);
    } else if (href.startsWith('http') && !href.includes('wonderos.org')) {
      external.add(href);
    } else if (href.includes('wonderos.org') && href !== 'https://wonderos.org/') {
      // Absolute internal link
      const path = new URL(href).pathname;
      if (path !== '/') internal.add(path);
    }
  });

  console.log('Internal pages:');
  [...internal].forEach(p => console.log(`  ${p}`));

  console.log(`\nExternal links (${external.size}):`);
  [...external].forEach(p => console.log(`  ${p}`));

  // Now fetch each internal page and see what's there
  console.log('\n=== Fetching internal pages ===');
  for (const path of internal) {
    const url = `https://wonderos.org${path}`;
    try {
      const r = await fetch(url);
      const h = await r.text();
      const { document: doc } = new JSDOM(h).window;
      const title = doc.querySelector('title')?.textContent.trim() || '';
      const h1 = doc.querySelector('h1')?.textContent.trim() || '';
      const h1Img = doc.querySelector('h1 img')?.getAttribute('alt') || '';
      const sections = doc.querySelectorAll('section').length;
      const paragraphs = doc.querySelectorAll('p').length;
      const links = doc.querySelectorAll('a').length;
      console.log(`\n  ${url}`);
      console.log(`    title: "${title}" | h1: "${h1 || h1Img}" | sections: ${sections} | p: ${paragraphs} | a: ${links}`);
      console.log(`    length: ${h.length} chars`);

      // Check for sub-pages linked from this page
      const subLinks = new Set();
      doc.querySelectorAll('a').forEach(a => {
        const href = a.getAttribute('href') || '';
        if (href.startsWith('/') && href !== '/' && !internal.has(href)) {
          subLinks.add(href);
        }
      });
      if (subLinks.size > 0) {
        console.log(`    sub-pages: ${[...subLinks].join(', ')}`);
      }
    } catch (e) {
      console.log(`  ${url} — ERROR: ${e.message}`);
    }
  }
}

main().catch(console.error);
