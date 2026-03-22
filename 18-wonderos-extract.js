// 18-wonderos-extract.js — Extract structured content from the WonderOS DOM
//
// WonderOS page structure (wonderos.org):
//   .container
//     div          — hero (logo + headline image + computer photo)
//     hr
//     #summary     — 3 pillars: Software, Hardware, Society (each with title + description)
//     div          — decorative divider
//     article      — main prose: 3 sections
//       section[0] — "what is WonderOS" (itemized operator environment description)
//       section[1] — "outputs" (VM experiments, handbook, updates) — has h2 "Updates", h3s
//       section[2] — acknowledgments
//     div          — footer links (Poster, Hello Operator!)
//   #footer        — same footer links

function extractContent(document) {
  const result = {
    title: '',
    heroQuestion: '',
    author: '',
    pillars: [],
    description: [],
    outputs: [],
    acknowledgments: '',
    links: [],
  };

  // Hero: the headline is an image alt text
  const headlineImg = document.querySelector('img[alt*="future of personal computing"]');
  result.heroQuestion = headlineImg?.getAttribute('alt') || '';

  // Title from the h1 img
  const titleImg = document.querySelector('h1 img');
  result.title = titleImg?.getAttribute('alt') || 'WonderOS';

  // Author from #summary
  const summaryDiv = document.querySelector('#summary');
  if (summaryDiv) {
    const authorLink = summaryDiv.querySelector('a');
    result.author = {
      name: authorLink?.textContent.trim() || '',
      url: authorLink?.getAttribute('href') || '',
    };

    // Pillars: pairs of <p> elements — title (bold) + description
    const ps = [...summaryDiv.querySelectorAll('p')];
    // First p is the "An ongoing research project by..." line
    // Then pairs: Software/desc, Hardware/desc, Society/desc
    for (let i = 1; i < ps.length - 1; i += 2) {
      const title = ps[i]?.textContent.trim();
      const desc = ps[i + 1]?.textContent.trim();
      if (title && desc) {
        result.pillars.push({ title, desc });
      }
    }
  }

  // Sections from the article
  const sections = document.querySelectorAll('article section');

  // Section 0: Main description paragraphs
  if (sections[0]) {
    const ps = [...sections[0].querySelectorAll('p')];
    result.description = ps.map(p => {
      let text = p.textContent.trim();
      // First paragraph starts with "is an..." because "WonderOS" is in an <img> tag
      if (text.startsWith('is an ongoing')) text = 'WonderOS ' + text;
      return text;
    }).filter(t => t.length > 0);
  }

  // Section 1: Outputs (has h3 headings and paragraphs, plus h2 "Updates")
  if (sections[1]) {
    const children = [...sections[1].children];
    let currentOutput = null;

    children.forEach(el => {
      const tag = el.tagName;
      if (tag === 'H3' || tag === 'H2') {
        if (currentOutput) result.outputs.push(currentOutput);
        currentOutput = {
          heading: el.textContent.trim(),
          level: tag === 'H2' ? 2 : 3,
          paragraphs: [],
          links: [],
        };
      } else if (tag === 'P' && currentOutput) {
        const text = el.textContent.trim();
        if (text) currentOutput.paragraphs.push(text);
        // Extract links from the paragraph
        el.querySelectorAll('a').forEach(a => {
          const href = a.getAttribute('href');
          const linkText = a.textContent.trim();
          if (href && linkText) {
            currentOutput.links.push({ text: linkText, href });
          }
        });
      } else if (tag === 'P' && !currentOutput) {
        // Paragraphs before the first heading
        const text = el.textContent.trim();
        if (text) {
          if (!currentOutput) {
            currentOutput = { heading: '', level: 3, paragraphs: [], links: [] };
          }
          currentOutput.paragraphs.push(text);
        }
      }
    });
    if (currentOutput) result.outputs.push(currentOutput);
  }

  // Section 2: Acknowledgments
  if (sections[2]) {
    // Clean up whitespace from inline formatting
    result.acknowledgments = sections[2].textContent.trim().replace(/\s+/g, ' ');
  }

  // Footer links
  const footerDiv = document.querySelector('#footer');
  if (footerDiv) {
    footerDiv.querySelectorAll('a').forEach(a => {
      const href = a.getAttribute('href');
      const text = a.textContent.trim();
      if (href && text) {
        result.links.push({ text, href: href.startsWith('/') ? `https://wonderos.org${href}` : href });
      }
    });
  }

  return result;
}

module.exports = { extractContent };
