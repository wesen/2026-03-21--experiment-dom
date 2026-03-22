// 35-nereval-explore-table.js — Deep dive into the GridView table structure
const { JSDOM } = require('jsdom');

async function main() {
  const url = 'https://data.nereval.com/PropertyList.aspx?town=Providence&Search=';
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; dom-scraper/1.0)' }
  });
  const html = await res.text();
  const { document } = new JSDOM(html).window;

  const table = document.querySelector('#PropertyList_GridView1');
  if (!table) { console.log('GridView not found!'); return; }

  const rows = [...table.querySelectorAll('tr')];
  console.log(`Total rows: ${rows.length}`);

  // Header row
  const headerRow = rows[0];
  const headers = [...headerRow.querySelectorAll('th')].map(th => th.textContent.trim());
  console.log(`\nHeaders (${headers.length}):`);
  headers.forEach((h, i) => console.log(`  [${i}] "${h}"`));

  // Check if there's a pager row (last row often has paging in ASP.NET GridView)
  const lastRow = rows[rows.length - 1];
  const lastRowCells = [...lastRow.querySelectorAll('td')];
  const lastRowText = lastRow.textContent.trim().replace(/\s+/g, ' ').slice(0, 200);
  console.log(`\nLast row (${lastRowCells.length} cells): "${lastRowText}"`);
  const lastRowLinks = [...lastRow.querySelectorAll('a')];
  console.log(`  Links in last row: ${lastRowLinks.length}`);
  lastRowLinks.forEach(a => console.log(`    "${a.textContent.trim()}" → ${a.getAttribute('href') || ''}`));

  // Data rows (skip header + potential pager)
  console.log('\n--- Data rows ---');
  const dataRows = rows.slice(1, -1); // skip header and potential pager
  console.log(`Data rows: ${dataRows.length}`);

  // Examine first 5 rows in detail
  dataRows.slice(0, 5).forEach((row, i) => {
    const cells = [...row.querySelectorAll('td')];
    console.log(`\n  row[${i}] (${cells.length} cells):`);
    cells.forEach((cell, j) => {
      const text = cell.textContent.trim();
      const link = cell.querySelector('a');
      const linkHref = link?.getAttribute('href') || '';
      console.log(`    cell[${j}]: "${text}" ${linkHref ? '→ ' + linkHref : ''}`);
    });
  });

  // Check for pagination — look for __doPostBack or page links
  console.log('\n--- Pagination ---');
  const pagerLinks = [...table.querySelectorAll('a[href*="__doPostBack"], a[href*="Page"]')];
  console.log(`Pager links: ${pagerLinks.length}`);
  pagerLinks.forEach(a => {
    console.log(`  "${a.textContent.trim()}" → ${a.getAttribute('href')?.slice(0, 100)}`);
  });

  // Check for __VIEWSTATE (ASP.NET form state — needed for pagination)
  const viewstate = document.querySelector('#__VIEWSTATE');
  const eventValidation = document.querySelector('#__EVENTVALIDATION');
  console.log(`\n__VIEWSTATE: ${viewstate ? `${viewstate.value.length} chars` : 'NOT FOUND'}`);
  console.log(`__EVENTVALIDATION: ${eventValidation ? `${eventValidation.value.length} chars` : 'NOT FOUND'}`);

  // Count total properties from page text
  const bodyText = document.body.textContent;
  const totalMatch = bodyText.match(/(\d+)\s*(?:results?|records?|properties|items)/i);
  if (totalMatch) console.log(`\nTotal count: ${totalMatch[0]}`);
}

main().catch(console.error);
