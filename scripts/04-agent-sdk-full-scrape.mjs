// scripts/04-agent-sdk-full-scrape.mjs — Full autonomous scrape: agent explores DOM, extracts data, produces markdown
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { writeFileSync } from "fs";

const fetchPage = tool(
  "fetch_page",
  "Fetch a web page and return its HTML content. Returns up to 80KB of HTML.",
  { url: z.string().describe("The URL to fetch") },
  async ({ url }) => {
    console.error(`[fetch_page] ${url}`);
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; dom-scraper/1.0)" }
    });
    const html = await res.text();
    console.error(`[fetch_page] ${html.length} chars, status ${res.status}`);
    return { content: [{ type: "text", text: html.slice(0, 80000) }] };
  }
);

const evalDom = tool(
  "eval_dom",
  `Parse HTML with jsdom and evaluate a JavaScript expression against the document.
Standard DOM APIs: querySelector, querySelectorAll, textContent, getAttribute, closest, nextElementSibling, children, className, etc.
The variable 'document' is available. You can use spread, .map(), .filter(), JSON.stringify() etc.
The expression MUST return a value (string, number, array, or object). If you need to run multiple statements, wrap in an IIFE: (() => { ... return result; })()`,
  {
    html: z.string().describe("HTML string to parse with jsdom"),
    expression: z.string().describe("JS expression to evaluate. 'document' is in scope."),
  },
  async ({ html, expression }) => {
    console.error(`[eval_dom] ${expression.slice(0, 120)}...`);
    const { JSDOM } = await import("jsdom");
    const { document } = new JSDOM(html).window;
    try {
      const fn = new Function("document", `"use strict"; return (${expression})`);
      const result = fn(document);
      let output = (result === null || result === undefined)
        ? String(result)
        : (typeof result === "object" ? JSON.stringify(result, null, 2) : String(result));
      // Truncate large results
      if (output.length > 30000) {
        output = output.slice(0, 30000) + "\n... (truncated)";
      }
      console.error(`[eval_dom] OK (${output.length} chars)`);
      return { content: [{ type: "text", text: output }] };
    } catch (err) {
      console.error(`[eval_dom] ERROR: ${err.message}`);
      return { content: [{ type: "text", text: `Error: ${err.message}` }] };
    }
  }
);

const saveFile = tool(
  "save_file",
  "Save text content to a file in the output directory.",
  {
    filename: z.string().describe("Filename to save (will be placed in current directory)"),
    content: z.string().describe("Content to write to the file"),
  },
  async ({ filename, content }) => {
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    writeFileSync(safeName, content);
    console.error(`[save_file] Wrote ${content.length} chars to ${safeName}`);
    return { content: [{ type: "text", text: `Saved ${content.length} chars to ${safeName}` }] };
  }
);

const server = createSdkMcpServer({
  name: "dom-scraper",
  tools: [fetchPage, evalDom, saveFile],
});

const URL_TO_SCRAPE = process.argv[2] || "https://news.ycombinator.com/";

async function main() {
  console.log(`Autonomous scrape of: ${URL_TO_SCRAPE}\n`);

  const systemPrompt = `You are a web scraping expert. Your job is to:

1. Fetch the given URL using fetch_page
2. Explore the DOM structure using eval_dom with increasingly specific queries to understand how content is organized
3. Extract all the meaningful content into structured data using eval_dom
4. Format the extracted data as clean, readable Markdown
5. Save the markdown to a file using save_file

Work methodically:
- First, get an overview (tag counts, key selectors, headings)
- Then zoom into the content areas (find the repeating patterns)
- Then extract the full dataset
- Finally, format as markdown and save

Use eval_dom expressions like:
- document.querySelectorAll('article').length (count elements)
- [...document.querySelectorAll('h2')].map(h => h.textContent.trim()) (extract text)
- JSON.stringify patterns for structured data

Always save the final markdown output using save_file.`;

  for await (const message of query({
    prompt: `Scrape this URL and produce a clean markdown summary: ${URL_TO_SCRAPE}`,
    options: {
      mcpServers: { "dom-scraper": server },
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 25,
      systemPrompt,
      model: "claude-sonnet-4-6",
    },
  })) {
    if ("result" in message) {
      console.log("\n=== Agent Result ===");
      console.log(message.result);
    }
  }
}

main().catch(console.error);
