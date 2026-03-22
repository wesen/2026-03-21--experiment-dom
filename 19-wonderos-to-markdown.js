// 19-wonderos-to-markdown.js — Convert extracted WonderOS content into formatted markdown

function toMarkdown(content) {
  const date = new Date().toISOString().slice(0, 10);
  const lines = [];

  // Title and hero
  lines.push(`# ${content.title}`);
  lines.push(``);
  lines.push(`> *${content.heroQuestion}*`);
  lines.push(``);
  lines.push(`An ongoing research project by [${content.author.name}](${content.author.url})`);
  lines.push(``);

  // Three pillars
  lines.push(`---`);
  lines.push(``);
  content.pillars.forEach(p => {
    lines.push(`### ${p.title}`);
    lines.push(`${p.desc}`);
    lines.push(``);
  });

  // Main description
  lines.push(`---`);
  lines.push(``);
  lines.push(`## About`);
  lines.push(``);
  content.description.forEach(p => {
    lines.push(p);
    lines.push(``);
  });

  // Outputs
  lines.push(`---`);
  lines.push(``);
  lines.push(`## Outputs`);
  lines.push(``);
  content.outputs.forEach(o => {
    if (o.heading) {
      const prefix = o.level === 2 ? '##' : '###';
      lines.push(`${prefix} ${o.heading}`);
      lines.push(``);
    }

    o.paragraphs.forEach(p => {
      lines.push(p);
      lines.push(``);
    });

    if (o.links.length > 0) {
      o.links.forEach(l => {
        lines.push(`- [${l.text}](${l.href})`);
      });
      lines.push(``);
    }
  });

  // Acknowledgments
  if (content.acknowledgments) {
    lines.push(`---`);
    lines.push(``);
    lines.push(`## Acknowledgments`);
    lines.push(``);
    lines.push(content.acknowledgments);
    lines.push(``);
  }

  // Footer links
  if (content.links.length > 0) {
    lines.push(`---`);
    lines.push(``);
    content.links.forEach(l => {
      lines.push(`- [${l.text}](${l.href})`);
    });
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(``);
  lines.push(`*Fetched: ${date} | Source: [wonderos.org](https://wonderos.org/)*`);

  return lines.join('\n');
}

module.exports = { toMarkdown };
