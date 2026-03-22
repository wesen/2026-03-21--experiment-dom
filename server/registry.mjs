// server/registry.mjs — Registry of existing extraction pipelines
// Scans the project for generated-* directories and the root numbered scripts,
// maps domains to their run scripts.

import { readdirSync, existsSync } from "fs";
import { join, basename } from "path";
import { execSync } from "child_process";

const PROJECT_ROOT = join(import.meta.dirname, "..");

// Known pipelines from the manually-built scripts (root directory)
const MANUAL_PIPELINES = {
  "news.ycombinator.com": { dir: PROJECT_ROOT, runScript: "04-run.js", label: "Hacker News" },
  "www.nytimes.com": { dir: PROJECT_ROOT, runScript: "12-nyt-run.js", label: "NYTimes" },
  "nytimes.com": { dir: PROJECT_ROOT, runScript: "12-nyt-run.js", label: "NYTimes" },
  "wonderos.org": { dir: PROJECT_ROOT, runScript: "24-wonderos-run-all.js", label: "WonderOS" },
  "www.wonderos.org": { dir: PROJECT_ROOT, runScript: "24-wonderos-run-all.js", label: "WonderOS" },
};

/**
 * Scan generated-* directories for extraction pipelines.
 * A valid pipeline has a *-run.js file.
 */
function scanGeneratedDirs() {
  const pipelines = { ...MANUAL_PIPELINES };
  const entries = readdirSync(PROJECT_ROOT);

  for (const entry of entries) {
    if (!entry.startsWith("generated")) continue;
    const dir = join(PROJECT_ROOT, entry);
    const files = readdirSync(dir).filter(f => f.endsWith("-run.js"));
    if (files.length === 0) continue;

    const runScript = files[0];
    // Extract domain hint from directory name: "generated-slashdot" → "slashdot.org"
    const hint = entry.replace("generated-", "").replace("generated", "");
    if (hint) {
      // Try common TLDs
      for (const tld of ["org", "com", "net", "io", "rs", "dev"]) {
        pipelines[`${hint}.${tld}`] = { dir, runScript, label: hint };
        pipelines[`www.${hint}.${tld}`] = { dir, runScript, label: hint };
      }
    }
    // Also register by the run script name pattern
    const match = runScript.match(/\d+-(\w+)-run\.js/);
    if (match) {
      const site = match[1];
      for (const tld of ["org", "com", "net", "io", "rs", "dev"]) {
        pipelines[`${site}.${tld}`] = { dir, runScript, label: site };
        pipelines[`www.${site}.${tld}`] = { dir, runScript, label: site };
      }
    }
  }

  return pipelines;
}

/**
 * Look up a pipeline for a given URL.
 * @param {string} url
 * @returns {{ dir: string, runScript: string, label: string } | null}
 */
export function findPipeline(url) {
  const pipelines = scanGeneratedDirs();
  try {
    const hostname = new URL(url).hostname;
    return pipelines[hostname] || null;
  } catch {
    return null;
  }
}

/**
 * Run an existing pipeline and return its markdown output.
 * @param {{ dir: string, runScript: string }} pipeline
 * @returns {string} markdown content
 */
export function runPipeline(pipeline) {
  const result = execSync(`node "${pipeline.runScript}"`, {
    cwd: pipeline.dir,
    timeout: 30000,
    maxBuffer: 5 * 1024 * 1024,
  });
  return result.toString();
}

/**
 * Get the directory for a new generated pipeline.
 */
export function getGeneratedDir(url) {
  const hostname = new URL(url).hostname.replace(/^www\./, "");
  const slug = hostname.replace(/\./g, "-");
  const dir = join(PROJECT_ROOT, `generated-${slug}`);
  return dir;
}
