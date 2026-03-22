---
Title: Diary
Ticket: DOM-SCRAPE
Status: active
Topics:
    - scraping
    - dom
    - javascript
    - node
DocType: reference
Intent: long-term
Owners: []
RelatedFiles:
    - Path: 01-fetch-hn.js
      Note: Fetches HN HTML and parses into jsdom Document
    - Path: 02-extract-stories.js
      Note: Extracts story data from HN DOM via querySelectorAll
    - Path: 03-to-markdown.js
      Note: Converts story objects to formatted markdown
    - Path: 04-run.js
      Note: 'Orchestrator: fetch → extract → markdown → write'
    - Path: 05-nyt-explore-structure.js
      Note: Initial NYT DOM exploration — tag counts
    - Path: 06-nyt-explore-stories.js
      Note: Deep dive into links
    - Path: 07-nyt-explore-story-wrappers.js
      Note: 'Detailed story-wrapper extraction: headlines'
    - Path: 08-nyt-explore-sections.js
      Note: Programming-node section mapping
    - Path: 09-nyt-fetch.js
      Note: Fetches NYT HTML and parses into jsdom Document
    - Path: 10-nyt-extract-stories.js
      Note: Extracts stories from NYT DOM — dual layout
    - Path: 11-nyt-to-markdown.js
      Note: Groups stories by section
    - Path: 12-nyt-run.js
      Note: 'NYT orchestrator: fetch → extract → markdown → write'
    - Path: 13-nyt-debug-missing.js
      Note: 'Debug: verifies extraction completeness'
    - Path: 14-nyt-find-missing-stories.js
      Note: Investigation of skipped story-wrappers
    - Path: 15-wonderos-explore-structure.js
      Note: Initial WonderOS DOM inventory — tags
    - Path: 16-wonderos-explore-content.js
      Note: Full text extraction — container children
    - Path: 17-wonderos-fetch.js
      Note: Fetches WonderOS HTML and parses into jsdom Document
    - Path: 18-wonderos-extract.js
      Note: 'Extracts structured content: pillars'
    - Path: 19-wonderos-to-markdown.js
      Note: Formats WonderOS content as markdown
    - Path: 20-wonderos-run.js
      Note: 'WonderOS orchestrator: fetch → extract → markdown → write'
    - Path: 21-wonderos-find-pages.js
      Note: Crawls internal/external links
    - Path: 22-wonderos-explore-subpages.js
      Note: Side-by-side structural comparison of all 3 pages
    - Path: 23-wonderos-generic-extract.js
      Note: Generic extractor + formatter for any wonderos.org page
    - Path: 24-wonderos-run-all.js
      Note: Fetches all 3 pages
    - Path: 25-github-explore-structure.js
      Note: Initial GitHub DOM inventory — tags
    - Path: 26-github-explore-data.js
      Note: JSON payload + sidebar + README structure extraction
    - Path: 27-github-explore-overview.js
      Note: overview/tree objects from JSON — commitCount
    - Path: 28-github-explore-repo-meta.js
      Note: Repo metadata
    - Path: 29-github-fetch.js
      Note: Fetches GitHub repo page with User-Agent header
    - Path: 30-github-extract.js
      Note: 'Dual-source extraction: JSON payload + DOM sidebar'
    - Path: 31-github-to-markdown.js
      Note: Formats repo data as markdown with file tree
    - Path: 32-github-run.js
      Note: 'CLI runner: node 32-github-run.js [repo-url]'
    - Path: 33-github-debug-stars.js
      Note: Debug script for star count extraction on popular repos
ExternalSources: []
Summary: 'Implementation diary for DOM scraping experiments: fetching HN and NYTimes, extracting content via JS DOM expressions, and rendering as markdown.'
LastUpdated: 2026-03-21T20:28:39.017671295-04:00
WhatFor: ""
WhenToUse: ""
---






# Diary

## Goal

Build Node.js scripts that fetch news sites (Hacker News, NYTimes), parse the HTML into a DOM, extract structured data using JS DOM queries, and render the results as nicely formatted Markdown.

## Step 1: Initial HN approach with WebFetch (no real DOM)

The first attempt used `WebFetch` (an AI-powered URL fetcher) to grab the HN front page. The AI model inside WebFetch extracted all 30 stories directly from the HTML. JS files (`01-fetch-hn.js`, `02-to-markdown.js`) were written as documentation of the DOM queries you *would* use, but they never actually executed against a live DOM.

### Prompt Context

**User prompt (verbatim):** "Fetch https://news.ycombinator.com/ and then using only JS expressions against the dom, turn this into a very nice markdown output layout"

**Assistant interpretation:** Fetch HN, extract stories from the DOM structure, produce formatted markdown.

**Inferred user intent:** Demonstrate DOM-based content extraction from a live web page and produce readable markdown output.

### What I did
- Used `WebFetch` tool to fetch `https://news.ycombinator.com/` with a detailed extraction prompt
- Wrote `01-fetch-hn.js` and `02-to-markdown.js` as conceptual JS (DOM queries documented but not executed)
- Wrote `hn-frontpage.md` with all 30 stories formatted

### Why
- WebFetch was the fastest path to get the content
- Playwright was tried first but crashed due to GPU/display errors in the headless environment

### What worked
- WebFetch successfully extracted all 30 stories with correct metadata
- The markdown output was clean and well-structured

### What didn't work
- Playwright `browser_navigate` failed twice with `Target page, context or browser has been closed` — Chrome couldn't start properly (MESA GPU driver errors, read-only filesystem for crash reports/dconf)
- The JS files were never actually run — they were decorative

### What I learned
- Playwright in this environment has GPU/display issues — may need `--headless=new` or similar flags
- WebFetch uses an AI model to process content, not actual DOM queries — different from what the user wanted

### What was tricky to build
- N/A for this step (no real code execution)

### What warrants a second pair of eyes
- N/A

### What should be done in the future
- Actually run JS against a real DOM (which led to Step 2)

### Code review instructions
- Files: `01-fetch-hn.js`, `02-to-markdown.js`, `hn-frontpage.md`
- These were overwritten in Step 2

### Technical details
- HN DOM structure: `tr.athing` rows for stories, `.rank`, `.titleline > a` for title/link, next sibling `tr` has `.score`, `.hnuser`, `.age a`, last `a` in `.subline` for comments

## Step 2: Rewrite with Node.js + jsdom (real DOM execution)

User pointed out the JS was never actually executed against a DOM. Rewrote as a proper Node.js pipeline using `jsdom` to parse the fetched HTML into a real DOM, then ran standard `document.querySelectorAll` expressions to extract data.

### Prompt Context

**User prompt (verbatim):** "how do you run the js ?" (followed by) "use node.js"

**Assistant interpretation:** The user wants the JS to actually execute against a real parsed DOM, not just be documentation.

**Inferred user intent:** Real, executable DOM scraping — not AI extraction, not decorative code.

### What I did
- `npm init -y && npm install jsdom`
- Rewrote into 4 modular files:
  - `01-fetch-hn.js` — fetches HTML via `fetch()`, parses with `new JSDOM(html)`, returns `document`
  - `02-extract-stories.js` — `extractStories(document)` using `querySelectorAll('tr.athing')`, `.rank`, `.titleline > a`, `.score`, `.hnuser`, `.age a`, last link in `.subline`
  - `03-to-markdown.js` — `toMarkdown(stories)` formats into markdown with headers, links, metadata, `---` separators every 10 items
  - `04-run.js` — orchestrator: fetch → extract → markdown → write `hn-frontpage.md`
- Ran `node 04-run.js` — successfully extracted all 30 stories
- Fixed double `---` separator bug at end (added `(i + 1) < stories.length` guard)

### Why
- User explicitly wanted real JS DOM execution, not AI-assisted extraction

### What worked
- jsdom parsed HN HTML perfectly — all DOM queries worked identically to what you'd run in a browser console
- All 30 stories extracted with rank, title, URL, domain, score, author, age, comments
- Modular file structure (fetch → extract → format → run) is clean and reusable

### What didn't work
- Initial `03-to-markdown.js` produced a double `---` at the end when the last story was at position 30 (divisible by 10) — the "every 10 items" separator collided with the footer separator

### What I learned
- `jsdom` is a perfect fit: lightweight, no browser needed, standard DOM API
- HN's HTML is very scraping-friendly: semantic class names, stable table structure

### What was tricky to build
- The `.sitebit.comhead` selector — HN uses this for the domain display, but it's a compound class selector that requires both classes
- Comment count extraction: the last `<a>` in `.subline` holds the comment count, but for new stories it says "discuss" instead of "N comments"

### What warrants a second pair of eyes
- N/A — straightforward DOM extraction

### What should be done in the future
- Apply the same pattern to NYTimes (Step 3)

### Code review instructions
- Start with `04-run.js` to see the pipeline
- Key DOM queries are in `02-extract-stories.js`
- Run: `node 04-run.js`

### Technical details
```js
// Core extraction pattern
[...document.querySelectorAll('tr.athing')].map(row => {
  const rank = row.querySelector('.rank')?.textContent.trim().replace('.', '');
  const titleLink = row.querySelector('.titleline > a');
  const metaRow = row.nextElementSibling;
  const score = metaRow?.querySelector('.score')?.textContent.trim();
  // ...
});
```

## Step 3: Course correction — save all JS to files

User corrected my approach: I was running JS inline with `node -e` one-liners instead of saving each exploration as a numbered file. This was an important workflow correction — the whole point of numbered scripts is to have a reproducible, reviewable trail of the DOM exploration.

### Prompt Context

**User prompt (verbatim):** "I told you to save all js scripts"

**Assistant interpretation:** Stop running inline node -e commands. Every JS expression must be saved as a numbered file before execution.

**Inferred user intent:** Maintain a complete, reproducible trail of all exploration and extraction work as numbered scripts.

### What I did
- Stopped using `node -e` immediately
- From this point forward, every exploration step became a saved `.js` file with a numerical prefix

### Why
- Inline node -e commands vanish after execution — no audit trail, not reproducible
- The numbered file convention was established in Steps 1-2 and I violated it

### What worked
- N/A (process correction)

### What didn't work
- Running inline JS — user caught it and corrected

### What I learned
- When a convention is established (numbered files), maintain it consistently even for throwaway exploration

### What was tricky to build
- N/A

### What warrants a second pair of eyes
- N/A

### What should be done in the future
- N/A

### Code review instructions
- N/A

### Technical details
- N/A

## Step 4: NYT initial DOM inventory (`05-nyt-explore-structure.js`)

First contact with the NYT DOM. The question was: can we even use jsdom (plain fetch), or does NYT require JavaScript execution (Playwright)? Fetched the page and took an inventory of what's in the HTML: tag counts, `data-testid` attribute values, and `h2` headlines.

### Prompt Context

**User prompt (verbatim):** (see Step 3's original prompt — "now create similar script for nytimes.com...")

**Assistant interpretation:** Start by understanding the NYT page structure before writing any extraction code.

**Inferred user intent:** Methodical exploration of an unfamiliar, complex DOM.

### What I did
- Wrote `05-nyt-explore-structure.js`: fetches NYT, parses with jsdom, counts `article`/`section`/`h2`/`h3`/`a` tags, collects all `data-testid` values

### Why
- Unlike HN (which has a well-known, simple table structure), NYT's DOM is unknown. Need a map before diving in.

### What worked
- **Key discovery: plain fetch works.** The HTML is 1.3MB and already contains all content — NYT server-renders their front page. No Playwright/JS execution needed.
- Found `data-testid` attributes as structural hooks (NYT uses these for testing — they're more stable than CSS classes)
- Identified `programming-node` as the key container testid (9 instances)

### What didn't work
- Nothing failed per se, but the initial inventory was too broad to act on. 3 `article` tags, 49 `section` tags, 136 `a` tags — needed to zoom in.

### What I learned
- NYT HTML is huge (1.3MB) but jsdom handles it fine
- `data-testid` values provide the structural skeleton: `masthead-container`, `programming-node`, `Gallery`, `site-index`, `footer`
- The first `programming-node` has 108 links and 11 h2s — that's clearly the main content area
- The 13 `h2` headlines are section labels like "What to Watch and Read", "Our Best Advice", "The Athletic", "Games" — not story headlines

### What was tricky to build
- N/A (pure exploration)

### What warrants a second pair of eyes
- N/A

### What should be done in the future
- Zoom into the first `programming-node` to understand story-level structure

### Code review instructions
- Run: `node 05-nyt-explore-structure.js`

### Technical details
Key output:
```
HTML length: 1298330
article tags: 3          ← surprisingly few, not the main container
section tags: 49
programming-node count: 9  ← main content containers
  node[0]: h2=11 h3=0 p=110 a=108  ← this is the big one
```

## Step 5: Zoom into story elements (`06-nyt-explore-stories.js`)

Now that I knew the content lives in `programming-node[0]` with 108 links, the next question was: what is the structure of each story? What wraps headlines? Where are summaries? I examined the links, `<p>` tags, and especially the parent chain of each article link to find the containing wrapper.

### Prompt Context

**User prompt (verbatim):** (see Step 3)

**Assistant interpretation:** Drill into the story-level DOM structure within programming-node.

**Inferred user intent:** Find the repeating pattern that represents one story.

### What I did
- Wrote `06-nyt-explore-stories.js`:
  - Listed first 30 links with their parent/grandparent tags and text
  - Listed first 15 `<p>` elements with classes and content
  - Searched for elements with "story" in any class/attribute
  - Examined `<li>` elements in the main node
  - **Crucially:** traced the parent chain of each `<a>` with a `/2026/` URL, 6 levels up

### Why
- Needed to find the repeating container element — the equivalent of HN's `tr.athing`

### What worked
- **Parent chain analysis was the key breakthrough.** The output showed:
  ```
  A.tpl-lbl < DIV < DIV < DIV < DIV < DIV.story-wrapper.css-1e505by
  ```
  Every article link's chain terminated at `DIV.story-wrapper`. This is the container.
- Found 187 elements with "story" in their class — `div.story-wrapper` is the repeating unit
- `<p>` class analysis revealed the data model:
  - `p.indicate-hover` = headline text (class name hints at hover interaction)
  - `p.summary-class` = story description
  - First `<p>` (e.g., `p.css-tdd4a3`) holds a kicker like "Analysis"
  - `p.css-1a0ymrn` = "6 min read" — read time
- Links in `<li><ul>` patterns are related story bullets (e.g., "Obituary", "Pentagon Restrictions Ruling")
- Photo gallery links (`<figure>/<li>`) are carousel items, not stories — same href repeated

### What didn't work
- The `<article>` elements (only 3, all with class `loading-card`) are not story containers — they're lazy-loading placeholders with no content

### What I learned
- `div.story-wrapper` is the story container (not `<article>` as you'd expect semantically)
- The class names are CSS-module hashed (`css-1e505by`, `css-tdd4a3`) — unstable for selection, but `story-wrapper` itself is a semantic name that's more stable
- Headline links use class `tpl-lbl` which likely stands for "template label"
- Photo gallery carousel links all point to the same live-blog URL — deduplication will be needed

### What was tricky to build
- Distinguishing story links from photo gallery links. Both are `<a>` tags with article URLs, but gallery links are inside `<figure>/<li>` with the same href repeated 14 times for the same live blog.

### What warrants a second pair of eyes
- N/A

### What should be done in the future
- Extract data from each `.story-wrapper` (Step 6)

### Code review instructions
- Run: `node 06-nyt-explore-stories.js`
- Key output is the "Parent chain" section at the bottom

### Technical details
```
Key parent chains discovered:
  Story link: A.tpl-lbl < DIV < DIV < DIV < DIV < DIV.story-wrapper
  Gallery:    A.kyt-tdFHR < FIGURE < LI.kyt-SgEEq < OL.carousel-ol < DIV < SECTION

Key <p> classes:
  css-tdd4a3       → kicker ("Analysis")
  indicate-hover   → headline
  summary-class    → description
  css-1a0ymrn      → read time ("6 min read")
  css-ae0yjg       → live indicator ("LIVE")
```

## Step 6: Story-wrapper deep dive (`07-nyt-explore-story-wrappers.js`)

Armed with the knowledge that stories live in `.story-wrapper`, I now extracted the full data from each one: headline, summary, kicker, read time, related links. This was the "can I actually build an extractor?" validation step.

### Prompt Context

**User prompt (verbatim):** (see Step 3)

**Assistant interpretation:** Validate that all story data can be reliably extracted from story-wrapper elements.

**Inferred user intent:** Prove the extraction approach works before writing the final pipeline.

### What I did
- Wrote `07-nyt-explore-story-wrappers.js`:
  - For each of 153 `.story-wrapper` elements, extracted: headline (`p.indicate-hover`), summary (`p.summary-class`), kicker (first non-headline/summary `<p>`), href, read time, related links
  - Also searched for article-URL links NOT inside any story-wrapper to find stories we'd miss

### Why
- Needed to confirm the data model before building the pipeline. Are all headlines in `p.indicate-hover`? Are all summaries in `p.summary-class`? What edge cases exist?

### What worked
- **153 story-wrappers found** — but many are duplicates (NYT renders a desktop and mobile version)
- Extraction worked for most stories: headline, summary, kicker, href all present
- Found stories outside story-wrappers: related links in `<ul><li>` like "Pentagon Restrictions Ruling", "Harvard Lawsuit" — these are secondary stories shown as bullet lists

### What didn't work
- **Story 27 (Gadd/Baby Reindeer) had an empty `indicate-hover` headline.** This was the first sign of the dual-layout problem. The story-wrapper had `href` and content, but its headline was in a different class pattern.
- Many wrappers had empty hrefs (the duplicate/mobile version of each story)
- The "Got a Tip?" promo appeared as a story-wrapper — needs filtering

### What I learned
- Not all stories use `p.indicate-hover` — some (feature/magazine stories) use different class patterns
- Kicker is context-dependent:
  - "Analysis" → real kicker (section label)
  - "6 min read" → actually a read time, not a kicker
  - "Maureen Dowd" → author name (opinion section)
  - "Times Investigation" → investigative label
  - "LIVE" → live indicator
  - "From The Athletic" → source attribution
- NYT duplicates story-wrappers: one with href (desktop), one without (mobile). Need deduplication by href.

### What was tricky to build
- The kicker field is overloaded with 5+ different semantic meanings, all in the same structural position (first `<p>` in the wrapper). Disambiguation requires regex and content inspection, not just DOM position.

### What warrants a second pair of eyes
- The Gadd story was silently dropped — no error, just empty headline from `indicate-hover`. This kind of silent failure is dangerous.

### What should be done in the future
- Investigate why the Gadd story has a different layout (done in Step 8)

### Code review instructions
- Run: `node 07-nyt-explore-story-wrappers.js`
- Look at Story 27 output — the missing headline that led to the kyt-* discovery

### Technical details
```
Example output showing the kicker overloading:
  Story 1:  kicker="Analysis"           ← real kicker
  Story 2:  kicker="6 min read"         ← actually read time
  Story 3:  kicker="LIVE"               ← live indicator
  Story 14: kicker="8 min read"         ← read time
  Story 20: kicker="Times Investigation" ← investigation label
  Story 27: kicker="The Interview"       ← feature label (but headline was EMPTY)
  Story 78: kicker="Maureen Dowd"        ← author name
```

## Step 7: Section mapping and dedup confirmation (`08-nyt-explore-sections.js`)

Final exploration step before building the pipeline. Needed to answer two questions: (1) what's the relationship between the 9 `programming-node` containers — are they sections or duplicates? (2) Can I infer a story's section from its URL?

### Prompt Context

**User prompt (verbatim):** (see Step 3)

**Assistant interpretation:** Map the macro structure: which programming-nodes contain which stories, and do they duplicate.

**Inferred user intent:** Finalize the extraction strategy before writing production code.

### What I did
- Wrote `08-nyt-explore-sections.js`:
  - For each of 9 `programming-node` elements: listed h2 section headers, counted story-wrappers with headline+href, listed related links, and for each story printed the headline, inferred section from URL, and kicker

### Why
- If all 9 programming-nodes contain unique stories, the extractor needs to iterate all of them. If they duplicate, it should use only one. This determines the core extraction strategy.

### What worked
- **Definitively confirmed: programming-node[0] contains ALL stories.** Nodes 1-8 are strict subsets:
  - Node 0: 34 stories (the full set)
  - Node 1: 4 stories (same as node 0's top 4 — Iran coverage)
  - Node 2: 4 stories (identical to node 1)
  - Node 3: 19 stories (subset of node 0, middle section)
  - Node 4: 4 stories (opinion section only)
  - Nodes 5-6: 0 stories (video section, no text stories)
  - Nodes 7-8: 7 stories each (games/puzzles only)
- Section inference from URL works reliably:
  ```
  /2026/03/21/us/politics/... → "us"
  /2026/03/21/world/... → "world"
  /athletic/7132635/... → "athletic"
  /live/2026/03/21/... → "live"
  /interactive/2026/... → "interactive"
  /games/... → "games"
  ```
- The regex `nytimes.com/(?:20\d\d/\d\d/\d\d/)?([^/]+)` handles both dated (`/2026/03/21/us/...`) and undated (`/athletic/...`, `/games/...`) URL formats

### What didn't work
- Nothing — this step cleanly confirmed the strategy

### What I learned
- The duplication pattern is: NYT renders multiple layout variants of the same stories (likely for responsive/A-B testing). Only node[0] is the canonical set.
- The h2 headers in each node map to visual page sections ("What to Watch and Read", "Opinion", "The Athletic", "Games") — these can be used for grouping, but URL-based section inference is more reliable because not every story has a parent h2.
- Node[0]'s 34 stories map cleanly to sections: `us` (8), `athletic` (4), `interactive` (4), `opinion` (4), `business` (2), `world` (2), `live` (1), `magazine` (0 — because of the indicate-hover bug), `podcasts` (1), `your-money` (1), plus games/puzzles

### What was tricky to build
- N/A (pure exploration, no ambiguity in results)

### What warrants a second pair of eyes
- N/A

### What should be done in the future
- Build the extraction pipeline (Step 8)

### Code review instructions
- Run: `node 08-nyt-explore-sections.js`
- The node-by-node breakdown is the key output

### Technical details
```
Programming-node duplication map:
  Node 0: 34 stories — FULL SET (use this)
  Node 1: 4 stories — top Iran stories (duplicate)
  Node 2: 4 stories — identical to node 1 (duplicate)
  Node 3: 19 stories — mid-page stories (duplicate)
  Node 4: 4 stories — opinion (duplicate)
  Node 5: 0 stories — video section
  Node 6: 0 stories — video section (duplicate)
  Node 7: 7 stories — games/puzzles (duplicate)
  Node 8: 7 stories — games/puzzles (duplicate)

URL → section regex: nytimes.com/(?:20\d\d/\d\d/\d\d/)?([^/]+)
```

## Step 8: NYTimes extraction pipeline (`09-12`)

With the DOM fully mapped, built the production extraction pipeline. Four modular files following the same pattern as HN. First run extracted 40 stories, 34 after filtering games/puzzles. But the Baby Reindeer magazine story was missing — headline was empty because of the alternate layout.

### Prompt Context

**User prompt (verbatim):** (see Step 3)

**Assistant interpretation:** Implement the NYT scraper pipeline as numbered JS files.

**Inferred user intent:** Working, modular code that produces clean markdown from NYT front page.

### What I did
- `09-nyt-fetch.js` — Fetches NYT HTML via `fetch()`, returns jsdom `document`
- `10-nyt-extract-stories.js` — Core extractor:
  - Iterates `.story-wrapper` in programming-node[0] only
  - Deduplicates by href (skips wrappers with empty or seen hrefs)
  - Extracts headline from `p.indicate-hover`, summary from `p.summary-class`
  - Kicker detection with read-time disambiguation: regex `/^\d+ min read$/` separates kickers from read times
  - Section inference from URL path
  - LIVE detection from kicker text or `/live/` in URL
  - Related links from `<ul><li>` outside story-wrappers
- `11-nyt-to-markdown.js` — Markdown formatter:
  - Groups stories by inferred section
  - Maps section slugs to display names (`us` → "U.S.", `athletic` → "The Athletic / Sports")
  - Orders sections by news importance: live → us → world → business → opinion → ...
  - Filters out games/puzzles/crosswords
  - Formats kickers in italics, summaries as blockquotes, LIVE as code badges
- `12-nyt-run.js` — Orchestrator: fetch → extract → markdown → write `nyt-frontpage.md`

### Why
- Direct parallel to the HN pipeline — same architecture, adapted for NYT's more complex DOM

### What worked
- First run: 40 stories extracted, 34 after filtering games/puzzles, grouped into 8 sections
- Section grouping and ordering makes the output scannable and newspaper-like
- Related links from `<ul><li>` patterns captured as secondary stories marked *(related)*
- The markdown output reads like a proper newspaper front page

### What didn't work
- **The Baby Reindeer/Gadd magazine story was silently dropped.** The extractor required `p.indicate-hover` for the headline. The Gadd story uses a feature layout with `kyt-*` classes instead. Result: `headline` was empty → `if (!headline) return` skipped it.
- This was caught by `13-nyt-debug-missing.js` (Step 9)

### What I learned
- The "require headline" guard (`if (!headline) return`) is a double-edged sword: it cleanly filters junk wrappers but also silently drops stories with alternate layouts
- Section inference from URL is robust across all story types (dated articles, Athletic, live blogs, interactive, games)

### What was tricky to build
- Kicker vs read time: both are the first `<p>` in the wrapper. "Analysis" is a kicker, "6 min read" is metadata. The regex `^\d+ min read$` handles this, but it's fragile — what about "1 hour read" or localized versions?
- The dedup-by-href approach works but is order-dependent. Since we only use node[0], order is deterministic, but if NYT changes the rendering order, different stories could be kept/dropped.

### What warrants a second pair of eyes
- The silent drop of the Gadd story — any extraction that silently skips content is a bug risk

### What should be done in the future
- Fix the headline detection to handle feature layouts (done in Step 10)

### Code review instructions
- Start with `12-nyt-run.js` → `10-nyt-extract-stories.js` for the core logic
- Run: `node 12-nyt-run.js` — produces `nyt-frontpage.md`

### Technical details
```js
// Core extraction loop (pre-kyt fix)
const wrappers = mainNode.querySelectorAll('.story-wrapper');
wrappers.forEach(w => {
  const href = w.querySelector('a')?.getAttribute('href') || '';
  if (!href || seenHrefs.has(href)) return;   // dedup
  const headline = w.querySelector('p.indicate-hover')?.textContent.trim();
  if (!headline) return;                       // ← this silently dropped Gadd
  // ... extract kicker, summary, readTime, section
});
```

## Step 9: Debug missing stories (`13-nyt-debug-missing.js`, `14-nyt-find-missing-stories.js`)

After the first pipeline run, I wrote two debug scripts to verify completeness. `13` listed all extracted stories with their sections — the Gadd story was absent. `14` investigated every *skipped* story-wrapper to find why.

### Prompt Context

**User prompt (verbatim):** (see Step 3)

**Assistant interpretation:** Verify the extractor isn't missing stories.

**Inferred user intent:** Completeness and correctness matter.

### What I did
- `13-nyt-debug-missing.js`:
  - Extracted stories, searched for "Gadd" or "Baby Reindeer" → **MISSING**
  - Printed section counts and full story list with indices
  - Confirmed: `magazine` section had 0 stories (should have 1)
- `14-nyt-find-missing-stories.js`:
  - For every `.story-wrapper` that was skipped by the extractor, printed: href, `indicate-hover` text, all `<p>` elements with classes, raw text, and checked for `<h2>`, `<h3>`, `<strong>` alternatives
  - Specifically searched for "Gadd" in the raw HTML → found at index 261199
  - Located the magazine link → found in a story-wrapper with `p.indicate-hover` present but **empty**
  - Printed the actual `<p>` elements:
    ```
    p[0]: cls="kyt-fuzOt kyt-5HcZI" text="The Interview"        ← kicker
    p[1]: cls="kyt-+7LQ2 css-1uk1gs8" text="After 'Baby Reindeer,' Richard Gadd..."  ← headline!
    p[2]: cls="kyt-+IFTi" text="Philip Gay for The New York Times" ← photo credit
    ```
  - **Root cause found:** Feature/magazine stories use `kyt-*` CSS module classes for `<p>` elements, not the `indicate-hover` class. The headline is in `p[1]`, the kicker in `p[0]`, and `p[2]` is a photo credit.

### Why
- Never trust an extractor without verification. The Gadd story was the only feature-layout story on the page — without the debug scripts, it would have been silently lost.

### What worked
- The two-script approach: `13` identifies *what's* missing, `14` explains *why*
- Searching the raw HTML for "Gadd" confirmed the content exists, narrowing the problem to extraction logic
- The wrapper-level `<p>` dump immediately revealed the alternate class pattern

### What didn't work
- N/A (debug scripts worked as intended)

### What I learned
- NYT has (at least) two story layout templates:
  1. **Standard**: `p.indicate-hover` for headline, `p.summary-class` for summary, CSS-hashed kicker
  2. **Feature/magazine**: `p.kyt-*` classes for all elements, ordered as kicker → headline → photo credit
- The `kyt-*` prefix is likely from a different CSS module/build system than the standard stories
- There was only 1 feature-layout story on the page (Gadd) — easy to miss without systematic checking
- 16 total skipped wrappers: most were duplicates (empty href), the Weather interactive, the "Got a Tip?" promo, and the Gadd story

### What was tricky to build
- Identifying which skipped wrappers were genuinely missing stories vs. expected skips (duplicates, promos, interactives). Had to cross-reference with the exploration output from Step 6/7.

### What warrants a second pair of eyes
- The assumption that `kyt-*` p[0]=kicker, p[1]=headline, p[2]=credit is based on exactly one example. If there's a feature story with a different number of `<p>` elements (e.g., no kicker, or with a summary), this would break.

### What should be done in the future
- Fix the extractor (Step 10)
- Ideally run the debug script periodically against different NYT front pages to check for new layout variants

### Code review instructions
- Run: `node 13-nyt-debug-missing.js` (shows all stories, confirms presence/absence)
- Run: `node 14-nyt-find-missing-stories.js` (shows exactly why each wrapper was skipped)

### Technical details
```
The Gadd story wrapper's <p> elements:
  p[0]: cls="kyt-fuzOt kyt-5HcZI"     text="The Interview"
  p[1]: cls="kyt-+7LQ2 css-1uk1gs8"   text="After 'Baby Reindeer,' Richard Gadd..."
  p[2]: cls="kyt-+IFTi"               text="Philip Gay for The New York Times"

Standard story wrapper's <p> elements:
  p[0]: cls="css-tdd4a3"              text="Analysis"         (kicker)
  p[1]: cls="indicate-hover css-8cjtbs" text="Trump Is Eyeing..." (headline)
  p[2]: cls="summary-class css-crclbt" text="President Trump..."  (summary)
  p[3]: cls="css-1a0ymrn"             text="6 min read"        (read time)
```

## Step 10: Fix feature-layout extraction and final run

Applied the fix to `10-nyt-extract-stories.js`: when `p.indicate-hover` yields no headline, fall back to scanning for `<p>` elements with `kyt-*` class prefixes. Re-ran the pipeline — 41 stories total, 35 after filtering, Gadd story now present under Magazine section.

### Prompt Context

**User prompt (verbatim):** (see Step 3)

**Assistant interpretation:** Fix the extractor to handle both layout patterns.

**Inferred user intent:** Complete, correct extraction.

### What I did
- Modified `10-nyt-extract-stories.js`:
  - After `p.indicate-hover` check, added fallback: filter all `<p>` for `kyt-*` classes
  - If 2+ kyt-* `<p>` found: `kytPs[0]` = kicker, `kytPs[1]` = headline
  - If exactly 1 kyt-* `<p>`: use it as headline (no kicker)
  - Updated file header comment to document the dual-layout pattern
- Verified with `13-nyt-debug-missing.js`: "Baby Reindeer story: FOUND — section=magazine"
- Final run: `node 12-nyt-run.js` → 35 stories in 9 sections, `nyt-frontpage.md` written

### Why
- The Gadd story was the proof that one layout pattern isn't enough

### What worked
- The fallback detection correctly captures the Gadd story with kicker "The Interview"
- All 41 stories now extracted (35 after game/puzzle filtering)
- Magazine section appears in the output for the first time
- No regressions — all previously extracted stories still present

### What didn't work
- Nothing — clean fix

### What I learned
- The fix is minimal (about 12 lines of JS) but structurally important — it turns a single-pattern extractor into a two-pattern one
- Testing against the debug script immediately confirmed the fix

### What was tricky to build
- The `[...p.classList].some(c => c.startsWith('kyt-'))` check relies on class prefix convention. If NYT changes their CSS module naming, this breaks. But there's no better hook — the kyt-* elements have no `data-testid` or semantic class.

### What warrants a second pair of eyes
- The ordering assumption: `kytPs[0]` = kicker, `kytPs[1]` = headline. Derived from one example. A feature story with 3+ kyt-* `<p>` elements, or one where the order is different, would produce wrong output.
- Section inference from URL path (`/2026/03/21/us/politics/...` → "us") assumes a consistent URL structure. The Athletic uses a different pattern (`/athletic/7132635/...`).

### What should be done in the future
- Add Wirecutter stories (currently in a later programming-node)
- Handle the "Most Popular This Week" section
- Consider adding byline extraction (currently empty for all stories)
- Run against different days' front pages to find more layout variants

### Code review instructions
- Key change in `10-nyt-extract-stories.js` lines ~30-45: the kyt-* fallback block
- Run: `node 12-nyt-run.js` — produces `nyt-frontpage.md`
- Verify: `node 13-nyt-debug-missing.js` — should show "Baby Reindeer story: FOUND"

### Technical details
```js
// The fix: dual-layout headline detection
let headlineEl = w.querySelector('p.indicate-hover');
let headline = headlineEl?.textContent.trim() || '';

if (!headline) {
  // Feature layout fallback: kyt-* class pattern
  const kytPs = allPs.filter(p =>
    [...p.classList].some(c => c.startsWith('kyt-')) &&
    !p.classList.contains('summary-class')
  );
  if (kytPs.length >= 2) {
    kicker = kytPs[0]?.textContent.trim();  // "The Interview"
    headlineEl = kytPs[1];                   // "After 'Baby Reindeer,'..."
    headline = headlineEl?.textContent.trim() || '';
  } else if (kytPs.length === 1) {
    headlineEl = kytPs[0];
    headline = headlineEl?.textContent.trim() || '';
  }
}
```

Final DOM structure map:
```
[data-testid="programming-node"][0]   ← use only this one
  └─ div.story-wrapper (153 total, ~35 unique with href)
      ├─ <a href="...">               — article link
      ├─ Standard layout:
      │   ├─ <p class="indicate-hover"> — headline
      │   ├─ <p class="summary-class">  — description
      │   └─ <p>                        — kicker OR read time
      ├─ Feature layout:
      │   ├─ <p class="kyt-*">          — kicker
      │   ├─ <p class="kyt-*">          — headline
      │   └─ <p class="kyt-*">          — photo credit
      └─ <ul><li><a>                    — related links
```

## Step 11: WonderOS DOM exploration (`15-wonderos-explore-structure.js`, `16-wonderos-explore-content.js`)

Completely different type of site from HN or NYT. WonderOS is Alexander Obenauer's personal computing research project — a single-page site with ~10KB of HTML, not a news feed. The exploration needed to identify the page's content structure rather than repeating story patterns.

### Prompt Context

**User prompt (verbatim):** "https://wonderos.org/ now"

**Assistant interpretation:** Apply the same fetch-extract-markdown approach to a new site.

**Inferred user intent:** Test the approach against a non-news, content-heavy project page.

### What I did
- `15-wonderos-explore-structure.js` — Tag inventory, class names, headings, links, section/id mapping, and first 2000 chars of raw HTML
- `16-wonderos-explore-content.js` — Walked `.container` children in order, extracted each section's headings/paragraphs/links, dumped `#summary`, all 3 `<section>` elements, and footer

### Why
- Can't reuse HN or NYT extraction patterns — need to understand the unique structure of this site first

### What worked
- **Discovery: only 10KB of HTML, 17 links, 25 paragraphs.** This is a tiny site — no pagination, no lazy loading, no JS-rendered content. Perfect for jsdom.
- Structure quickly became clear from the two exploration scripts:
  - `.container` holds everything
  - `#summary` div: 3 pillars (Software, Hardware, Society) as paired `<p>` elements (title + description)
  - `<article>` with 3 `<section>` children:
    - Section 0: 6 paragraphs describing the WonderOS concept
    - Section 1: project outputs with `h3` ("VM experiments", "Handbook") and `h2` ("Updates") headings plus paragraphs and inline links
    - Section 2: acknowledgments text
  - `#footer`: links to Poster and Hello, Operator!
- `15-` gave the macro view, `16-` gave the full text. Two scripts were sufficient (vs. 4 for NYT).

### What didn't work
- Nothing significant. The site is simple enough that exploration was straightforward.

### What I learned
- The page's `h1` contains an `<img>` (the WonderOS wordmark), not text — `h1.textContent` is empty
- The hero headline is also an `<img>` with the question in its `alt` attribute: "How can the future of personal computing better serve people's lives?"
- The first description paragraph starts with "is an ongoing research project" — "WonderOS" is rendered as an image, not text. Need to prepend it.
- Svelte-generated class names (`svelte-ywmi04`) are hashed but `.container`, `#summary`, `#footer` are semantic and stable
- The site uses Elder.js (Svelte-based SSG): `/_elderjs/assets/svelte-*.css`

### What was tricky to build
- Identifying that the `#summary` pillars are paired `<p>` elements: p[0] is the intro line, then (p[1]=title, p[2]=desc), (p[3]=title, p[4]=desc), (p[5]=title, p[6]=desc). The pairing isn't marked up with wrapper elements.

### What warrants a second pair of eyes
- N/A — simple site

### What should be done in the future
- Build the pipeline (Step 12)

### Code review instructions
- Run: `node 15-wonderos-explore-structure.js`, `node 16-wonderos-explore-content.js`

### Technical details
```
WonderOS DOM structure:
  .container
    div                — hero (logo img + headline img + computer photo)
    hr
    #summary           — author link + 3 pillar pairs (p + p)
    div                — decorative
    article
      section[0]       — 6 paragraphs: what is WonderOS
      section[1]       — outputs: h3 "VM experiments" + ps, h3 "Handbook" + ps, h2 "Updates" + ps
      section[2]       — acknowledgments (plain text)
    div                — (empty)
  #footer              — links: Poster, Hello Operator!
```

## Step 12: WonderOS extraction and markdown pipeline (`17-20`)

Built the full pipeline. The challenge here wasn't finding repeating patterns (there aren't any — it's a single page) but faithfully extracting the prose structure: hero question, 3 pillars, 6 description paragraphs, outputs with mixed heading levels, and inline links.

### Prompt Context

**User prompt (verbatim):** (see Step 11)

**Assistant interpretation:** Build fetch/extract/markdown/run pipeline for WonderOS.

**Inferred user intent:** Complete, readable markdown rendering of the WonderOS project page.

### What I did
- `17-wonderos-fetch.js` — Fetch + jsdom, same pattern as HN/NYT
- `18-wonderos-extract.js` — Extracts structured content:
  - `heroQuestion` from headline image `alt` attribute
  - `title` from `h1 img` alt
  - `author` from `#summary a` (name + URL)
  - `pillars` from paired `<p>` elements in `#summary` (skip p[0] intro, then pairs)
  - `description` from `section[0]` paragraphs (with "WonderOS " prepended to first)
  - `outputs` from `section[1]`: walks children, groups paragraphs/links under `h2`/`h3` headings
  - `acknowledgments` from `section[2]` with whitespace normalization
  - `links` from `#footer` with relative URL resolution
- `19-wonderos-to-markdown.js` — Formats as markdown:
  - Title + blockquote hero question
  - Author attribution with link
  - 3 pillars as `###` headings
  - About section with full description
  - Outputs section preserving h2/h3 hierarchy
  - Inline links as bullet lists under their parent sections
  - Acknowledgments and footer links
- `20-wonderos-run.js` — Orchestrator

### Why
- Applying the modular pattern to a third site type — proves it works for project pages, not just news feeds

### What worked
- Clean markdown output: hero question as blockquote, 3 pillars, full prose, outputs with links, acknowledgments
- All 17 links extracted and properly formatted
- Relative URLs (`/hello/`, `/poster/`) resolved to absolute in footer links

### What didn't work
- First run: description started with "is an ongoing research project" — missing "WonderOS" because it's in an `<img>` not `<p>`. Fixed with a prefix check: `if (text.startsWith('is an ongoing')) text = 'WonderOS ' + text`
- Acknowledgments had excess whitespace from inline HTML formatting. Fixed with `.replace(/\s+/g, ' ')`

### What I learned
- The modular pattern (fetch → extract → markdown → run) scales from complex news sites (NYT: 153 wrappers, 2 layouts) down to simple project pages (WonderOS: 3 sections, 25 paragraphs)
- Content pages need a different extraction strategy: instead of finding repeating patterns, you walk the DOM tree and group content by headings
- Image alt text is a legitimate content source — both the title and hero question exist only in `alt` attributes

### What was tricky to build
- The `section[1]` output extraction: it has mixed `h2` and `h3` headings with paragraphs between them, plus inline links within paragraphs. Had to walk children sequentially and accumulate paragraphs/links into heading-groups, pushing each group when the next heading is encountered.
- The pillar pairs in `#summary`: no wrapper elements, just alternating `<p>` tags (title, description, title, description...) with an introductory `<p>` before them. Used index-based stepping (`for (let i = 1; i < ps.length - 1; i += 2)`) which is fragile if the HTML structure changes.

### What warrants a second pair of eyes
- The "WonderOS " prefix is hardcoded for the first paragraph. If the page text changes, this could produce "WonderOS Some other text..."
- The pillar extraction's index-based pairing assumes exactly 3 pairs after the intro paragraph

### What should be done in the future
- N/A — complete for this site

### Code review instructions
- Start with `20-wonderos-run.js` → `18-wonderos-extract.js`
- Run: `node 20-wonderos-run.js` → produces `wonderos.md`

### Technical details
```js
// Pillar extraction: paired <p> elements
const ps = [...summaryDiv.querySelectorAll('p')];
// ps[0] = "An ongoing research project by..."
// ps[1] = "Software", ps[2] = "Exploring an itemized..."
// ps[3] = "Hardware", ps[4] = "Exploring a personal..."
// ps[5] = "Society", ps[6] = "Exploring how people..."
for (let i = 1; i < ps.length - 1; i += 2) {
  pillars.push({ title: ps[i].textContent, desc: ps[i+1].textContent });
}

// Output section: walk children, group under headings
children.forEach(el => {
  if (el.tagName === 'H3' || el.tagName === 'H2') {
    if (currentOutput) outputs.push(currentOutput);
    currentOutput = { heading: el.textContent, paragraphs: [], links: [] };
  } else if (el.tagName === 'P' && currentOutput) {
    currentOutput.paragraphs.push(el.textContent);
    el.querySelectorAll('a').forEach(a => currentOutput.links.push(...));
  }
});
```

## Step 13: Multi-page WonderOS — discover subpages (`21-`, `22-`)

User asked if the same script could run across multiple pages on wonderos.org. First step: find what pages exist, then check whether they share enough structure for a generic extractor.

### Prompt Context

**User prompt (verbatim):** "can we call the same script on multiple pages on wonderos.org"

**Assistant interpretation:** Find all pages on the site, check if the current extractor works across them or needs generalization.

**Inferred user intent:** A single script that can process any wonderos.org page, run across the whole site.

### What I did
- `21-wonderos-find-pages.js` — Crawled all links from the home page, separated internal vs external, then fetched each internal page to get its size/structure summary
- `22-wonderos-explore-subpages.js` — Side-by-side structural comparison of all 3 pages: `.container` children, headings, sections, article presence, `#summary`, `#footer`

### Why
- Need to know what pages exist and how different their DOM structures are before deciding on a generic vs page-specific approach

### What worked
- Discovered 3 pages total: `/` (10KB), `/hello/` (21KB, 12 sections — the handbook), `/poster/` (3KB)
- Plus 9 external links (alexanderobenauer.com, GitHub, Val Town, etc.)
- Structural comparison revealed:
  - `/` — `.container` > `#summary` + `article` with 3 sections
  - `/hello/` — **no `.container`**, `#cover` + `#bumper` + `article` with 12 sections (handbook chapters), h2 headings, ToC section
  - `/poster/` — `.container` > `#main` with h1 + product info paragraphs, no article/sections
- All share `#footer` with Poster/Hello links

### What didn't work
- N/A

### What I learned
- The 3 pages have completely different DOM structures — the page-specific extractor (`18-wonderos-extract.js`) cannot work across them
- `/hello/` is the richest page: a multi-chapter handbook with `[WIP]` markers for unfinished chapters
- `/poster/` is a simple product page (poster for sale)
- The common thread: all have `<article>` with `<section>` children (except `/poster/`), and all have `#footer`

### What was tricky to build
- N/A (exploration only)

### What warrants a second pair of eyes
- N/A

### What should be done in the future
- Build generic extractor (Step 14)

### Code review instructions
- Run: `node 21-wonderos-find-pages.js` (page discovery), `node 22-wonderos-explore-subpages.js` (structure comparison)

### Technical details
```
Page inventory:
  /        — 10KB, .container, #summary, article(3 sections), #footer
  /hello/  — 21KB, NO .container, #cover, #bumper, article(12 sections), #footer
  /poster/ — 3KB,  .container, #main(h1 + ps), NO article, #footer
```

## Step 14: Generic multi-page extractor (`23-`, `24-`)

Built a generic extractor that handles all 3 page types. The key insight: despite different top-level containers, the content model is the same — headings with associated paragraphs and links. The extractor adapts: `#summary` gets structured pillar extraction, `#main` gets simple paragraph extraction, and `<article><section>` gets heading-grouped extraction with WIP detection.

### Prompt Context

**User prompt (verbatim):** (see Step 13)

**Assistant interpretation:** Build a single extractor + runner that processes all wonderos.org pages.

**Inferred user intent:** One command to get the entire site as markdown.

### What I did
- `23-wonderos-generic-extract.js` — Two exported functions:
  - `extractPage(document, url)` — adapts to page type:
    - If `#summary`: extracts author link and pillar pairs (structured, not flattened)
    - If `#main` without `article`: extracts as product page (h1 + paragraphs)
    - If `article`: walks `<section>` children, groups paragraphs/links under headings, detects `[WIP]` markers, skips ToC sections (those with many links but no paragraphs)
    - Resolves relative URLs to absolute
    - Footer links from `#footer`
  - `pageToMarkdown(page)` — renders to markdown:
    - Title as h1, source link, intro text
    - Pillars as `###` headings (if present)
    - Sections with heading hierarchy, WIP tags, paragraph blocks, link lists
    - Footer links section
- `24-wonderos-run-all.js` — Fetches all 3 pages, extracts each, produces combined `wonderos-all.md` with ToC

### Why
- Three different page structures → need an extractor that adapts rather than hardcodes

### What worked
- All 3 pages extracted correctly in one run: 3 + 11 + 1 = 15 sections total
- Home page pillars rendered with structure (not flattened text)
- "WonderOS" prefix restored for the home page's first paragraph
- `/hello/` handbook renders as a readable multi-chapter document with proper h3 headings
- `/poster/` renders as a clean product page
- Combined output is 222 lines with proper heading hierarchy

### What didn't work
- First run: home page intro was flattened — all pillar text collapsed into one line. Fixed by adding structured pillar extraction with `result.pillars = [...]` and rendering them as `### heading / desc` pairs.
- First run: "WonderOS" prefix was missing from first description paragraph (same bug as `18-`). Added the same `startsWith('is an ongoing')` fix.

### What I learned
- A generic extractor doesn't mean one code path — it means detecting which page type you're on and adapting. The `#summary` / `#main` / `article` checks act as discriminators.
- The `<article><section>` pattern is the most reusable: walk sections, group content under headings. This worked for both `/` (3 sections) and `/hello/` (12 sections) without changes.
- ToC detection (section with many links, no paragraphs) successfully skipped the `/hello/` table of contents.

### What was tricky to build
- ToC vs content section: `/hello/` section[1] is a table of contents with 8 links and no paragraphs. If not skipped, it would render as an empty section with a list of anchor links. The heuristic `!paragraphs.length && links.length > 3` catches this, but a content section that happens to have only links and no prose would also be skipped.
- Pillar pair extraction from `#summary`: same fragile index-based pairing as `18-`, but now encapsulated in the generic extractor. If the home page adds a 4th pillar or changes the intro text, the `for (i=1; i<length-1; i+=2)` loop handles it — but if they add non-pillar `<p>` elements to `#summary`, it would break.

### What warrants a second pair of eyes
- The "WonderOS" prefix hack — hardcoded string match
- The ToC skip heuristic — could false-positive on link-heavy content sections

### What should be done in the future
- N/A — complete for this site

### Code review instructions
- `24-wonderos-run-all.js` is the entry point
- `23-wonderos-generic-extract.js` has both the extractor and formatter
- Run: `node 24-wonderos-run-all.js` → produces `wonderos-all.md`

### Technical details
```js
// Page type detection in extractPage()
const summaryDiv = document.querySelector('#summary');  // home page
const mainDiv = document.querySelector('#main');        // poster page
const article = document.querySelector('article');      // home + hello

// Pillar extraction (home page)
for (let i = 1; i < ps.length - 1; i += 2) {
  pillars.push({ title: ps[i].textContent, desc: ps[i+1].textContent });
}

// ToC skip (hello page)
const isToC = !paragraphs.length && links.length > 3 && headingText;
if (isToC) { result.links.push(...links); return; }

// WIP detection
const wip = paragraphs.some(p => /^Work in progress/i.test(p));
```

## Step 15: GitHub repo DOM exploration (`25-28`)

New site type: a GitHub repository page. Unlike the previous sites (news feeds, project pages), GitHub uses a hybrid rendering approach: server-rendered HTML for the page chrome and sidebar, but a JSON payload inside a `<react-app>` element for the file tree, README HTML, and repo metadata. This required exploring both the DOM and the embedded JSON.

### Prompt Context

**User prompt (verbatim):** "now implement one to browse a github repo like https://github.com/alexobenauer/Wonder"

**Assistant interpretation:** Build a scraper that extracts structured data from any GitHub repo page: metadata, file tree, README, languages, social stats.

**Inferred user intent:** Extend the DOM scraping experiment to a complex JS-heavy app (GitHub) where content comes from both HTML and embedded JSON.

### What I did
- `25-github-explore-structure.js` — Initial inventory: tags, `data-testid` values, GitHub-specific selectors (repo name, description, language, file tree, README, topics, stars), headings, file listing patterns, turbo frames, `react-app` element
- `26-github-explore-data.js` — Deep dive into JSON payload (file tree, branch info), sidebar `.BorderGrid-row` sections (About, Releases, Languages, Stars/Watchers/Forks), README structure (headings/paragraphs/code blocks), commit info
- `27-github-explore-overview.js` — Explored the `overview` and `tree` objects from JSON: found `commitCount`, `overviewFiles[0].richText` (README HTML), tree item metadata
- `28-github-explore-repo-meta.js` — Extracted `codeViewLayoutRoute.repo` (id, owner, name, branch, dates, visibility), parsed README HTML from JSON into headings/paragraphs/code blocks, extracted languages and social stats from sidebar

### Why
- GitHub is the most complex site so far: React app, JSON islands, turbo frames, server-rendered sidebar. Need to understand all data sources before writing an extractor.

### What worked
- **Key discovery: `react-app > script[type="application/json"]` contains a 137KB JSON payload** with the complete file tree, README HTML, repo metadata, and branch info. This is far more reliable than scraping the rendered DOM.
- Sidebar `.BorderGrid-row` elements provide: About (description, stars, watchers, forks), Releases, Packages, Contributors, Languages
- README HTML is in `overviewFiles[0].richText` — a pre-rendered HTML string that can be parsed with jsdom for headings/paragraphs/code blocks
- The `repo` object has: id, name, ownerLogin, defaultBranch, createdAt, isFork, isPublic

### What didn't work
- `data-testid` elements are sparse (only 10 unique values) — not useful as primary selectors
- `relative-time` elements rendered empty (no JS execution in jsdom)
- `[itemprop="programmingLanguage"]` selector worked but produced duplicate text

### What I learned
- GitHub's architecture: server-rendered chrome + JSON payload for the React file viewer. The JSON payload is the single source of truth for file tree, README, and metadata.
- Sidebar social stats format varies by repo size: small repos show "25 stars", large repos show "81k stars". The `aria-label` on `#repo-stars-counter-star` always has the exact number ("80976 users starred this repository").
- The `overview` key in the JSON contains `commitCount` and `overviewFiles` — the README is served as pre-rendered HTML, not markdown.

### What was tricky to build
- Language extraction: the `.BorderGrid-row` text for Languages includes the "Languages" heading itself, producing "Languages Swift 69.1% C 30.9%". Had to strip the heading before regex matching.
- Star count for popular repos: "81k" doesn't match `(\d+)\s*stars`. Needed to parse `aria-label` for exact counts, with fallback to k/m suffix parsing.

### What warrants a second pair of eyes
- N/A (exploration only)

### What should be done in the future
- Build the pipeline (Step 16)

### Code review instructions
- Run any: `node 25-github-explore-structure.js` through `node 28-github-explore-repo-meta.js`

### Technical details
```
GitHub repo page data sources:
  1. react-app > script[type="application/json"] (137KB)
     └─ payload.codeViewRepoRoute
         ├─ .tree.items[] — file tree (name, path, contentType)
         ├─ .refInfo — branch name, OID
         └─ .overview
             ├─ .commitCount — "5"
             └─ .overviewFiles[0].richText — README as HTML string
     └─ payload.codeViewLayoutRoute.repo — metadata
         ├─ name, ownerLogin, defaultBranch, createdAt
         └─ isFork, public, private, isOrgOwned

  2. DOM sidebar (.BorderGrid-row)
     ├─ About — description <p>, stars/watchers/forks via <a class="Link--muted">
     ├─ Releases — text
     ├─ Languages — "Swift 69.1% C 30.9%"
     └─ #repo-stars-counter-star aria-label — exact star count
```

## Step 16: GitHub extraction pipeline and star count fix (`29-33`)

Built the full pipeline: fetch, extract (from both JSON payload and DOM sidebar), format as markdown. Tested on alexobenauer/Wonder (small repo) and anthropics/claude-code (popular repo with 81k stars). The star count extraction initially failed for popular repos because of "81k" formatting — fixed by using `aria-label` for exact counts with k/m suffix fallback.

### Prompt Context

**User prompt (verbatim):** (see Step 15)

**Assistant interpretation:** Build a reusable GitHub repo → markdown pipeline.

**Inferred user intent:** A script that works on any public GitHub repo.

### What I did
- `29-github-fetch.js` — Fetches repo page with User-Agent header (GitHub blocks requests without one)
- `30-github-extract.js` — Dual-source extraction:
  - JSON payload: `codeViewLayoutRoute.repo` for metadata, `codeViewRepoRoute.tree` for file tree, `overview.overviewFiles[0].richText` for README HTML, `overview.commitCount`
  - DOM sidebar: `.BorderGrid-row` for description, stars/watchers/forks, languages, releases
  - Star count: prefer `#repo-stars-counter-star` aria-label (exact), fall back to `<a class="Link--muted">` text with k/m suffix parsing
  - README: parse the HTML string with jsdom, extract headings/paragraphs/code blocks/links
  - Fallback: if no JSON payload, extract README from DOM `#readme article`
- `31-github-to-markdown.js` — Formats as markdown:
  - Header: owner/name, description blockquote
  - Badge line: stars, watching, forks, commits, branch, created date
  - Languages with bold names and percentages
  - File tree in code block with emoji icons
  - README: table of contents from headings, first 5 paragraphs as summary, external links
- `32-github-run.js` — CLI runner with optional URL argument: `node 32-github-run.js [repo-url]`
- `33-github-debug-stars.js` — Debug script that investigated the star count display discrepancy

### Why
- GitHub is the fourth site type (after HN news feed, NYT news, WonderOS project page). Tests the approach against a complex app with JSON data islands.

### What worked
- Both repos extract correctly: Wonder (25 stars, 7 files, 23 readme headings) and claude-code (80977 stars, 16 files, 8 readme headings)
- The JSON payload approach is vastly more reliable than DOM scraping for the file tree and README
- Star count from `aria-label` gives exact numbers even for repos with 81k+ stars
- The CLI accepts any GitHub repo URL as an argument

### What didn't work
- First version: languages regex matched "Languages Swift 69.1%" (heading text included). Fixed by targeting the second `.BorderGrid-cell` and stripping the heading.
- First version: star count was 0 for claude-code because "81k" doesn't match `parseInt`. Fixed by using `aria-label` with exact number, plus `parseCount()` helper for k/m suffixes.

### What I learned
- GitHub's `aria-label` attributes are the most reliable source for exact social counts
- The JSON payload approach means we're not really "scraping the DOM" for the core content — we're extracting structured data from an embedded API response. This is more robust than DOM selectors but could break if GitHub changes their payload format.
- For README rendering, showing a table of contents + first 5 paragraphs is a good balance between completeness and readability

### What was tricky to build
- The `parseCount` function for "81k", "6.7k", "1.2m" formats. Edge case: what about "1,234" (comma-separated)? Added `.replace(/,/g, '')` to handle it.
- Knowing which data to extract from JSON vs DOM: file tree and README from JSON (more structured), social stats from DOM sidebar (not in JSON), description from DOM (not in JSON for all repos).

### What warrants a second pair of eyes
- The JSON payload structure is undocumented and could change. The path `payload.codeViewRepoRoute.overview.overviewFiles[0].richText` is deep and any restructuring would break extraction.
- Star count extraction has 3 layers of fallback: aria-label → Link--muted text → 0. The middle layer's `parseCount` may not handle all locales.

### What should be done in the future
- Add support for browsing subdirectories (currently only shows root tree)
- Add contributor count extraction (currently shows "error loading" in sidebar)
- Consider using the GitHub API (`gh api`) instead of scraping for more reliable data

### Code review instructions
- Start with `32-github-run.js` → `30-github-extract.js`
- Run: `node 32-github-run.js` (default: Wonder) or `node 32-github-run.js https://github.com/anthropics/claude-code`
- Debug: `node 33-github-debug-stars.js https://github.com/anthropics/claude-code`

### Technical details
```js
// Star count extraction (3-layer fallback)
// 1. Exact from aria-label
const starEl = document.querySelector('#repo-stars-counter-star');
const starLabel = starEl?.getAttribute('aria-label') || '';
result.stars = parseInt(starLabel.match(/(\d+)/)?.[1]) || 0;

// 2. Fallback: parse "81k" / "6.7k" / "1.2m" from sidebar links
const parseCount = (text) => {
  const m = text.match(/([\d,.]+)\s*([kKmM])?/);
  let n = parseFloat(m[1].replace(/,/g, ''));
  if (m[2]?.toLowerCase() === 'k') n *= 1000;
  if (m[2]?.toLowerCase() === 'm') n *= 1000000;
  return Math.round(n);
};

// JSON payload extraction
const data = JSON.parse(reactApp.querySelector('script').textContent);
const tree = data.payload.codeViewRepoRoute.tree.items;
const readme = data.payload.codeViewRepoRoute.overview.overviewFiles[0].richText;
const repo = data.payload.codeViewLayoutRoute.repo;
```
