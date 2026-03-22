// 22-wonderos-explore-subpages.js — Explore structure of /hello/ and /poster/
const { JSDOM } = require('jsdom');

async function explorePage(url) {
  const res = await fetch(url);
  const html = await res.text();
  const { document } = new JSDOM(html).window;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`${url} (${html.length} chars)`);
  console.log(`${'='.repeat(60)}`);

  // Top-level structure
  const container = document.querySelector('.container');
  if (container) {
    console.log('\n--- .container children ---');
    [...container.children].forEach((child, i) => {
      const tag = child.tagName;
      const id = child.getAttribute('id') || '';
      const cls = (child.className || '').replace(/svelte-\w+/g, '').trim();
      const childCount = child.children.length;
      const text = child.textContent.trim().slice(0, 100);
      console.log(`  [${i}] <${tag}> id="${id}" class="${cls}" children=${childCount} "${text}"`);
    });
  } else {
    console.log('No .container found');
    console.log('body children:');
    [...document.body.children].forEach((child, i) => {
      const tag = child.tagName;
      const id = child.getAttribute('id') || '';
      const cls = (child.className || '').replace(/svelte-\w+/g, '').trim();
      console.log(`  [${i}] <${tag}> id="${id}" class="${cls}"`);
    });
  }

  // Headings
  console.log('\n--- Headings ---');
  ['h1', 'h2', 'h3', 'h4'].forEach(tag => {
    document.querySelectorAll(tag).forEach((h, i) => {
      const text = h.textContent.trim().slice(0, 100) || h.querySelector('img')?.getAttribute('alt') || '';
      if (text) console.log(`  ${tag}[${i}]: "${text}"`);
    });
  });

  // Sections
  console.log('\n--- Sections ---');
  document.querySelectorAll('section').forEach((sec, i) => {
    const heading = sec.querySelector('h1, h2, h3, h4');
    const headingText = heading?.textContent.trim().slice(0, 80) || '';
    const pCount = sec.querySelectorAll('p').length;
    const aCount = sec.querySelectorAll('a').length;
    const text = sec.textContent.trim().slice(0, 150);
    console.log(`  section[${i}]: heading="${headingText}" p=${pCount} a=${aCount}`);
    console.log(`    "${text}"`);
  });

  // Is there an article tag?
  const articles = document.querySelectorAll('article');
  if (articles.length) {
    console.log(`\n--- Articles: ${articles.length} ---`);
    articles.forEach((art, i) => {
      const sectionCount = art.querySelectorAll('section').length;
      console.log(`  article[${i}]: ${sectionCount} sections, ${art.querySelectorAll('p').length} paragraphs`);
    });
  }

  // #summary?
  const summary = document.querySelector('#summary');
  if (summary) {
    console.log('\n--- #summary present ---');
  }

  // #footer?
  const footer = document.querySelector('#footer');
  if (footer) {
    console.log('\n--- #footer ---');
    console.log(`  "${footer.textContent.trim().slice(0, 100)}"`);
  }
}

async function main() {
  await explorePage('https://wonderos.org/');
  await explorePage('https://wonderos.org/hello/');
  await explorePage('https://wonderos.org/poster/');
}

main().catch(console.error);
