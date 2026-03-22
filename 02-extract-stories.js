// 02-extract-stories.js — Extract story data from the HN DOM using JS expressions

function extractStories(document) {
  return [...document.querySelectorAll('tr.athing')].map(row => {
    const rank = row.querySelector('.rank')?.textContent.trim().replace('.', '');
    const titleLink = row.querySelector('.titleline > a');
    const title = titleLink?.textContent.trim();
    const url = titleLink?.getAttribute('href');
    const sitebit = row.querySelector('.sitebit.comhead a')?.textContent.trim();

    const metaRow = row.nextElementSibling;
    const score = metaRow?.querySelector('.score')?.textContent.trim();
    const author = metaRow?.querySelector('.hnuser')?.textContent.trim();
    const age = metaRow?.querySelector('.age a')?.textContent.trim();

    // Last <a> in subline with text matching "comment" or "discuss"
    const subline = metaRow?.querySelector('.subline');
    const links = subline ? [...subline.querySelectorAll('a')] : [];
    const commentsLink = links.length ? links[links.length - 1] : null;
    const comments = commentsLink?.textContent.trim();

    return { rank, title, url, sitebit, score, author, age, comments };
  });
}

module.exports = { extractStories };
