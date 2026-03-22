// 10-nyt-extract-stories.js — Extract stories from the NYTimes DOM
//
// NYT structure:
//   - Stories live in div.story-wrapper elements
//   - Programming Node 0 (first [data-testid="programming-node"]) has all stories
//   - Nodes 1-8 are duplicates/subsets
//   - Each story-wrapper contains:
//     - <a> with href to article
//     - <p class="indicate-hover"> for headline text (standard layout)
//     - OR <p> with kyt-* classes for headline (feature/magazine layout)
//     - <p class="summary-class"> for summary/description
//     - First <p> may be a kicker (section label, "LIVE", author name, or read time)
//   - Related links sit in <ul>/<li> elements outside story-wrappers
//   - Section can be inferred from the URL path

function extractStories(document) {
  // Use only the first programming-node to avoid duplicates
  const mainNode = document.querySelectorAll('[data-testid="programming-node"]')[0];
  if (!mainNode) return [];

  const stories = [];
  const seenHrefs = new Set();

  // Extract from story-wrappers
  const wrappers = mainNode.querySelectorAll('.story-wrapper');
  wrappers.forEach(w => {
    const link = w.querySelector('a');
    const href = link?.getAttribute('href') || '';
    if (!href || seenHrefs.has(href)) return;

    // Standard layout: headline in p.indicate-hover
    // Feature/magazine layout: headline in a <p> with kyt-* classes (no indicate-hover)
    let headlineEl = w.querySelector('p.indicate-hover');
    let summaryEl = w.querySelector('p.summary-class');
    let kicker = '';
    let headline = headlineEl?.textContent.trim() || '';

    if (!headline) {
      // Feature layout fallback: look for kyt-pattern <p> elements
      // Pattern: p[0] = kicker, p[1] = headline, p[2] = photo credit
      const allPs = [...w.querySelectorAll('p')];
      const kytPs = allPs.filter(p =>
        [...p.classList].some(c => c.startsWith('kyt-')) &&
        !p.classList.contains('summary-class')
      );
      if (kytPs.length >= 2) {
        kicker = kytPs[0]?.textContent.trim() || '';
        headlineEl = kytPs[1];
        headline = headlineEl?.textContent.trim() || '';
      } else if (kytPs.length === 1) {
        headlineEl = kytPs[0];
        headline = headlineEl?.textContent.trim() || '';
      }
    }
    if (!headline) return;

    seenHrefs.add(href);

    const summary = summaryEl?.textContent.trim() || '';

    // Kicker: first <p> that isn't the headline or summary (if not already found)
    const allPs = [...w.querySelectorAll('p')];
    if (!kicker) {
      const kickerEl = allPs.find(p =>
        p !== headlineEl &&
        p !== summaryEl &&
        !p.classList.contains('indicate-hover') &&
        !p.classList.contains('summary-class')
      );
      kicker = kickerEl?.textContent.trim() || '';
    }

    // If kicker is just a read time like "6 min read", extract it separately
    let readTime = '';
    const readTimeMatch = kicker.match(/^(\d+ min read)$/);
    if (readTimeMatch) {
      readTime = readTimeMatch[1];
      kicker = '';
    }

    // Also look for read time in other <p> elements
    if (!readTime) {
      const readTimeEl = allPs.find(p => /^\d+ min read$/.test(p.textContent.trim()));
      readTime = readTimeEl?.textContent.trim() || '';
    }

    // Extract section from URL
    const sectionMatch = href.match(/nytimes\.com\/(?:20\d\d\/\d\d\/\d\d\/)?([^/]+)/);
    const section = sectionMatch?.[1] || '';

    // Is it a live update?
    const isLive = kicker === 'LIVE' || /\/live\//.test(href);
    if (kicker === 'LIVE') kicker = '';

    // Related links within this story-wrapper
    const relatedLinks = [...w.querySelectorAll('ul a, li a')]
      .filter(a => a.getAttribute('href') && a.textContent.trim().length > 3)
      .map(a => ({
        text: a.textContent.trim(),
        href: a.getAttribute('href'),
      }));

    stories.push({
      headline,
      href,
      summary,
      kicker,
      readTime,
      section,
      isLive,
      relatedLinks,
    });
  });

  // Also grab "related links" that sit outside story-wrappers (in <ul><li> lists)
  // These are secondary stories shown as bullet lists under a main story
  const allStoryLinks = [...mainNode.querySelectorAll('ul li a')]
    .filter(a => {
      const h = a.getAttribute('href') || '';
      return /\/20(25|26)\//.test(h) && !seenHrefs.has(h);
    });

  allStoryLinks.forEach(a => {
    const href = a.getAttribute('href');
    if (seenHrefs.has(href)) return;
    seenHrefs.add(href);

    const text = a.textContent.trim();
    if (text.length < 5) return;

    const sectionMatch = href.match(/nytimes\.com\/(?:20\d\d\/\d\d\/\d\d\/)?([^/]+)/);
    const section = sectionMatch?.[1] || '';

    stories.push({
      headline: text,
      href,
      summary: '',
      kicker: '',
      readTime: '',
      section,
      isLive: false,
      relatedLinks: [],
      isSecondary: true,
    });
  });

  return stories;
}

module.exports = { extractStories };
