// scripts/03-agent-sdk-bypass-perms.mjs — Test custom tools with permissions bypassed
import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const fetchPage = tool(
  "fetch_page",
  "Fetch a web page and return its HTML content.",
  { url: z.string().describe("The URL to fetch") },
  async ({ url }) => {
    console.error(`[fetch_page] Fetching ${url}...`);
    const res = await fetch(url);
    const html = await res.text();
    console.error(`[fetch_page] Got ${html.length} chars`);
    return { content: [{ type: "text", text: html.slice(0, 50000) }] };
  }
);

const evalDom = tool(
  "eval_dom",
  "Parse HTML with jsdom and evaluate a JavaScript expression against the document object. Standard DOM APIs are available (querySelector, querySelectorAll, textContent, getAttribute, etc). Return result as a string.",
  {
    html: z.string().describe("HTML string to parse"),
    expression: z.string().describe("JS expression to evaluate. 'document' is available."),
  },
  async ({ html, expression }) => {
    console.error(`[eval_dom] Evaluating: ${expression.slice(0, 100)}...`);
    const { JSDOM } = await import("jsdom");
    const { document } = new JSDOM(html).window;
    try {
      const fn = new Function("document", `return (${expression})`);
      const result = fn(document);
      let output = (result === null || result === undefined)
        ? String(result)
        : (typeof result === "object" ? JSON.stringify(result, null, 2) : String(result));
      console.error(`[eval_dom] Result (${output.length} chars): ${output.slice(0, 200)}`);
      return { content: [{ type: "text", text: output }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }] };
    }
  }
);

const server = createSdkMcpServer({
  name: "dom-scraper",
  tools: [fetchPage, evalDom],
});

async function main() {
  console.log("Testing with bypassPermissions...\n");

  for await (const message of query({
    prompt: `Fetch https://news.ycombinator.com/ using the fetch_page tool. Then use eval_dom to count the number of stories: document.querySelectorAll('tr.athing').length. Report the number.`,
    options: {
      mcpServers: { "dom-scraper": server },
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 10,
    },
  })) {
    if ("result" in message) {
      console.log("\n=== Result ===");
      console.log(message.result);
    }
  }
}

main().catch(console.error);
