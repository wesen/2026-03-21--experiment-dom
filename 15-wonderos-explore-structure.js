// 15-wonderos-explore-structure.js — Initial DOM inventory of wonderos.org
const { JSDOM } = require('jsdom');

async function main() {
  const res = await fetch('https://wonderos.org/');
  const html = await res.text();
  console.log('HTTP status:', res.status);
  console.log('HTML length:', html.length);

  const { document } = new JSDOM(html).window;

  // Tag inventory
  const tags = ['article', 'section', 'nav', 'header', 'footer', 'main',
                'h1', 'h2', 'h3', 'h4', 'a', 'p', 'li', 'img', 'figure'];
  tags.forEach(tag => {
    const count = document.querySelectorAll(tag).length;
    if (count > 0) console.log(`  ${tag}: ${count}`);
  });

  // data-* attributes
  const dataEls = document.querySelectorAll('[data-testid], [data-type], [data-id], [data-section]');
  if (dataEls.length) {
    console.log(`\nElements with data-* attributes: ${dataEls.length}`);
    const attrs = new Set();
    dataEls.forEach(el => {
      [...el.attributes].filter(a => a.name.startsWith('data-')).forEach(a => {
        attrs.add(`${a.name}="${a.value}"`);
      });
    });
    [...attrs].slice(0, 30).forEach(a => console.log(`  ${a}`));
  }

  // Class names that look structural (not CSS-hashed)
  console.log('\n--- Structural class names (non-hashed) ---');
  const allClasses = new Set();
  document.querySelectorAll('*').forEach(el => {
    (el.className || '').split(/\s+/).filter(c =>
      c.length > 3 && !/^(css-|kyt-|sc-)/.test(c) && !/^[a-z]{1,2}[A-Z0-9]/.test(c)
    ).forEach(c => allClasses.add(c));
  });
  [...allClasses].slice(0, 50).forEach(c => console.log(`  ${c}`));

  // All headings
  console.log('\n--- Headings ---');
  ['h1', 'h2', 'h3', 'h4'].forEach(tag => {
    document.querySelectorAll(tag).forEach((h, i) => {
      const text = h.textContent.trim().slice(0, 100);
      if (text) console.log(`  ${tag}[${i}]: "${text}"`);
    });
  });

  // All links (first 40)
  console.log('\n--- Links (first 40) ---');
  [...document.querySelectorAll('a')].slice(0, 40).forEach((a, i) => {
    const href = a.getAttribute('href') || '';
    const text = a.textContent.trim().slice(0, 80);
    if (text || href) console.log(`  [${i}] "${text}" → ${href}`);
  });

  // Sections and their IDs
  console.log('\n--- Sections/IDs ---');
  document.querySelectorAll('section, [id]').forEach(el => {
    const id = el.getAttribute('id') || '';
    const cls = (el.className || '').slice(0, 60);
    const tag = el.tagName;
    if (id || tag === 'SECTION') {
      console.log(`  <${tag}> id="${id}" class="${cls}"`);
    }
  });

  // Print first 2000 chars of HTML to understand the overall structure
  console.log('\n--- HTML head (first 2000 chars) ---');
  console.log(html.slice(0, 2000));
}

main().catch(console.error);
