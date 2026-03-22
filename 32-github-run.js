// 32-github-run.js — Main script: fetch GitHub repo, extract, convert, output
// Usage: node 32-github-run.js [repo-url]
//   Default: https://github.com/alexobenauer/Wonder

const { fetchGitHub } = require('./29-github-fetch');
const { extractRepo } = require('./30-github-extract');
const { toMarkdown } = require('./31-github-to-markdown');
const fs = require('fs');

async function main() {
  const repoUrl = process.argv[2] || 'https://github.com/alexobenauer/Wonder';
  const slug = repoUrl.replace('https://github.com/', '').replace(/\//g, '-');

  console.error(`Fetching ${repoUrl}...`);
  const document = await fetchGitHub(repoUrl);

  console.error('Extracting repo data...');
  const repo = extractRepo(document, repoUrl);
  console.error(`  ${repo.owner}/${repo.name}: ${repo.tree.length} files, ${repo.readme.headings.length} readme headings, ${repo.stars} stars`);

  const md = toMarkdown(repo);
  const outFile = `github-${slug}.md`;

  fs.writeFileSync(outFile, md);
  console.error(`Written to ${outFile}`);

  console.log(md);
}

main().catch(err => { console.error(err); process.exit(1); });
