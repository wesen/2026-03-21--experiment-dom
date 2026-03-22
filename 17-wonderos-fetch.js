// 17-wonderos-fetch.js — Fetch WonderOS HTML and parse into a jsdom Document
const { JSDOM } = require('jsdom');

async function fetchWonderOS() {
  const res = await fetch('https://wonderos.org/');
  const html = await res.text();
  const { document } = new JSDOM(html).window;
  return document;
}

module.exports = { fetchWonderOS };
