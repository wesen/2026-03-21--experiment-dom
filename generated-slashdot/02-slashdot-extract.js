// 02-slashdot-extract.js
// Extracts structured story data from a parsed Slashdot jsdom Document.
//
// DOM selectors used:
//   article[data-fhtype="story"]   — each story card
//   span.story-title a:first-child — story title + Slashdot URL
//   a.story-sourcelnk              — external source link + domain label
//   span.comment-bubble a          — comment count
//   span.story-byline              — author + timestamp text block
//   time[datetime]                 — ISO-ish datetime string
//   span.dept-text                 — "from the X dept."
//   span.topic img[alt]            — topic / category label
//   div[id^="text-"]               — story summary body HTML
//
// Usage (as a module):
//   const extract = require('./02-slashdot-extract');
//   const stories = extract(document);
//
// Exports: (document) => Story[]
//
// Story shape:
//   {
//     id:           string,   // firehose ID
//     title:        string,
//     url:          string,   // Slashdot story URL
//     sourceUrl:    string,   // external source URL (may be '')
//     sourceDomain: string,   // e.g. "thehackernews.com"
//     author:       string,
//     datetime:     string,   // raw datetime attribute
//     topic:        string,   // category label
//     dept:         string,   // "from the X dept." tagline (may be '')
//     comments:     number,
//     bodyHtml:     string,   // raw inner HTML of summary
//     bodyText:     string,   // plain-text version of summary
//   }

'use strict';

/**
 * Safely get trimmed text content of the first element matching `selector`
 * inside `root`, or `fallback` if not found.
 */
function text(root, selector, fallback = '') {
  const el = root.querySelector(selector);
  return el ? el.textContent.trim() : fallback;
}

/**
 * Extract all Slashdot stories from a jsdom Document.
 * @param {Document} document
 * @returns {Array<Object>}
 */
function extract(document) {
  const articles = Array.from(
    document.querySelectorAll('article[data-fhtype="story"]')
  );

  return articles.map((article) => {
    const id = article.getAttribute('data-fhid') || '';

    // ── Title & Slashdot URL ──────────────────────────────────────────────
    const titleEl = article.querySelector('span.story-title a:first-child');
    const title = titleEl ? titleEl.textContent.trim() : '';
    let url = titleEl ? (titleEl.getAttribute('href') || '') : '';
    if (url.startsWith('//')) url = 'https:' + url;

    // ── External source ───────────────────────────────────────────────────
    const srcEl = article.querySelector('a.story-sourcelnk');
    let sourceUrl = srcEl ? (srcEl.getAttribute('href') || '') : '';
    const sourceDomain = srcEl ? srcEl.textContent.trim().replace(/[()]/g, '').trim() : '';

    // ── Author ────────────────────────────────────────────────────────────
    // Byline looks like: "Posted by EditorDavid on ... from the ... dept."
    // The author name sits between "by " and "on "
    const bylineEl = article.querySelector('span.story-byline');
    let author = '';
    if (bylineEl) {
      const bylineText = bylineEl.textContent.replace(/\s+/g, ' ').trim();
      const byMatch = bylineText.match(/by\s+(\S+)/i);
      if (byMatch) author = byMatch[1];
    }

    // ── Datetime ──────────────────────────────────────────────────────────
    const timeEl = article.querySelector(`time#fhtime-${id}`);
    const datetime = timeEl ? (timeEl.getAttribute('datetime') || timeEl.textContent.trim()) : '';

    // ── Topic / category ──────────────────────────────────────────────────
    const topicImg = article.querySelector('span.topic img');
    const topic = topicImg ? (topicImg.getAttribute('alt') || '') : '';

    // ── Department tagline ────────────────────────────────────────────────
    const dept = text(article, 'span.dept-text');

    // ── Comment count ─────────────────────────────────────────────────────
    const commentEl = article.querySelector('span.comment-bubble a');
    const comments = commentEl ? parseInt(commentEl.textContent.trim(), 10) || 0 : 0;

    // ── Body / summary ────────────────────────────────────────────────────
    const bodyEl = article.querySelector(`div#text-${id}`) ||
                   article.querySelector('div.body .p') ||
                   article.querySelector('div.p');
    const bodyHtml = bodyEl ? bodyEl.innerHTML.trim() : '';
    const bodyText = bodyEl ? bodyEl.textContent.replace(/\s+/g, ' ').trim() : '';

    return {
      id,
      title,
      url,
      sourceUrl,
      sourceDomain,
      author,
      datetime,
      topic,
      dept,
      comments,
      bodyHtml,
      bodyText,
    };
  }).filter((s) => s.title); // drop any empty/ad slots
}

module.exports = extract;
