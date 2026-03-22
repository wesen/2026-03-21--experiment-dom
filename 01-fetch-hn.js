// 01-fetch-hn.js — Fetch HN HTML and parse it into a jsdom Document
const { JSDOM } = require('jsdom');

async function fetchHN() {
  const res = await fetch('https://news.ycombinator.com/');
  const html = await res.text();
  const { document } = new JSDOM(html).window;
  return document;
}

module.exports = { fetchHN };
