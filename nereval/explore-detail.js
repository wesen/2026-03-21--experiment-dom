// 36-nereval-explore-detail.js — Explore a property detail page
const { JSDOM } = require('jsdom');

async function main() {
  const url = 'https://data.nereval.com/PropertyDetail.aspx?town=Providence&accountnumber=24058&card=1';
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; dom-scraper/1.0)' }
  });
  console.log('HTTP status:', res.status);
  const html = await res.text();
  console.log('HTML length:', html.length);

  const { document } = new JSDOM(html).window;

  // Look for data tables / panels
  console.log('\n--- Tables ---');
  document.querySelectorAll('table').forEach((t, i) => {
    const id = t.id || '';
    const rows = t.querySelectorAll('tr').length;
    if (rows > 0) {
      console.log(`  table[${i}]: id="${id}" rows=${rows}`);
    }
  });

  // Look for labeled fields (ASP.NET often uses label + span/input pairs)
  console.log('\n--- Label/Value pairs ---');
  document.querySelectorAll('label').forEach((label, i) => {
    const text = label.textContent.trim();
    const forId = label.getAttribute('for') || '';
    const valueEl = forId ? document.querySelector(`#${forId}`) : null;
    const value = valueEl?.textContent.trim() || valueEl?.value || '';
    if (text) console.log(`  "${text}" → "${value}"`);
  });

  // Panels with IDs
  console.log('\n--- Panels/Divs with IDs ---');
  document.querySelectorAll('div[id], fieldset[id], section[id]').forEach(el => {
    const id = el.id;
    if (/detail|property|owner|land|build|sale|tax|assess|value/i.test(id)) {
      const text = el.textContent.trim().replace(/\s+/g, ' ').slice(0, 150);
      console.log(`  <${el.tagName}> id="${id}": "${text}"`);
    }
  });

  // All spans with IDs (ASP.NET renders Label controls as <span>)
  console.log('\n--- Spans with IDs (data fields) ---');
  const spans = [...document.querySelectorAll('span[id]')];
  spans.forEach(span => {
    const id = span.id;
    const text = span.textContent.trim();
    if (text && !id.includes('Validator') && text.length < 200) {
      console.log(`  ${id}: "${text}"`);
    }
  });

  // Headings
  console.log('\n--- Headings ---');
  ['h1', 'h2', 'h3', 'h4', 'h5'].forEach(tag => {
    document.querySelectorAll(tag).forEach(h => {
      const text = h.textContent.trim();
      if (text) console.log(`  ${tag}: "${text}"`);
    });
  });

  // Body text preview
  console.log('\n--- Body text (first 1500 chars) ---');
  const bodyText = document.body?.textContent.replace(/\s+/g, ' ').trim().slice(0, 1500);
  console.log(bodyText);
}

main().catch(console.error);
