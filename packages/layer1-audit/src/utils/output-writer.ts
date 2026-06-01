import { writeJson, writeText, buildRunPath, type AuditFindings } from "@rynk/core";
import { auditFindingsToMarkdown } from "./markdown-renderer.js";

export interface SaveAuditOptions {
  rootDir: string;
  dataCollectionRaw?: string;
  offsiteResearchRaw?: string;
}

export interface SaveAuditResult {
  jsonPath: string;
  mdPath: string;
  rawDataCollectionPath?: string;
  rawOffsiteResearchPath?: string;
}

/**
 * Persist Layer 1 output. Writes:
 *   runs/<domain>/<date>/audit.json     — Layer 2 input
 *   runs/<domain>/<date>/audit.md       — human review
 *   runs/<domain>/<date>/data-collection.raw.json   — sub-agent 1 output (debug)
 *   runs/<domain>/<date>/offsite-research.raw.json  — sub-agent 2 output (debug)
 */
export function saveAuditFindings(
  findings: AuditFindings,
  opts: SaveAuditOptions,
): SaveAuditResult {
  const jsonPath = buildRunPath(opts.rootDir, findings.domain, "audit.json");
  const mdPath = buildRunPath(opts.rootDir, findings.domain, "audit.md");

  writeJson(jsonPath, findings);
  writeText(mdPath, auditFindingsToMarkdown(findings));

  const result: SaveAuditResult = { jsonPath, mdPath };

  if (opts.dataCollectionRaw) {
    const p = buildRunPath(opts.rootDir, findings.domain, "data-collection.raw.json");
    writeText(p, opts.dataCollectionRaw);
    result.rawDataCollectionPath = p;
  }
  if (opts.offsiteResearchRaw) {
    const p = buildRunPath(opts.rootDir, findings.domain, "offsite-research.raw.json");
    writeText(p, opts.offsiteResearchRaw);
    result.rawOffsiteResearchPath = p;
  }

  return result;
}
