// Convert extracted HN story objects into formatted markdown
// Takes the `stories` array from 01-fetch-hn.js

const markdown = stories.map(s => {
  const domain = s.sitebit ? ` *(${s.sitebit})*` : '';
  const link = s.url ? `[${s.title}](${s.url})` : s.title;
  const meta = [s.score, s.author ? `by **${s.author}**` : '', s.age, s.comments]
    .filter(Boolean)
    .join(' | ');

  return `### ${s.rank}. ${link}${domain}\n${meta}`;
}).join('\n\n');

const output = `# Hacker News — Front Page\n\n---\n\n${markdown}\n`;
console.log(output);
