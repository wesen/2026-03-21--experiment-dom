// 02-lobsters-extract.js
// Extracts structured story data from a Lobste.rs jsdom Document.
// Usage: const { extractStories } = require('./02-lobsters-extract');
//        const stories = extractStories(document);
//
// DOM selectors used:
//   ol.stories.list > li.story           — each story row
//   li[data-shortid]                     — story short ID
//   .story_liner .voters .upvoter        — vote score (text)
//   .story_liner .details .link a.u-url  — title text + external href
//   .story_liner .details .tags .tag     — tag labels (may be multiple)
//   .story_liner .details .domain        — source domain
//   .story_liner .details .byline .u-author — submitter username
//   .story_liner .details .byline time   — submission time (datetime attr)
//   .story_liner .details .byline .comments_label a — comment count + link

'use strict';

/**
 * @typedef {Object} Story
 * @property {string}   id           - Short story ID (e.g. "vxsjiv")
 * @property {string}   title        - Story title
 * @property {string}   url          - External link URL (or lobsters discussion URL for self-posts)
 * @property {string}   commentsUrl  - URL of the lobste.rs discussion page
 * @property {number}   score        - Upvote count
 * @property {string[]} tags         - List of tag names
 * @property {string}   domain       - Source domain (empty for self-posts)
 * @property {string}   author       - Submitter username
 * @property {string}   submittedAt  - ISO datetime string
 * @property {string}   timeAgo      - Human-readable relative time (e.g. "11 hours ago")
 * @property {number}   commentCount - Number of comments
 */

/**
 * Extract all stories from the Lobste.rs homepage document.
 * @param {Document} document - jsdom document of the lobste.rs page
 * @returns {Story[]}
 */
function extractStories(document) {
  const items = document.querySelectorAll('ol.stories.list > li.story');
  const stories = [];

  for (const li of items) {
    // Skip spacer / ad rows that lack a shortid
    const shortId = li.getAttribute('data-shortid');
    if (!shortId) continue;

    // Score
    const scoreEl = li.querySelector('.voters .upvoter');
    const score = scoreEl ? parseInt(scoreEl.textContent.trim(), 10) || 0 : 0;

    // Title + URL
    const linkEl = li.querySelector('.details .link a.u-url');
    const title = linkEl ? linkEl.textContent.trim() : '';
    const url = linkEl ? linkEl.getAttribute('href') || '' : '';

    // Tags
    const tagEls = li.querySelectorAll('.details .tags .tag');
    const tags = Array.from(tagEls).map(t => t.textContent.trim()).filter(Boolean);

    // Domain (absent for self-posts)
    const domainEl = li.querySelector('.details .domain');
    const domain = domainEl ? domainEl.textContent.trim() : '';

    // Author
    const authorEl = li.querySelector('.details .byline .u-author');
    const author = authorEl ? authorEl.textContent.trim() : '';

    // Time
    const timeEl = li.querySelector('.details .byline time');
    const submittedAt = timeEl ? timeEl.getAttribute('datetime') || '' : '';
    const timeAgo = timeEl ? timeEl.textContent.trim() : '';

    // Comments
    const commentsEl = li.querySelector('.details .byline .comments_label a');
    const commentsText = commentsEl ? commentsEl.textContent.trim() : '0 comments';
    const commentCount = parseInt(commentsText, 10) || 0;
    const commentsUrl = commentsEl
      ? new URL(commentsEl.getAttribute('href'), 'https://lobste.rs').href
      : `https://lobste.rs/s/${shortId}`;

    stories.push({
      id: shortId,
      title,
      url,
      commentsUrl,
      score,
      tags,
      domain,
      author,
      submittedAt,
      timeAgo,
      commentCount,
    });
  }

  return stories;
}

module.exports = { extractStories };
