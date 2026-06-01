import { resolve } from "node:path";
import {
  ClientContextSchema,
  buildRunPath,
  writeText,
  readText,
  fileExists,
  createLogger,
  envFlag,
  moduleDir,
  type AuditFindings,
  type ClientContext,
} from "@rynk/core";
import { getClientByDomain } from "@rynk/clients";
import { runDataCollectionAgent } from "./agents/data-collection-agent.js";
import { runOffsiteResearchAgent } from "./agents/offsite-research-agent.js";
import { runSynthesiserAgent } from "./agents/synthesiser-agent.js";
import { saveAuditFindings, type SaveAuditResult } from "./utils/output-writer.js";
import { preComputeInventory } from "./utils/crawl-precompute.js";

export { runDataCollectionAgent } from "./agents/data-collection-agent.js";
export { runOffsiteResearchAgent } from "./agents/offsite-research-agent.js";
export { runSynthesiserAgent } from "./agents/synthesiser-agent.js";
export { saveAuditFindings } from "./utils/output-writer.js";
export {
  makeCrawl4AIClient as makeFirecrawlClient,
  scrapeUrlTool,
} from "./tools/crawl4ai.js";

const log = createLogger("layer1");

export interface RunLayer1Options {
  client: ClientContext;
  rootDir: string;
  /** Run data-collection and offsite-research in parallel. Default: true. */
  parallel?: boolean;
}

export interface RunLayer1Result {
  findings: AuditFindings;
  paths: SaveAuditResult;
}

/**
 * Run the full Layer 1 pipeline:
 *   1. Sub-agent 1 (Data Collection) + Sub-agent 2 (Offsite Research) — parallel
 *   2. Sub-agent 3 (Synthesiser) — sequential, consumes both outputs
 *
 * The two upstream sub-agents have no dependencies on each other, so we run
 * them in parallel by default. Disable with parallel: false for easier
 * debugging.
 */
export async function runLayer1(opts: RunLayer1Options): Promise<RunLayer1Result> {
  // Validate the client context shape up-front — fail fast if onboarding data
  // is malformed.
  const client = ClientContextSchema.parse(opts.client);

  log.info("Layer 1 starting", { domain: client.domain, parallel: opts.parallel !== false });

  const t0 = Date.now();

  let dataCollectionRaw: string;
  let offsiteResearchRaw: string;

  // REUSE_RAW=true: load today's already-saved raw files and skip the agents.
  // Use this after a synthesiser crash to avoid re-crawling.
  const reuseRaw = envFlag("REUSE_RAW");
  const rawDcPath = buildRunPath(opts.rootDir, client.domain, "data-collection.raw.json");
  const rawOrPath = buildRunPath(opts.rootDir, client.domain, "offsite-research.raw.json");

  if (reuseRaw && fileExists(rawDcPath) && fileExists(rawOrPath)) {
    log.info("REUSE_RAW=true — loading existing raw sub-agent outputs", { rawDcPath, rawOrPath });
    dataCollectionRaw = readText(rawDcPath);
    offsiteResearchRaw = readText(rawOrPath);
  } else {
    if (reuseRaw) {
      log.warn("REUSE_RAW=true but raw files not found — running agents", { rawDcPath });
    }

    if (opts.parallel === false) {
      dataCollectionRaw = await runDataCollectionAgent(client);
      offsiteResearchRaw = await runOffsiteResearchAgent(client);
    } else {
      [dataCollectionRaw, offsiteResearchRaw] = await Promise.all([
        runDataCollectionAgent(client),
        runOffsiteResearchAgent(client),
      ]);
    }
  }

  log.info("upstream sub-agents complete", {
    elapsedSec: Math.round((Date.now() - t0) / 1000),
    dataCollectionChars: dataCollectionRaw.length,
    offsiteResearchChars: offsiteResearchRaw.length,
  });

  // Eagerly persist raw sub-agent outputs BEFORE running the synthesiser so
  // we can replay without re-crawling if the synthesiser crashes.
  if (!reuseRaw) {
    writeText(rawDcPath, dataCollectionRaw);
    writeText(rawOrPath, offsiteResearchRaw);
    log.info("raw sub-agent outputs saved", { rawDcPath, rawOrPath });
  }

  // Pre-compute the full URL inventory from crawl data so the synthesiser
  // doesn't have to emit it (saves ~10k output tokens, prevents truncation).
  const preComputed = preComputeInventory(dataCollectionRaw);
  log.info("pre-computed inventory", {
    sitemapUrls: preComputed.sitemapUrls.length,
    contentInventory: preComputed.contentInventory.length,
  });

  const findings = await runSynthesiserAgent({
    client,
    dataCollectionRaw,
    offsiteResearchRaw,
    preComputed,
  });

  const paths = saveAuditFindings(findings, {
    rootDir: opts.rootDir,
    dataCollectionRaw,
    offsiteResearchRaw,
  });

  log.info("Layer 1 complete", {
    elapsedSec: Math.round((Date.now() - t0) / 1000),
    ...paths,
  });

  return { findings, paths };
}

// ─── CLI entry ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const domainArg = process.argv[2];
  if (!domainArg) {
    process.stderr.write(
      "Usage: npm run start --workspace=@rynk/layer1-audit -- <domain>\n" +
        "Example: npm run start --workspace=@rynk/layer1-audit -- itechdata.ai\n",
    );
    process.exit(2);
  }

  const client = getClientByDomain(domainArg);
  const rootDir = resolve(moduleDir(import.meta.url), "../../../runs");

  if (envFlag("DRY_RUN")) {
    log.warn("DRY_RUN is set — agents will still hit APIs; this flag is reserved for future use");
  }

  const { paths } = await runLayer1({ client, rootDir });

  process.stdout.write(`\n✅ Audit complete.\n`);
  process.stdout.write(`  JSON (→ Layer 2): ${paths.jsonPath}\n`);
  process.stdout.write(`  Markdown:         ${paths.mdPath}\n`);
  if (paths.rawDataCollectionPath) {
    process.stdout.write(`  Raw (debug):      ${paths.rawDataCollectionPath}\n`);
    process.stdout.write(`                    ${paths.rawOffsiteResearchPath}\n`);
  }
}

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    log.error("Layer 1 failed", { error: (err as Error).message });
    process.stderr.write(`\n❌ ${(err as Error).message}\n`);
    if (process.env.DEBUG) process.stderr.write(`${(err as Error).stack}\n`);
    process.exit(1);
  });
}
