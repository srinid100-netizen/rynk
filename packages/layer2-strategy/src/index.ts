import { resolve, dirname } from "node:path";
import {
  createLogger,
  ClientContextSchema,
  readJson,
  fileExists,
  moduleDir,
  type ClientContext,
} from "@rynk/core";
import { loadAuditInput } from "./utils/audit-loader.js";
import { saveStrategyOutput } from "./utils/output-writer.js";
import { runStrategyAgent } from "./agents/strategy-agent.js";

export { runStrategyAgent } from "./agents/strategy-agent.js";
export { loadAuditInput } from "./utils/audit-loader.js";
export { saveStrategyOutput } from "./utils/output-writer.js";

const log = createLogger("layer2");

const DEFAULT_AUDIT = "./inputs/itechdata-seo-eeat-audit.md";
const OUTPUT_ROOT = resolve(moduleDir(import.meta.url), "../../../runs");

/**
 * Resolve the ClientContext for a standalone Layer 2 run.
 *
 * Priority:
 *   1. --domain <domain> flag  → loads runs/{domain}/client.json
 *   2. audit.json domain field → loads runs/{domain}/client.json
 *      (works automatically when the audit path is runs/{domain}/{date}/audit.json)
 *   3. Falls back to a minimal stub with a warning so Layer 2 can still run.
 */
function resolveClientContext(auditPath: string, auditContent: string, format: string): ClientContext {
  // Try --domain flag
  const domainFlagIdx = process.argv.indexOf("--domain");
  const domainFromFlag = domainFlagIdx !== -1 ? process.argv[domainFlagIdx + 1] : undefined;

  // Try domain from audit JSON
  let domainFromAudit: string | undefined;
  if (format === "json") {
    try {
      const parsed = JSON.parse(auditContent) as Record<string, unknown>;
      if (typeof parsed["domain"] === "string") domainFromAudit = parsed["domain"];
    } catch {
      // ignore
    }
  }

  const domain = domainFromFlag ?? domainFromAudit;

  if (domain) {
    // Look for client.json in runs/{domain}/
    const safeDomain = domain.replace(/[^a-z0-9.-]/gi, "_");
    const clientJsonFile = resolve(OUTPUT_ROOT, safeDomain, "client.json");

    if (fileExists(clientJsonFile)) {
      log.info("loading client context from client.json", { path: clientJsonFile });
      const raw = readJson<unknown>(clientJsonFile);
      const result = ClientContextSchema.safeParse(raw);
      if (result.success) return result.data;
      log.warn("client.json failed validation — using stub", { domain });
    } else {
      log.warn("no client.json found — using stub", { domain, path: clientJsonFile });
    }

    // Stub: enough to let Layer 2 run without crashing
    log.warn(
      "Layer 2 running with minimal client context. " +
        "Run the full pipeline via the orchestrator for best results.",
    );
    return ClientContextSchema.parse({
      domain,
      legalEntity: domain,
      canonicalNAP: { address: "Unknown", phone: "Unknown", email: `info@${domain}` },
      industry: "Unknown",
      verticals: [],
      icp: "Unknown",
      competitors: ["unknown.com"],
      goals: ["Increase organic search visibility"],
      team: { hasDev: false, hasContent: false, hasMarketing: false, hasLegal: false },
      sprint: { cadence: "biweekly", budget: "medium" },
    });
  }

  throw new Error(
    "Cannot resolve client context for standalone Layer 2 run.\n\n" +
      "Either:\n" +
      "  a) Pass an audit.json produced by Layer 1 (it includes the domain automatically):\n" +
      "       tsx packages/layer2-strategy/src/index.ts runs/<domain>/<date>/audit.json\n\n" +
      "  b) Add a --domain flag:\n" +
      "       tsx packages/layer2-strategy/src/index.ts <audit.md> --domain <domain>\n\n" +
      "  c) Run the full pipeline via the orchestrator (recommended):\n" +
      "       tsx packages/orchestrator/src/index.ts <domain>",
  );
}

async function main(): Promise<void> {
  const auditPath = process.argv[2] ?? DEFAULT_AUDIT;

  log.info("starting Layer 2 — Strategy Agent");

  const audit = loadAuditInput(auditPath);
  log.info("audit loaded", { path: auditPath, format: audit.format, chars: audit.content.length });

  const clientContext = resolveClientContext(auditPath, audit.content, audit.format);
  log.info("client context resolved", { domain: clientContext.domain });

  const strategy = await runStrategyAgent({ audit, clientContext });

  const { jsonPath, mdPath } = saveStrategyOutput(strategy, OUTPUT_ROOT);
  log.info("Layer 2 complete", { jsonPath, mdPath });
  process.stdout.write(`\n✅ Strategy generated.\n  JSON: ${jsonPath}\n  MD:   ${mdPath}\n\n`);
}

// Only run main() if invoked directly (not when imported by orchestrator).
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main().catch((err) => {
    log.error("Layer 2 failed", { error: (err as Error).message });
    process.stderr.write(`\n❌ ${(err as Error).message}\n`);
    if (process.env.DEBUG) process.stderr.write(`${(err as Error).stack}\n`);
    process.exit(1);
  });
}
