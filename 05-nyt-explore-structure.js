// 05-nyt-explore-structure.js — Fetch NYTimes and explore DOM structure
const { JSDOM } = require('jsdom');

async function main() {
  const res = await fetch('https://www.nytimes.com/');
  const html = await res.text();
  const { document } = new JSDOM(html).window;

  console.log('HTML length:', html.length);
  console.log('article tags:', document.querySelectorAll('article').length);
  console.log('section tags:', document.querySelectorAll('section').length);
  console.log('h2 tags:', document.querySelectorAll('h2').length);
  console.log('h3 tags:', document.querySelectorAll('h3').length);
  console.log('a tags:', document.querySelectorAll('a').length);

  // data-testid elements (NYT uses these heavily)
  const testids = new Set();
  document.querySelectorAll('[data-testid]').forEach(el =>
    testids.add(el.getAttribute('data-testid'))
  );
  console.log('\nunique data-testid values:', [...testids]);

  // programming-node sections (story containers)
  const progNodes = document.querySelectorAll('[data-testid="programming-node"]');
  console.log('\nprogramming-node count:', progNodes.length);
  progNodes.forEach((node, i) => {
    const h2s = node.querySelectorAll('h2');
    const h3s = node.querySelectorAll('h3');
    const ps = node.querySelectorAll('p');
    const as = node.querySelectorAll('a');
    console.log(`  node[${i}]: h2=${h2s.length} h3=${h3s.length} p=${ps.length} a=${as.length}`);
  });

  // Named sections
  console.log('\n--- Named sections ---');
  document.querySelectorAll('section').forEach((sec, i) => {
    const id = sec.getAttribute('id') || '';
    const testid = sec.getAttribute('data-testid') || '';
    if (id || testid) {
      console.log(`  section[${i}]: id="${id}" data-testid="${testid}"`);
    }
  });

  // All h2 headlines
  console.log('\n--- H2 headlines ---');
  document.querySelectorAll('h2').forEach((h, i) => {
    const text = h.textContent.trim().slice(0, 120);
    if (text) console.log(`  h2[${i}]: ${text}`);
  });
}

main().catch(console.error);
