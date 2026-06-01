import { writeJson, writeText, buildRunPath } from "@rynk/core";
import type { StrategyOutput } from "@rynk/core";
import { strategyOutputToMarkdown } from "./markdown-renderer.js";

export function saveStrategyOutput(
  output: StrategyOutput,
  rootDir: string,
): { jsonPath: string; mdPath: string } {
  const jsonPath = buildRunPath(rootDir, output.domain, "strategy.json");
  const mdPath = buildRunPath(rootDir, output.domain, "strategy.md");

  writeJson(jsonPath, output);
  writeText(mdPath, strategyOutputToMarkdown(output));

  return { jsonPath, mdPath };
}
