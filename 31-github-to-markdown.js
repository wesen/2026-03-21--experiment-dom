// 31-github-to-markdown.js — Convert extracted GitHub repo data into formatted markdown

function toMarkdown(repo) {
  const date = new Date().toISOString().slice(0, 10);
  const lines = [];

  // Header
  lines.push(`# ${repo.owner}/${repo.name}`);
  lines.push(``);

  if (repo.description) {
    lines.push(`> ${repo.description}`);
    lines.push(``);
  }

  // Metadata badges line
  const badges = [];
  if (repo.stars) badges.push(`${repo.stars} stars`);
  if (repo.watchers) badges.push(`${repo.watchers} watching`);
  if (repo.forks) badges.push(`${repo.forks} forks`);
  if (repo.commitCount) badges.push(`${repo.commitCount} commits`);
  if (repo.defaultBranch) badges.push(`branch: \`${repo.defaultBranch}\``);
  if (!repo.isPublic) badges.push('**private**');
  if (repo.isFork) badges.push('fork');
  if (repo.createdAt) {
    const created = new Date(repo.createdAt).toISOString().slice(0, 10);
    badges.push(`created: ${created}`);
  }

  if (badges.length) {
    lines.push(badges.join(' | '));
    lines.push(``);
  }

  // Languages
  if (repo.languages.length > 0) {
    const langStr = repo.languages.map(l => `**${l.name}** ${l.percentage}`).join(', ');
    lines.push(`Languages: ${langStr}`);
    lines.push(``);
  }

  lines.push(`Source: [${repo.url}](${repo.url})`);
  lines.push(``);

  // File tree
  lines.push(`---`);
  lines.push(``);
  lines.push(`## File Tree`);
  lines.push(``);
  lines.push('```');
  for (const item of repo.tree) {
    const icon = item.type === 'directory' ? '📁' : '📄';
    lines.push(`${icon} ${item.name}`);
  }
  lines.push('```');
  lines.push(``);

  // README
  if (repo.readme.headings.length > 0 || repo.readme.paragraphs.length > 0) {
    lines.push(`---`);
    lines.push(``);
    lines.push(`## README`);
    lines.push(``);

    // Build a condensed README: headings with their first paragraph
    const { headings, paragraphs } = repo.readme;

    // Walk through paragraphs, associating them with headings
    // Strategy: use the README DOM structure as-is, just render headings + paragraphs
    let paraIdx = 0;

    // Paragraphs before first heading
    if (headings.length > 0) {
      // Estimate: first heading starts after some intro paragraphs
      // Since we don't have positional info, render heading-by-heading with all paragraphs
      // For a good output, we re-parse the README to get sections

      // Simple approach: render headings as outline, then full paragraphs
      lines.push(`### Table of Contents`);
      lines.push(``);
      for (const h of headings) {
        const indent = '  '.repeat(h.level - 1);
        lines.push(`${indent}- ${h.text}`);
      }
      lines.push(``);

      // Summary: first 5 paragraphs
      lines.push(`### Summary`);
      lines.push(``);
      const summaryParas = paragraphs.slice(0, 5);
      for (const p of summaryParas) {
        lines.push(p);
        lines.push(``);
      }
      if (paragraphs.length > 5) {
        lines.push(`*... ${paragraphs.length - 5} more paragraphs, ${repo.readme.codeBlocks} code blocks*`);
        lines.push(``);
      }
    } else {
      // No headings, just dump paragraphs
      for (const p of paragraphs.slice(0, 10)) {
        lines.push(p);
        lines.push(``);
      }
      if (paragraphs.length > 10) {
        lines.push(`*... ${paragraphs.length - 10} more paragraphs*`);
        lines.push(``);
      }
    }

    // External links from README
    if (repo.readme.links.length > 0) {
      lines.push(`### Links`);
      lines.push(``);
      const seen = new Set();
      for (const l of repo.readme.links) {
        if (!seen.has(l.href)) {
          seen.add(l.href);
          lines.push(`- [${l.text}](${l.href})`);
        }
      }
      lines.push(``);
    }
  }

  // Releases
  if (repo.releases && !/No releases/i.test(repo.releases)) {
    lines.push(`---`);
    lines.push(``);
    lines.push(`## Releases`);
    lines.push(``);
    lines.push(repo.releases);
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(``);
  lines.push(`*Fetched: ${date}*`);

  return lines.join('\n');
}

module.exports = { toMarkdown };
