// 03-lobsters-to-markdown.js
// Converts an array of Lobste.rs story objects into a Markdown string.
// Usage: const { toMarkdown } = require('./03-lobsters-to-markdown');
//        const md = toMarkdown(stories);

'use strict';

/**
 * Escape pipe characters in markdown table cells.
 * @param {string} str
 * @returns {string}
 */
function esc(str) {
  return String(str).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/**
 * Convert an array of story objects to a Markdown document.
 * @param {import('./02-lobsters-extract').Story[]} stories
 * @param {Object} [opts]
 * @param {string} [opts.sourceUrl] - URL the data was fetched from
 * @param {Date}   [opts.fetchedAt] - When the data was fetched
 * @returns {string}
 */
function toMarkdown(stories, opts = {}) {
  const { sourceUrl = 'https://lobste.rs/', fetchedAt = new Date() } = opts;
  const lines = [];

  // Header
  lines.push('# Lobste.rs — Front Page');
  lines.push('');
  lines.push(`> **Source:** <${sourceUrl}>  `);
  lines.push(`> **Fetched:** ${fetchedAt.toUTCString()}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  if (stories.length === 0) {
    lines.push('_No stories found._');
    return lines.join('\n');
  }

  // Stories
  stories.forEach((story, i) => {
    const num = String(i + 1).padStart(2, ' ');
    const tags = story.tags.length
      ? story.tags.map(t => `\`${t}\``).join(' ')
      : '_untagged_';

    // Title line
    lines.push(`### ${num}. [${esc(story.title)}](${story.url})`);
    lines.push('');

    // Meta line
    const domainPart = story.domain ? ` · 🌐 ${story.domain}` : '';
    lines.push(`**Score:** ${story.score} · **Tags:** ${tags}${domainPart}`);
    lines.push('');

    // Byline
    const timeDisplay = story.timeAgo || story.submittedAt;
    lines.push(
      `**Submitted by:** [@${esc(story.author)}](https://lobste.rs/~${story.author})` +
      ` · **${timeDisplay}**` +
      ` · [💬 ${story.commentCount} comment${story.commentCount !== 1 ? 's' : ''}](${story.commentsUrl})`
    );
    lines.push('');
    lines.push('---');
    lines.push('');
  });

  // Footer
  lines.push(`_${stories.length} stories extracted from Lobste.rs._`);

  return lines.join('\n');
}

module.exports = { toMarkdown };
