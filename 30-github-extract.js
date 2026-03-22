// 30-github-extract.js — Extract structured data from a GitHub repo page
//
// GitHub repo page data sources:
//   1. react-app > script[type="application/json"] — JSON payload with:
//      - payload.codeViewRepoRoute.tree.items — file tree
//      - payload.codeViewRepoRoute.refInfo — branch info
//      - payload.codeViewRepoRoute.overview.overviewFiles[0].richText — README HTML
//      - payload.codeViewRepoRoute.overview.commitCount — commit count
//      - payload.codeViewLayoutRoute.repo — repo metadata (name, owner, dates, etc.)
//   2. DOM sidebar (.BorderGrid-row) — About, Releases, Languages, Stars/Watchers/Forks
//   3. DOM README (article.markdown-body) — fallback if JSON README missing

const { JSDOM } = require('jsdom');

function extractRepo(document, repoUrl) {
  const result = {
    url: repoUrl,
    owner: '',
    name: '',
    description: '',
    defaultBranch: '',
    createdAt: '',
    isPublic: true,
    isFork: false,
    commitCount: 0,
    stars: 0,
    watchers: 0,
    forks: 0,
    languages: [],
    tree: [],
    readme: { headings: [], paragraphs: [], codeBlocks: 0, links: [] },
    releases: '',
  };

  // === Parse JSON payload ===
  const reactApp = document.querySelector('react-app');
  const jsonScript = reactApp?.querySelector('script[type="application/json"]');
  let payload = null;

  if (jsonScript) {
    try {
      const data = JSON.parse(jsonScript.textContent);
      payload = data.payload || data;
    } catch (e) {
      // JSON parse failed, fall back to DOM-only
    }
  }

  if (payload) {
    const route = payload.codeViewRepoRoute;
    const layout = payload.codeViewLayoutRoute;

    // Repo metadata
    const repo = layout?.repo;
    if (repo) {
      result.owner = repo.ownerLogin || '';
      result.name = repo.name || '';
      result.defaultBranch = repo.defaultBranch || '';
      result.createdAt = repo.createdAt || '';
      result.isPublic = repo.public !== false;
      result.isFork = repo.isFork || false;
    }

    // Commit count
    const overview = route?.overview;
    result.commitCount = parseInt(overview?.commitCount) || 0;

    // File tree
    const tree = route?.tree;
    if (tree?.items) {
      result.tree = tree.items.map(item => ({
        name: item.name,
        path: item.path,
        type: item.contentType, // "directory" or "file"
      }));
    }

    // README from overviewFiles
    const readmeFile = overview?.overviewFiles?.find(f =>
      f.tabName === 'README' || f.preferredFileType === 'readme'
    );
    if (readmeFile?.richText) {
      const readmeDoc = new JSDOM(readmeFile.richText).window.document;
      result.readme = extractReadme(readmeDoc);
    }
  }

  // === Sidebar from DOM ===
  // Description
  const aboutRow = [...document.querySelectorAll('.BorderGrid-row')].find(r =>
    r.querySelector('h2')?.textContent.trim() === 'About'
  );
  if (aboutRow) {
    // Description is typically in a <p> inside the first cell
    const descP = aboutRow.querySelector('p');
    result.description = descP?.textContent.trim() || '';

    // Social stats — prefer exact counts from aria-label, fall back to text parsing
    // aria-label="80976 users starred this repository" has the exact number
    const starEl = document.querySelector('#repo-stars-counter-star, #repo-stars-counter-unstar');
    const starLabel = starEl?.getAttribute('aria-label') || '';
    result.stars = parseInt(starLabel.match(/(\d+)/)?.[1]) || 0;

    // For watchers/forks, parse from the About row's <strong> + text pairs
    // Text pattern: "81k\n        stars" or "504\n        watching" or "6.7k\n        forks"
    const parseCount = (text) => {
      const m = text.match(/([\d,.]+)\s*([kKmM])?/);
      if (!m) return 0;
      let n = parseFloat(m[1].replace(/,/g, ''));
      if (m[2]?.toLowerCase() === 'k') n *= 1000;
      if (m[2]?.toLowerCase() === 'm') n *= 1000000;
      return Math.round(n);
    };

    aboutRow.querySelectorAll('a.Link--muted').forEach(a => {
      const text = a.textContent.trim().replace(/\s+/g, ' ');
      if (/watching/i.test(text)) result.watchers = parseCount(text);
      else if (/forks?/i.test(text)) result.forks = parseCount(text);
      else if (/stars?/i.test(text) && !result.stars) result.stars = parseCount(text);
    });
  }

  // Languages
  const langRow = [...document.querySelectorAll('.BorderGrid-row')].find(r =>
    r.querySelector('h2')?.textContent.trim() === 'Languages'
  );
  if (langRow) {
    const seen = new Set();
    langRow.querySelectorAll('span').forEach(span => {
      const text = span.textContent.trim();
      // Language entries look like "Swift 69.1%" — but they appear as separate spans
      // Look for the pattern: a span with just a name, followed by a span with percentage
    });
    // Extract from the cell text, stripping the "Languages" heading
    const langCell = langRow.querySelectorAll('.BorderGrid-cell')[1] || langRow;
    const langText = langCell.textContent.trim().replace(/\s+/g, ' ').replace(/^Languages\s*/, '');
    // Pattern: "Swift 69.1% C 30.9%"
    const langMatches = langText.matchAll(/(\w[\w#+. ]*?)\s+(\d+\.?\d*%)/g);
    for (const m of langMatches) {
      const key = `${m[1]} ${m[2]}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.languages.push({ name: m[1].trim(), percentage: m[2] });
      }
    }
  }

  // Releases
  const relRow = [...document.querySelectorAll('.BorderGrid-row')].find(r =>
    r.querySelector('h2')?.textContent.trim() === 'Releases'
  );
  if (relRow) {
    result.releases = relRow.textContent.trim().replace(/\s+/g, ' ')
      .replace(/^Releases\s*/, '');
  }

  // Fallback: if no owner/name from JSON, parse from URL
  if (!result.owner || !result.name) {
    const urlMatch = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
    result.owner = result.owner || urlMatch?.[1] || '';
    result.name = result.name || urlMatch?.[2] || '';
  }

  // Fallback: README from DOM if not found in JSON
  if (result.readme.headings.length === 0) {
    const readmeEl = document.querySelector('#readme article, article.markdown-body');
    if (readmeEl) {
      result.readme = extractReadme(readmeEl);
    }
  }

  return result;
}

function extractReadme(readmeDoc) {
  const headings = [];
  const paragraphs = [];
  const links = [];
  let codeBlocks = 0;

  // Walk headings
  readmeDoc.querySelectorAll('h1, h2, h3, h4').forEach(h => {
    headings.push({
      level: parseInt(h.tagName[1]),
      text: h.textContent.trim(),
    });
  });

  // Walk paragraphs (include all text content, not just <p>)
  readmeDoc.querySelectorAll('p').forEach(p => {
    const text = p.textContent.trim();
    if (text) paragraphs.push(text);
  });

  // Code blocks
  codeBlocks = readmeDoc.querySelectorAll('pre').length;

  // Links
  readmeDoc.querySelectorAll('a').forEach(a => {
    const href = a.getAttribute('href') || '';
    const text = a.textContent.trim();
    if (href && text && !href.startsWith('#')) {
      links.push({ text, href });
    }
  });

  return { headings, paragraphs, codeBlocks, links };
}

module.exports = { extractRepo };
