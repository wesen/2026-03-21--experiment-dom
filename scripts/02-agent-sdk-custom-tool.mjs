// scripts/02-agent-sdk-custom-tool.mjs — Test in-process MCP tools with the Agent SDK
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// Define a custom tool that fetches a URL and returns the HTML
const fetchPage = tool(
  "fetch_page",
  "Fetch a web page and return its HTML content. Use this to download web pages for analysis.",
  { url: z.string().describe("The URL to fetch") },
  async ({ url }) => {
    console.error(`[tool] Fetching ${url}...`);
    const res = await fetch(url);
    const html = await res.text();
    console.error(`[tool] Got ${html.length} chars`);
    // Truncate to avoid overwhelming the context
    const truncated = html.slice(0, 50000);
    return {
      content: [{ type: "text", text: truncated }],
    };
  }
);

// Define a tool that runs a JS expression against HTML using jsdom
const evalDom = tool(
  "eval_dom",
  "Parse HTML with jsdom and evaluate a JavaScript expression against the DOM document. The expression should use standard DOM APIs (querySelector, querySelectorAll, textContent, getAttribute, etc). The variable 'document' is available. Return the result as a string.",
  {
    html: z.string().describe("The HTML string to parse"),
    expression: z.string().describe("A JavaScript expression to evaluate against the document. The variable 'document' is available."),
  },
  async ({ html, expression }) => {
    console.error(`[tool] Evaluating expression (${expression.length} chars) against HTML (${html.length} chars)...`);
    const { JSDOM } = await import("jsdom");
    const { document } = new JSDOM(html).window;

    try {
      // Use Function constructor to eval the expression with document in scope
      const fn = new Function("document", `return (${expression})`);
      const result = fn(document);

      // Serialize the result
      let output;
      if (result === null || result === undefined) {
        output = String(result);
      } else if (typeof result === "object") {
        output = JSON.stringify(result, null, 2);
      } else {
        output = String(result);
      }

      console.error(`[tool] Result: ${output.slice(0, 200)}...`);
      return { content: [{ type: "text", text: output }] };
    } catch (err) {
      const errMsg = `Error evaluating expression: ${err.message}`;
      console.error(`[tool] ${errMsg}`);
      return { content: [{ type: "text", text: errMsg }] };
    }
  }
);

const server = createSdkMcpServer({
  name: "dom-scraper",
  tools: [fetchPage, evalDom],
});

async function main() {
  console.log("Testing custom MCP tools with Agent SDK...\n");

  for await (const message of query({
    prompt: `Fetch https://news.ycombinator.com/ and then use eval_dom to extract just the number of stories on the page. Use document.querySelectorAll('tr.athing').length`,
    options: {
      mcpServers: { "dom-scraper": server },
      maxTurns: 10,
    },
  })) {
    if ("result" in message) {
      console.log("\n=== Agent Result ===");
      console.log(message.result);
    } else if (message.type === "assistant") {
      // Show assistant messages as they come
    }
  }
}

main().catch(console.error);
