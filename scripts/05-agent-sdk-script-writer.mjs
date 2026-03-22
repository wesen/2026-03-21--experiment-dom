// scripts/05-agent-sdk-script-writer.mjs — Agent that WRITES reusable JS extraction scripts
// The agent explores a site's DOM, then generates numbered .js files that form a
// reusable pipeline: fetch → extract → markdown → run
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import path from "path";

const OUTPUT_DIR = process.argv[3] || ".";
const URL_TO_SCRAPE = process.argv[2] || "https://news.ycombinator.com/";

// Tool: fetch a page (for the agent to explore DOM structure)
const fetchPage = tool(
  "fetch_page",
  "Fetch a web page and return its raw HTML. Use this to explore a site's DOM structure before writing extraction scripts.",
  { url: z.string().describe("URL to fetch") },
  async ({ url }) => {
    console.error(`[fetch_page] ${url}`);
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; dom-scraper/1.0)" }
    });
    const html = await res.text();
    console.error(`[fetch_page] ${html.length} chars`);
    return { content: [{ type: "text", text: html.slice(0, 80000) }] };
  }
);

// Tool: evaluate a JS DOM expression (for exploring structure)
const evalDom = tool(
  "eval_dom",
  `Parse HTML with jsdom and evaluate a JS expression against the document.
Use this to explore the DOM structure: count elements, inspect classes, trace parent chains.
'document' is available. Use standard DOM APIs.
Wrap multi-statement code in an IIFE: (() => { ...; return result; })()`,
  {
    html: z.string().describe("HTML to parse"),
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
      if (output.length > 30000) output = output.slice(0, 30000) + "\n... (truncated)";
      console.error(`[eval_dom] OK (${output.length} chars)`);
      return { content: [{ type: "text", text: output }] };
    } catch (err) {
      console.error(`[eval_dom] ERROR: ${err.message}`);
      return { content: [{ type: "text", text: `Error: ${err.message}` }] };
    }
  }
);

// Tool: write a JS file (the main output — reusable scripts)
const writeScript = tool(
  "write_script",
  `Write a JavaScript file to the output directory. Use this to create the reusable extraction scripts.
Follow this naming convention:
  XX-<site>-fetch.js     — fetches HTML and returns jsdom document
  XX-<site>-extract.js   — extracts data from document via DOM queries
  XX-<site>-to-markdown.js — converts data to markdown
  XX-<site>-run.js       — orchestrator that wires the pipeline
Where XX is a sequential number (starting from the next available).`,
  {
    filename: z.string().describe("Filename like '01-hn-fetch.js'"),
    content: z.string().describe("Full JS file content (CommonJS, require/module.exports)"),
  },
  async ({ filename, content }) => {
    const safeName = path.basename(filename);
    const fullPath = path.join(OUTPUT_DIR, safeName);
    writeFileSync(fullPath, content);
    console.error(`[write_script] ${fullPath} (${content.length} chars)`);
    return { content: [{ type: "text", text: `Written: ${fullPath}` }] };
  }
);

// Tool: run a JS file and return its output (for testing the generated scripts)
const runScript = tool(
  "run_script",
  "Execute a generated JS file with Node.js and return its stdout/stderr. Use this to test your generated scripts.",
  {
    filename: z.string().describe("Filename to run, e.g. '01-hn-run.js'"),
  },
  async ({ filename }) => {
    const safeName = path.basename(filename);
    const fullPath = path.join(OUTPUT_DIR, safeName);
    if (!existsSync(fullPath)) {
      return { content: [{ type: "text", text: `Error: ${fullPath} does not exist` }] };
    }
    console.error(`[run_script] Running ${fullPath}...`);
    try {
      const output = execSync(`node "${fullPath}"`, {
        timeout: 30000,
        maxBuffer: 1024 * 1024,
        cwd: OUTPUT_DIR,
      }).toString();
      const truncated = output.length > 20000 ? output.slice(0, 20000) + "\n...(truncated)" : output;
      console.error(`[run_script] OK (${output.length} chars output)`);
      return { content: [{ type: "text", text: truncated }] };
    } catch (err) {
      const stderr = err.stderr?.toString() || err.message;
      console.error(`[run_script] FAILED: ${stderr.slice(0, 200)}`);
      return { content: [{ type: "text", text: `Exit code ${err.status}\nstdout: ${err.stdout?.toString().slice(0, 5000)}\nstderr: ${stderr.slice(0, 5000)}` }] };
    }
  }
);

// Tool: read a file (to inspect previously written scripts)
const readFile = tool(
  "read_file",
  "Read the contents of a file. Use this to review scripts you've already written.",
  { filename: z.string().describe("Filename to read") },
  async ({ filename }) => {
    const safeName = path.basename(filename);
    const fullPath = path.join(OUTPUT_DIR, safeName);
    if (!existsSync(fullPath)) {
      return { content: [{ type: "text", text: `Error: ${fullPath} does not exist` }] };
    }
    const content = readFileSync(fullPath, "utf-8");
    return { content: [{ type: "text", text: content }] };
  }
);

// Tool: list files in the output directory
const listFiles = tool(
  "list_files",
  "List all JS files in the output directory. Use this to see what scripts already exist and determine the next number prefix.",
  {},
  async () => {
    const { readdirSync } = await import("fs");
    const files = readdirSync(OUTPUT_DIR).filter(f => f.endsWith(".js")).sort();
    return { content: [{ type: "text", text: files.join("\n") || "(no .js files)" }] };
  }
);

const server = createSdkMcpServer({
  name: "script-writer",
  tools: [fetchPage, evalDom, writeScript, runScript, readFile, listFiles],
});

async function main() {
  console.log(`Agent Script Writer`);
  console.log(`URL: ${URL_TO_SCRAPE}`);
  console.log(`Output dir: ${OUTPUT_DIR}\n`);

  const systemPrompt = `You are an expert web scraper and JavaScript developer. Your job is to CREATE REUSABLE NODE.JS SCRIPTS that extract content from web pages and convert it to Markdown.

## Your workflow:

1. **Explore** — Use fetch_page + eval_dom to understand the site's DOM structure
2. **Design** — Figure out the extraction strategy (which selectors, what data model)
3. **Write scripts** — Use write_script to create a set of modular JS files:
   - A fetch module (fetches HTML, parses with jsdom, returns document)
   - An extract module (runs DOM queries, returns structured data objects)
   - A markdown module (transforms data into formatted markdown)
   - A run script (orchestrates the pipeline, writes output file)
4. **Test** — Use run_script to execute your scripts and verify they work
5. **Fix** — If tests fail, read_file to inspect, then write_script to fix

## Script conventions:
- Use CommonJS (require/module.exports)
- jsdom is already installed (require('jsdom'))
- Each script should have a header comment explaining what it does
- Extract scripts should document the DOM selectors used
- Name files with XX- prefix (use list_files to find the next number)
- The run script should write a .md file AND print to stdout

## Quality standards:
- Scripts must actually run and produce correct output
- Handle edge cases (missing elements, empty text)
- Dedup where needed
- The markdown output should be clean and readable

Start by exploring the DOM, then write the scripts. Always test them.`;

  for await (const message of query({
    prompt: `Create a reusable Node.js extraction pipeline for: ${URL_TO_SCRAPE}

The scripts should be runnable with just "node XX-run.js" and produce a clean markdown file.
Look at the existing scripts in the output directory with list_files to see the naming convention and determine the next number prefix to use.`,
    options: {
      mcpServers: { "script-writer": server },
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 30,
      systemPrompt,
      model: "claude-sonnet-4-6",
    },
  })) {
    if ("result" in message) {
      console.log("\n=== Agent Complete ===");
      console.log(message.result);
    }
  }
}

main().catch(console.error);
