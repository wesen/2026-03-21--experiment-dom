// 34-nereval-explore-structure.js — Initial DOM inventory of nereval property listing
const { JSDOM } = require('jsdom');

async function main() {
  const url = 'https://data.nereval.com/PropertyList.aspx?town=Providence&Search=';
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; dom-scraper/1.0)' }
  });
  console.log('HTTP status:', res.status);
  const html = await res.text();
  console.log('HTML length:', html.length);

  const { document } = new JSDOM(html).window;

  // Tag inventory
  const tags = ['table', 'tr', 'td', 'th', 'form', 'input', 'select',
                'article', 'section', 'div', 'span', 'a', 'p', 'h1', 'h2', 'h3',
                'ul', 'li', 'img', 'label', 'button'];
  console.log('\n--- Tag counts ---');
  tags.forEach(tag => {
    const count = document.querySelectorAll(tag).length;
    if (count > 0) console.log(`  ${tag}: ${count}`);
  });

  // ASP.NET specific: look for GridView, DataGrid, Repeater patterns
  console.log('\n--- ASP.NET patterns ---');
  const gridviews = document.querySelectorAll('[id*="GridView"], [id*="grd"], [id*="dgrd"], [id*="lst"], [id*="rpt"]');
  console.log(`  GridView/DataGrid/ListView/Repeater: ${gridviews.length}`);
  gridviews.forEach(el => console.log(`    id="${el.id}" tag=<${el.tagName}>`));

  // Tables (likely the main data container for ASP.NET WebForms)
  console.log('\n--- Tables ---');
  document.querySelectorAll('table').forEach((t, i) => {
    const id = t.id || '';
    const cls = (t.className || '').slice(0, 60);
    const rows = t.querySelectorAll('tr').length;
    const cells = t.querySelectorAll('td').length;
    console.log(`  table[${i}]: id="${id}" class="${cls}" rows=${rows} cells=${cells}`);
  });

  // Headings
  console.log('\n--- Headings ---');
  ['h1', 'h2', 'h3', 'h4'].forEach(tag => {
    document.querySelectorAll(tag).forEach((h, i) => {
      const text = h.textContent.trim().slice(0, 100);
      if (text) console.log(`  ${tag}[${i}]: "${text}"`);
    });
  });

  // Form elements (ASP.NET WebForms has a main form)
  console.log('\n--- Forms ---');
  document.querySelectorAll('form').forEach((f, i) => {
    console.log(`  form[${i}]: id="${f.id}" action="${f.getAttribute('action') || ''}" method="${f.getAttribute('method') || ''}"`);
  });

  // Links (first 20)
  console.log('\n--- Links (first 20) ---');
  [...document.querySelectorAll('a')].slice(0, 20).forEach((a, i) => {
    const href = a.getAttribute('href') || '';
    const text = a.textContent.trim().slice(0, 80);
    if (text || href) console.log(`  [${i}] "${text}" → ${href}`);
  });

  // IDs that look like data containers
  console.log('\n--- IDs containing "content", "data", "list", "result", "property" ---');
  document.querySelectorAll('[id]').forEach(el => {
    const id = el.id.toLowerCase();
    if (/content|data|list|result|property|grid|panel/.test(id)) {
      console.log(`  <${el.tagName}> id="${el.id}" children=${el.children.length}`);
    }
  });

  // Page title
  console.log('\n--- Title ---');
  console.log(`  ${document.querySelector('title')?.textContent.trim()}`);

  // First 3000 chars of body text (to see what content is rendered)
  console.log('\n--- Body text preview (first 2000 chars) ---');
  const bodyText = document.body?.textContent.replace(/\s+/g, ' ').trim().slice(0, 2000);
  console.log(bodyText);
}

main().catch(console.error);
