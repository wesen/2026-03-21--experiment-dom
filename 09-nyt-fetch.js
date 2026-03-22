// 09-nyt-fetch.js — Fetch NYTimes HTML and parse into a jsdom Document
const { JSDOM } = require('jsdom');

async function fetchNYT() {
  const res = await fetch('https://www.nytimes.com/');
  const html = await res.text();
  const { document } = new JSDOM(html).window;
  return document;
}

module.exports = { fetchNYT };
