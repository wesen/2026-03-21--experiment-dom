// 23-wonderos-generic-extract.js — Generic content extractor for any wonderos.org page
//
// Page structures:
//   /        — .container > #summary (pillars) + article > 3 sections
//   /hello/  — no .container, #cover + #bumper + article > 12 sections (handbook chapters)
//   /poster/ — .container > #main (product info), no article/sections
//
// Strategy: walk the <article> (if present) or the main content container,
// extract headings and their associated paragraphs, links, and "work in progress" markers.

const { JSDOM } = require('jsdom');

function extractPage(document, url) {
  const title = document.querySelector('title')?.textContent.trim() || '';

  // Find the main content area
  const article = document.querySelector('article');
  const container = document.querySelector('.container');
  const mainDiv = document.querySelector('#main');

  const result = {
    url,
    title,
    intro: '',
    sections: [],
    links: [],
  };

  // Extract intro / summary
  // / has #summary with author + 3 pillars as paired <p> elements
  // /hello/ has a preamble section[0] before the ToC
  // /poster/ has #main
  const summaryDiv = document.querySelector('#summary');
  if (summaryDiv) {
    // Extract structured: author link + pillar pairs
    const authorLink = summaryDiv.querySelector('a');
    const authorName = authorLink?.textContent.trim() || '';
    const authorUrl = authorLink?.getAttribute('href') || '';

    const ps = [...summaryDiv.querySelectorAll('p')];
    const introLine = ps[0]?.textContent.trim() || '';

    // Pillars: paired p elements after the intro
    const pillars = [];
    for (let i = 1; i < ps.length - 1; i += 2) {
      const pTitle = ps[i]?.textContent.trim();
      const pDesc = ps[i + 1]?.textContent.trim();
      if (pTitle && pDesc) pillars.push({ title: pTitle, desc: pDesc });
    }

    if (pillars.length > 0) {
      result.intro = introLine;
      if (authorName) {
        result.intro = result.intro.replace(authorName, `[${authorName}](${authorUrl})`);
      }
      result.pillars = pillars;
    } else {
      result.intro = summaryDiv.textContent.trim().replace(/\s+/g, ' ');
    }
  }

  // For the poster page, use #main
  if (mainDiv && !article) {
    const h1 = mainDiv.querySelector('h1');
    result.intro = h1?.textContent.trim() || '';
    const ps = [...mainDiv.querySelectorAll('p')];
    result.sections.push({
      heading: result.intro,
      level: 1,
      paragraphs: ps.map(p => p.textContent.trim()).filter(Boolean),
      links: [],
      wip: false,
    });
  }

  // Walk article sections if present
  if (article) {
    const sections = article.querySelectorAll('section');
    sections.forEach(sec => {
      const heading = sec.querySelector('h1, h2, h3, h4');
      const headingText = heading?.textContent.trim() || '';
      const headingLevel = heading ? parseInt(heading.tagName[1]) : 3;

      const paragraphs = [...sec.querySelectorAll('p')]
        .map(p => {
          let text = p.textContent.trim();
          // Home page: first description paragraph starts "is an ongoing" because "WonderOS" is an img
          if (text.startsWith('is an ongoing')) text = 'WonderOS ' + text;
          return text;
        })
        .filter(t => t.length > 0);

      // Check for "Work in progress" markers
      const wip = paragraphs.some(p => /^Work in progress/i.test(p));

      // Extract links
      const links = [];
      sec.querySelectorAll('a').forEach(a => {
        const href = a.getAttribute('href') || '';
        const text = a.textContent.trim();
        if (href && text && text.length > 2) {
          const fullHref = href.startsWith('/') ? `https://wonderos.org${href}` : href;
          links.push({ text, href: fullHref });
        }
      });

      // Skip empty sections and the ToC section (which just has links to other sections)
      const isToC = !paragraphs.length && links.length > 3 && headingText;
      if (isToC) {
        // Capture ToC links but don't add as a content section
        result.links.push(...links);
        return;
      }

      if (headingText || paragraphs.length > 0) {
        result.sections.push({
          heading: headingText,
          level: headingLevel,
          paragraphs: wip
            ? paragraphs.filter(p => !/^Work in progress/i.test(p))
            : paragraphs,
          links,
          wip,
        });
      }
    });
  }

  // Footer links
  const footer = document.querySelector('#footer');
  if (footer) {
    footer.querySelectorAll('a').forEach(a => {
      const href = a.getAttribute('href') || '';
      const text = a.textContent.trim();
      if (href && text) {
        const fullHref = href.startsWith('/') ? `https://wonderos.org${href}` : href;
        result.links.push({ text, href: fullHref });
      }
    });
  }

  return result;
}

function pageToMarkdown(page) {
  const lines = [];

  lines.push(`# ${page.title}`);
  lines.push(``);
  lines.push(`> Source: [${page.url}](${page.url})`);
  lines.push(``);

  if (page.intro) {
    lines.push(page.intro);
    lines.push(``);
  }

  // Render pillars if present (home page)
  if (page.pillars?.length > 0) {
    lines.push(`---`);
    lines.push(``);
    for (const p of page.pillars) {
      lines.push(`### ${p.title}`);
      lines.push(`${p.desc}`);
      lines.push(``);
    }
  }

  lines.push(`---`);
  lines.push(``);

  for (const sec of page.sections) {
    if (sec.heading) {
      const prefix = '#'.repeat(Math.min(sec.level + 1, 4));
      const wipTag = sec.wip ? ' `[WIP]`' : '';
      lines.push(`${prefix} ${sec.heading}${wipTag}`);
      lines.push(``);
    }

    for (const p of sec.paragraphs) {
      lines.push(p);
      lines.push(``);
    }

    if (sec.links.length > 0) {
      for (const l of sec.links) {
        lines.push(`- [${l.text}](${l.href})`);
      }
      lines.push(``);
    }
  }

  if (page.links.length > 0) {
    lines.push(`---`);
    lines.push(``);
    lines.push(`**Links:**`);
    lines.push(``);
    for (const l of page.links) {
      lines.push(`- [${l.text}](${l.href})`);
    }
    lines.push(``);
  }

  return lines.join('\n');
}

module.exports = { extractPage, pageToMarkdown };
