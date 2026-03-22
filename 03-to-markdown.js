// 03-to-markdown.js — Convert extracted stories array into formatted markdown

function toMarkdown(stories) {
  const date = new Date().toISOString().slice(0, 10);

  const lines = stories.map((s, i) => {
    const domain = s.sitebit ? ` *(${s.sitebit})*` : '';
    const href = s.url?.startsWith('http') ? s.url : `https://news.ycombinator.com/${s.url || ''}`;
    const link = `[${s.title}](${href})`;
    const meta = [s.score, s.author ? `by **${s.author}**` : '', s.age, s.comments]
      .filter(Boolean)
      .join(' | ');
    const separator = (i + 1) % 10 === 0 && (i + 1) < stories.length ? '\n\n---' : '';

    return `### ${s.rank}. ${link}${domain}\n${meta}${separator}`;
  });

  return [
    `# Hacker News — Front Page`,
    ``,
    `> Fetched: ${date}`,
    ``,
    `---`,
    ``,
    ...lines,
    ``,
    `---`,
    ``,
    `*${stories.length} stories | Source: [news.ycombinator.com](https://news.ycombinator.com/)*`,
  ].join('\n');
}

module.exports = { toMarkdown };
