// server/agent-runner.mjs — Runs the script-writer agent with progress streaming
// Returns an EventEmitter that emits 'progress', 'tool', 'result', 'error' events.

import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import path from "path";
import { EventEmitter } from "events";

/**
 * Run the script-writer agent for a URL, emitting progress events.
 * @param {string} url - URL to scrape
 * @param {string} outputDir - Directory for generated scripts
 * @returns {EventEmitter} emits: 'progress', 'tool', 'scripts_written', 'markdown', 'result', 'error'
 */
export function runAgent(url, outputDir) {
  const emitter = new EventEmitter();

  mkdirSync(outputDir, { recursive: true });

  // --- Define MCP tools (same as 05-agent-sdk-script-writer.mjs) ---
  const fetchPage = tool(
    "fetch_page",
    "Fetch a web page and return its raw HTML. Returns up to 80KB.",
    { url: z.string().describe("URL to fetch") },
    async ({ url: fetchUrl }) => {
      emitter.emit("tool", { name: "fetch_page", input: fetchUrl });
      const res = await fetch(fetchUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; md-browser/1.0)" },
      });
      const html = await res.text();
      emitter.emit("progress", `Fetched ${fetchUrl} (${html.length} chars, status ${res.status})`);
      return { content: [{ type: "text", text: html.slice(0, 80000) }] };
    }
  );

  const evalDom = tool(
    "eval_dom",
    `Parse HTML with jsdom and evaluate a JS expression against the document.
'document' is available. Use standard DOM APIs. Wrap multi-statement code in an IIFE.`,
    {
      html: z.string().describe("HTML to parse"),
      expression: z.string().describe("JS expression. 'document' is in scope."),
    },
    async ({ html, expression }) => {
      emitter.emit("tool", { name: "eval_dom", input: expression.slice(0, 100) + "..." });
      const { JSDOM } = await import("jsdom");
      const { document } = new JSDOM(html).window;
      try {
        const fn = new Function("document", `"use strict"; return (${expression})`);
        const result = fn(document);
        let output =
          result === null || result === undefined
            ? String(result)
            : typeof result === "object"
              ? JSON.stringify(result, null, 2)
              : String(result);
        if (output.length > 30000) output = output.slice(0, 30000) + "\n...(truncated)";
        emitter.emit("progress", `eval_dom returned ${output.length} chars`);
        return { content: [{ type: "text", text: output }] };
      } catch (err) {
        emitter.emit("progress", `eval_dom error: ${err.message}`);
        return { content: [{ type: "text", text: `Error: ${err.message}` }] };
      }
    }
  );

  const writeScript = tool(
    "write_script",
    `Write a JavaScript file. Follow the naming convention: XX-<site>-fetch.js, XX-<site>-extract.js, XX-<site>-to-markdown.js, XX-<site>-run.js`,
    {
      filename: z.string().describe("Filename like '01-site-fetch.js'"),
      content: z.string().describe("Full JS file content (CommonJS)"),
    },
    async ({ filename, content }) => {
      const safeName = path.basename(filename);
      const fullPath = path.join(outputDir, safeName);
      writeFileSync(fullPath, content);
      emitter.emit("tool", { name: "write_script", input: safeName });
      emitter.emit("progress", `Wrote ${safeName} (${content.length} chars)`);
      emitter.emit("scripts_written", { filename: safeName, size: content.length });
      return { content: [{ type: "text", text: `Written: ${fullPath}` }] };
    }
  );

  const runScript = tool(
    "run_script",
    "Execute a generated JS file with Node.js and return output. Use to test scripts.",
    { filename: z.string().describe("Filename to run") },
    async ({ filename }) => {
      const safeName = path.basename(filename);
      const fullPath = path.join(outputDir, safeName);
      if (!existsSync(fullPath)) {
        return { content: [{ type: "text", text: `Error: ${fullPath} does not exist` }] };
      }
      emitter.emit("tool", { name: "run_script", input: safeName });
      emitter.emit("progress", `Running ${safeName}...`);
      try {
        const output = execSync(`node "${fullPath}"`, {
          timeout: 30000,
          maxBuffer: 5 * 1024 * 1024,
          cwd: outputDir,
        }).toString();
        const truncated = output.length > 20000 ? output.slice(0, 20000) + "\n...(truncated)" : output;
        emitter.emit("progress", `${safeName} succeeded (${output.length} chars output)`);
        // Emit the markdown if this is a run script
        if (safeName.includes("run")) {
          emitter.emit("markdown", output);
        }
        return { content: [{ type: "text", text: truncated }] };
      } catch (err) {
        const stderr = err.stderr?.toString() || err.message;
        emitter.emit("progress", `${safeName} failed: ${stderr.slice(0, 200)}`);
        return {
          content: [
            {
              type: "text",
              text: `Exit code ${err.status}\nstdout: ${err.stdout?.toString().slice(0, 5000)}\nstderr: ${stderr.slice(0, 5000)}`,
            },
          ],
        };
      }
    }
  );

  const readFileTool = tool(
    "read_file",
    "Read a file you previously wrote.",
    { filename: z.string() },
    async ({ filename }) => {
      const safeName = path.basename(filename);
      const fullPath = path.join(outputDir, safeName);
      if (!existsSync(fullPath)) {
        return { content: [{ type: "text", text: `Error: not found` }] };
      }
      return { content: [{ type: "text", text: readFileSync(fullPath, "utf-8") }] };
    }
  );

  const listFiles = tool(
    "list_files",
    "List JS files in the output directory.",
    {},
    async () => {
      const files = readdirSync(outputDir).filter(f => f.endsWith(".js")).sort();
      return { content: [{ type: "text", text: files.join("\n") || "(no .js files)" }] };
    }
  );

  const server = createSdkMcpServer({
    name: "script-writer",
    tools: [fetchPage, evalDom, writeScript, runScript, readFileTool, listFiles],
  });

  const SYSTEM_PROMPT = `You are an expert web scraper and JavaScript developer. Your job is to CREATE REUSABLE NODE.JS SCRIPTS that extract content from web pages and convert it to Markdown.

## Your workflow:
1. **Explore** — Use fetch_page + eval_dom to understand the site's DOM structure
2. **Design** — Figure out the extraction strategy (which selectors, what data model)
3. **Write scripts** — Use write_script to create modular JS files:
   - A fetch module (fetches HTML, parses with jsdom, returns document)
   - An extract module (runs DOM queries, returns structured data objects)
   - A markdown module (transforms data into formatted markdown)
   - A run script (orchestrates the pipeline, writes output file)
4. **Test** — Use run_script to execute and verify
5. **Fix** — If tests fail, read_file to inspect, then write_script to fix

## Script conventions:
- CommonJS (require/module.exports)
- jsdom is available (require('jsdom'))
- Header comment documenting DOM selectors
- XX- prefix naming (use list_files for next number)
- The run script should write a .md file AND print to stdout

## Quality:
- Must run and produce correct output
- Handle edge cases
- Clean, readable markdown output`;

  // Run the agent asynchronously
  (async () => {
    try {
      emitter.emit("progress", `Starting agent for ${url}...`);

      for await (const message of query({
        prompt: `Create a reusable Node.js extraction pipeline for: ${url}\n\nThe scripts should be runnable with "node XX-run.js" and produce a clean markdown file. Use list_files to check existing scripts and pick the next number prefix.`,
        options: {
          mcpServers: { "script-writer": server },
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          maxTurns: 30,
          systemPrompt: SYSTEM_PROMPT,
          model: "claude-sonnet-4-6",
        },
      })) {
        if ("result" in message) {
          emitter.emit("result", message.result);
        }
      }
    } catch (err) {
      emitter.emit("error", err.message);
    }
  })();

  return emitter;
}
