// scripts/01-agent-sdk-hello.mjs — Minimal Agent SDK test: can we import and call query()?
import { query } from "@anthropic-ai/claude-agent-sdk";

async function main() {
  console.log("Starting Agent SDK test...");

  for await (const message of query({
    prompt: "Say hello in one sentence. Nothing more.",
    options: {
      allowedTools: [],
      maxTurns: 1,
    },
  })) {
    if ("result" in message) {
      console.log("Result:", message.result);
    } else {
      console.log("Message type:", message.type, message.subtype || "");
    }
  }
}

main().catch(console.error);
