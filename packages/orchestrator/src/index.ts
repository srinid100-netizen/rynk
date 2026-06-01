import { resolve } from "node:path";
import { createLogger, moduleDir, buildRunPath, readJson, fileExists, type ClientContext } from "@rynk/core";
import { clientRegistry } from "@rynk/clients";
import { runLayer1 } from "@rynk/layer1-audit";
import { runStrategyAgent, saveStrategyOutput } from "@rynk/layer2-strategy";
import { runOnboardingAgent } from "./onboarding/onboard-agent.js";
import {
  clientJsonExists,
  clientJsonPath,
  clientMdPath,
  loadClientJson,
  saveClientJson,
  saveClientMd,
} from "./onboarding/client-store.js";
import { displayClientSummary, promptForConfirmation } from "./onboarding/review.js";

const log = createLogger("orchestrator");

// ── Client resolution ─────────────────────────────────────────────────────────

/**
 * Resolve a ClientContext for the given domain using a three-tier priority:
 *
 *   1. Static registry  — hardcoded clients in @rynk/clients (fastest, always first)
 *   2. Cached JSON      — runs/{domain}/client.json from a previous onboarding run
 *   3. Onboarding agent — AI-powered extraction (crawl + web search), writes JSON,
 *                         shows a review table, and asks for human confirmation.
 *
 * Pass forceOnboard=true to skip tiers 1 and 2 and always re-run the agent.
 * This is useful when re-onboarding a known client or for demo/testing purposes.
 */
async function resolveClient(
  domain: string,
  runsDir: string,
  forceOnboard: boolean,
): Promise<ClientContext> {
  // ── Tier 1: static registry ─────────────────────────────────────────────────
  if (!forceOnboard) {
    const staticClient = clientRegistry[domain];
    if (staticClient) {
      log.info("using static registry client", { domain });
      return staticClient;
    }
  }

  // ── Tier 2: cached client.json ──────────────────────────────────────────────
  if (!forceOnboard && clientJsonExists(runsDir, domain)) {
    log.info("using cached client.json", { domain });
    return loadClientJson(runsDir, domain);
  }

  // ── Tier 3: onboarding agent ────────────────────────────────────────────────
  log.info(
    forceOnboard
      ? "force-onboard flag set — running onboarding agent"
      : "domain not found in registry or cache — running onboarding agent",
    { domain },
  );

  const ctx = await runOnboardingAgent({ domain });

  const jsonPath = saveClientJson(runsDir, domain, ctx);
  const mdPath = saveClientMd(runsDir, domain, ctx);

  log.info("client profile saved", { jsonPath, mdPath });

  displayClientSummary(ctx, jsonPath, mdPath);

  const accepted = await promptForConfirmation();

  if (!accepted) {
    process.stdout.write(
      `\n  Onboarding cancelled. Edit the profile and re-run:\n\n` +
        `    ${jsonPath}\n\n` +
        `  The pipeline will pick up your edits automatically on the next run.\n\n`,
    );
    process.exit(0);
  }

  process.stdout.write("\n  ✅ Profile accepted. Starting pipeline…\n\n");
  return ctx;
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

/**
 * End-to-end runner. Chains:
 *   Client onboarding (if needed) → Layer 1 → Layer 2
 *
 * Layers 3–5 will be added as they come online.
 */
export async function runPipeline(
  domain: string,
  opts: { forceOnboard?: boolean } = {},
): Promise<void> {
  const rootDir = resolve(moduleDir(import.meta.url), "../../../runs");
  const forceOnboard = opts.forceOnboard ?? false;

  log.info("pipeline start", { domain, forceOnboard });

  const client = await resolveClient(domain, rootDir, forceOnboard);

  // REUSE_AUDIT=true: skip Layer 1 entirely and load today's already-saved audit.json.
  // Use this after a Layer 2 failure to iterate on strategy without re-crawling.
  const reuseAudit = process.env["REUSE_AUDIT"] === "true";
  const auditJsonPath = buildRunPath(rootDir, domain, "audit.json");

  let findings: import("@rynk/layer1-audit").RunLayer1Result["findings"];

  if (reuseAudit && fileExists(auditJsonPath)) {
    log.info("REUSE_AUDIT=true — loading existing audit.json", { auditJsonPath });
    findings = readJson(auditJsonPath);
  } else {
    if (reuseAudit) log.warn("REUSE_AUDIT=true but audit.json not found — running Layer 1", { auditJsonPath });
    // Run sub-agents sequentially by default to stay within per-minute token
    // rate limits on lower API plan tiers. Set PARALLEL_AGENTS=true to re-enable
    // parallel execution once on a higher-rate plan.
    const parallel = process.env["PARALLEL_AGENTS"] === "true";
    const { findings: f, paths: l1Paths } = await runLayer1({ client, rootDir, parallel });
    log.info("Layer 1 done", { jsonPath: l1Paths.jsonPath });
    findings = f;
  }

  const strategy = await runStrategyAgent({
    audit: { content: JSON.stringify(findings, null, 2), format: "json" },
    clientContext: client,
  });

  const l2Paths = saveStrategyOutput(strategy, rootDir);
  log.info("Layer 2 done", { jsonPath: l2Paths.jsonPath });

  log.info("pipeline complete");
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  const domain = process.argv[2];
  if (!domain) {
    process.stderr.write(
      "Usage: tsx src/index.ts <domain> [--force-onboard]\n" +
        "\n" +
        "  <domain>          Bare domain to run (e.g. itechdata.ai)\n" +
        "  --force-onboard   Re-run onboarding even if client.json already exists\n" +
        "\n" +
        "Environment shortcuts (set before the command):\n" +
        "  REUSE_RAW=true    Skip Layer 1 data collection — load today's raw JSON files\n" +
        "  REUSE_AUDIT=true  Skip Layer 1 entirely — load today's audit.json for Layer 2\n" +
        "  LAYER1_MODEL=...  Override the model for data collection agents (default: claude-haiku-4-5)\n" +
        "  PARALLEL_AGENTS=true  Run data-collection and offsite-research in parallel\n" +
        "\n" +
        "Examples:\n" +
        "  npm run pipeline -- itechdata.ai\n" +
        "  npm run pipeline -- newclient.com\n" +
        "  npm run pipeline -- itechdata.ai --force-onboard\n" +
        "  REUSE_RAW=true npm run pipeline -- itechdata.ai\n" +
        "  REUSE_AUDIT=true npm run pipeline -- itechdata.ai\n",
    );
    process.exit(2);
  }

  const forceOnboard = process.argv.includes("--force-onboard");

  runPipeline(domain, { forceOnboard }).catch((err) => {
    process.stderr.write(`\n❌ ${(err as Error).message}\n`);
    if (process.env.DEBUG) process.stderr.write(`${(err as Error).stack ?? ""}\n`);
    process.exit(1);
  });
}

// ── Re-exports for programmatic use ──────────────────────────────────────────

export { clientJsonPath, clientMdPath, loadClientJson } from "./onboarding/client-store.js";
export { runOnboardingAgent } from "./onboarding/onboard-agent.js";
