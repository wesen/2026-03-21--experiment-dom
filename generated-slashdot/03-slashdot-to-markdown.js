// 03-slashdot-to-markdown.js
// Converts an array of Slashdot story objects into a clean Markdown string.
//
// Usage (as a module):
//   const toMarkdown = require('./03-slashdot-to-markdown');
//   const md = toMarkdown(stories);
//
// Exports: (stories: Story[]) => string

'use strict';

/**
 * Convert a raw datetime string like
 *   "on Saturday March 21, 2026 @08:42PM"
 * into something nicer like
 *   "Saturday March 21, 2026 @ 08:42 PM"
 * Falls back to the original string if it doesn't match.
 */
function formatDatetime(raw) {
  if (!raw) return '';
  // Strip leading "on " if present
  return raw.replace(/^on\s+/i, '').trim();
}

/**
 * Collapse excessive whitespace / newlines in body text.
 * Also trims leading/trailing whitespace.
 */
function cleanBodyText(text) {
  return text
    .replace(/\r?\n\s*\r?\n/g, '\n\n') // keep paragraph breaks
    .replace(/[ \t]+/g, ' ')           // collapse inline spaces
    .trim();
}

/**
 * Render a single story as a Markdown section.
 */
function storyToMarkdown(story, index) {
  const lines = [];

  // ── Heading ──────────────────────────────────────────────────────────
  lines.push(`## ${index + 1}. ${story.title}`);
  lines.push('');

  // ── Meta table ───────────────────────────────────────────────────────
  const metaRows = [];

  if (story.url) {
    metaRows.push(`**Story URL:** [${story.url}](${story.url})`);
  }
  if (story.sourceUrl) {
    const domain = story.sourceDomain || story.sourceUrl;
    metaRows.push(`**Source:** [${domain}](${story.sourceUrl})`);
  }
  if (story.topic) {
    metaRows.push(`**Topic:** ${story.topic}`);
  }
  if (story.author) {
    metaRows.push(`**Posted by:** ${story.author}`);
  }
  if (story.datetime) {
    metaRows.push(`**Date:** ${formatDatetime(story.datetime)}`);
  }
  if (story.dept) {
    metaRows.push(`**Dept:** *from the ${story.dept} dept.*`);
  }
  metaRows.push(`**Comments:** ${story.comments}`);

  lines.push(...metaRows);
  lines.push('');

  // ── Summary body ──────────────────────────────────────────────────────
  if (story.bodyText) {
    const cleaned = cleanBodyText(story.bodyText);
    // Wrap long summaries in a blockquote to visually distinguish them
    const quoted = cleaned
      .split('\n\n')
      .map((para) => '> ' + para.replace(/\n/g, '\n> '))
      .join('\n>\n');
    lines.push(quoted);
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  return lines.join('\n');
}

/**
 * Convert an array of story objects to a full Markdown document.
 * @param {Array<Object>} stories
 * @returns {string}
 */
function toMarkdown(stories) {
  const now = new Date().toUTCString();
  const header = [
    '# Slashdot — News for Nerds',
    '',
    `> Scraped on: ${now}`,
    `> Stories found: ${stories.length}`,
    '',
    '---',
    '',
  ].join('\n');

  const body = stories.map((s, i) => storyToMarkdown(s, i)).join('\n');

  return header + body;
}

module.exports = toMarkdown;
