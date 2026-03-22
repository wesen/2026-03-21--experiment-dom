// 11-nyt-to-markdown.js — Convert extracted NYT stories into formatted markdown
//
// Groups stories by section, formats with kickers, summaries, and read times.
// Filters out games/puzzles for a cleaner news-focused output.

// Map raw URL sections to display names
const SECTION_NAMES = {
  'us': 'U.S.',
  'world': 'World',
  'business': 'Business',
  'opinion': 'Opinion',
  'live': 'Live Updates',
  'interactive': 'Interactive',
  'athletic': 'The Athletic / Sports',
  'podcasts': 'Audio',
  'your-money': 'Your Money',
  'magazine': 'Magazine',
  'science': 'Science',
  'technology': 'Technology',
  'arts': 'Arts',
  'style': 'Style',
  'health': 'Health',
  'climate': 'Climate',
  'books': 'Books',
};

// Sections to skip (games, puzzles, etc.)
const SKIP_SECTIONS = new Set(['games', 'puzzles', 'crosswords']);

// Preferred section order for display
const SECTION_ORDER = [
  'live', 'us', 'world', 'business', 'opinion', 'athletic',
  'interactive', 'magazine', 'your-money', 'podcasts',
  'science', 'technology', 'arts', 'style', 'health', 'climate', 'books',
];

function toMarkdown(stories) {
  const date = new Date().toISOString().slice(0, 10);

  // Filter out games/puzzles and the "Got a Tip?" promo
  const filtered = stories.filter(s =>
    !SKIP_SECTIONS.has(s.section) &&
    !/^Got a Tip/.test(s.headline)
  );

  // Group by section
  const groups = new Map();
  filtered.forEach(s => {
    const sec = s.section || 'other';
    if (!groups.has(sec)) groups.set(sec, []);
    groups.get(sec).push(s);
  });

  // Sort sections by preferred order
  const sortedSections = [...groups.keys()].sort((a, b) => {
    const ai = SECTION_ORDER.indexOf(a);
    const bi = SECTION_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const lines = [
    `# The New York Times — Front Page`,
    ``,
    `> Fetched: ${date}`,
    ``,
  ];

  for (const sec of sortedSections) {
    const sectionName = SECTION_NAMES[sec] || sec.charAt(0).toUpperCase() + sec.slice(1);
    const sectionStories = groups.get(sec);

    lines.push(`---`);
    lines.push(``);
    lines.push(`## ${sectionName}`);
    lines.push(``);

    for (const s of sectionStories) {
      const prefix = s.isLive ? '`LIVE` ' : '';
      const kickerStr = s.kicker ? `*${s.kicker}* | ` : '';
      const readTimeStr = s.readTime ? ` | ${s.readTime}` : '';
      const secondary = s.isSecondary ? ' *(related)*' : '';

      lines.push(`### ${prefix}[${s.headline}](${s.href})${secondary}`);
      lines.push(`${kickerStr}${sectionName}${readTimeStr}`);

      if (s.summary) {
        lines.push(``);
        lines.push(`> ${s.summary}`);
      }

      if (s.relatedLinks?.length > 0) {
        lines.push(``);
        s.relatedLinks.forEach(r => {
          lines.push(`- [${r.text}](${r.href})`);
        });
      }

      lines.push(``);
    }
  }

  lines.push(`---`);
  lines.push(``);
  lines.push(`*${filtered.length} stories | Source: [nytimes.com](https://www.nytimes.com/)*`);

  return lines.join('\n');
}

module.exports = { toMarkdown };
