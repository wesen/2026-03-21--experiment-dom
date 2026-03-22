// 29-github-fetch.js — Fetch a GitHub repo page and parse into a jsdom Document
const { JSDOM } = require('jsdom');

async function fetchGitHub(repoUrl) {
  const res = await fetch(repoUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; dom-scraper/1.0)' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${repoUrl}`);
  const html = await res.text();
  const { document } = new JSDOM(html).window;
  return document;
}

module.exports = { fetchGitHub };
