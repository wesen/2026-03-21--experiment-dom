// 16-wonderos-explore-content.js — Extract all text content from wonderos.org
const { JSDOM } = require('jsdom');

async function main() {
  const res = await fetch('https://wonderos.org/');
  const html = await res.text();
  const { document } = new JSDOM(html).window;

  // The page has a simple structure: container > sections
  // Let's walk through everything in order

  const container = document.querySelector('.container');
  if (!container) {
    console.log('No .container found, dumping body');
    console.log(document.body.textContent.trim());
    return;
  }

  // Walk through all child elements of container
  console.log('=== Container children ===');
  [...container.children].forEach((child, i) => {
    const tag = child.tagName;
    const id = child.getAttribute('id') || '';
    const cls = (child.className || '').replace(/svelte-\w+/g, '').trim();
    const text = child.textContent.trim().slice(0, 200);

    console.log(`\n--- child[${i}] <${tag}> id="${id}" class="${cls}" ---`);
    if (tag === 'HR') {
      console.log('  (horizontal rule)');
      return;
    }
    console.log(`  text: "${text}"`);

    // For sections, look at their internal structure
    if (tag === 'SECTION' || tag === 'DIV') {
      const headings = child.querySelectorAll('h1, h2, h3, h4');
      headings.forEach(h => console.log(`  ${h.tagName}: "${h.textContent.trim()}"`));

      const paragraphs = child.querySelectorAll('p');
      paragraphs.forEach((p, j) => {
        console.log(`  p[${j}]: "${p.textContent.trim().slice(0, 150)}"`);
      });

      const links = child.querySelectorAll('a');
      links.forEach((a, j) => {
        const href = a.getAttribute('href') || '';
        const aText = a.textContent.trim().slice(0, 60);
        if (aText) console.log(`  a[${j}]: "${aText}" → ${href}`);
      });
    }
  });

  // Also check the #summary section specifically
  console.log('\n\n=== #summary ===');
  const summary = document.querySelector('#summary');
  if (summary) {
    console.log(summary.textContent.trim());
  }

  // Check the sections
  console.log('\n\n=== Sections ===');
  document.querySelectorAll('section').forEach((sec, i) => {
    console.log(`\n--- section[${i}] ---`);
    console.log(sec.textContent.trim());
  });

  // Footer
  console.log('\n\n=== Footer ===');
  const footer = document.querySelector('#footer');
  if (footer) {
    console.log(footer.textContent.trim());
  }
}

main().catch(console.error);
