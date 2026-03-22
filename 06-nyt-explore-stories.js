// 06-nyt-explore-stories.js — Dig into the main programming-node to find story elements
const { JSDOM } = require('jsdom');

async function main() {
  const res = await fetch('https://www.nytimes.com/');
  const html = await res.text();
  const { document } = new JSDOM(html).window;

  // The first programming-node has the bulk of the stories
  const mainNode = document.querySelectorAll('[data-testid="programming-node"]')[0];

  // Look at the links — what do they point to?
  console.log('--- Links in main programming-node (first 30) ---');
  const links = [...mainNode.querySelectorAll('a')];
  links.slice(0, 30).forEach((a, i) => {
    const href = a.getAttribute('href') || '';
    const text = a.textContent.trim().slice(0, 80);
    const parent = a.parentElement?.tagName;
    const grandparent = a.parentElement?.parentElement?.tagName;
    console.log(`  [${i}] <${parent}/<${grandparent}> href="${href}" text="${text}"`);
  });

  // Look at p tags — these likely hold summaries
  console.log('\n--- First 15 <p> in main node ---');
  const ps = [...mainNode.querySelectorAll('p')];
  ps.slice(0, 15).forEach((p, i) => {
    const text = p.textContent.trim().slice(0, 120);
    const cls = p.className?.slice(0, 60);
    console.log(`  p[${i}] class="${cls}" text="${text}"`);
  });

  // Look at the article elements
  console.log('\n--- article elements ---');
  document.querySelectorAll('article').forEach((art, i) => {
    const cls = art.className?.slice(0, 80);
    const testid = art.getAttribute('data-testid') || '';
    const h = art.querySelector('h2, h3');
    const headline = h?.textContent.trim().slice(0, 80) || '(no headline)';
    console.log(`  article[${i}]: class="${cls}" testid="${testid}" headline="${headline}"`);
  });

  // Look for story-wrapper or similar patterns
  console.log('\n--- Elements with "story" in class or data attribute ---');
  const allEls = mainNode.querySelectorAll('*');
  const storyEls = [...allEls].filter(el => {
    const cls = el.className || '';
    const attrs = [...el.attributes].map(a => a.name + '=' + a.value).join(' ');
    return /story/i.test(cls) || /story/i.test(attrs);
  });
  console.log(`  Found ${storyEls.length} elements with "story"`);
  storyEls.slice(0, 10).forEach((el, i) => {
    console.log(`  [${i}] <${el.tagName}> class="${(el.className || '').slice(0, 80)}"`);
  });

  // Check for <li> elements — NYT sometimes uses lists for stories
  console.log('\n--- <li> elements in main node ---');
  const lis = mainNode.querySelectorAll('li');
  console.log(`  Found ${lis.length} <li> elements`);
  [...lis].slice(0, 5).forEach((li, i) => {
    const text = li.textContent.trim().slice(0, 120);
    console.log(`  li[${i}]: "${text}"`);
  });

  // Look at the actual structure — what wraps each headline?
  console.log('\n--- Parent chain of each <a> with /2026/ or /2025/ in href ---');
  links.filter(a => /\/20(25|26)\//.test(a.getAttribute('href') || '')).slice(0, 15).forEach((a, i) => {
    const href = a.getAttribute('href');
    const text = a.textContent.trim().slice(0, 60);
    let chain = [];
    let el = a;
    for (let j = 0; j < 6 && el; j++) {
      const tag = el.tagName;
      const cls = (el.className || '').split(' ').filter(c => c.length > 2).slice(0, 2).join('.');
      chain.push(cls ? `${tag}.${cls}` : tag);
      el = el.parentElement;
    }
    console.log(`  [${i}] ${chain.join(' < ')} href="${href}" "${text}"`);
  });
}

main().catch(console.error);
