import type { z } from "zod";

/**
 * A client-side tool the agent can call. The runner invokes `execute` with the
 * raw input from the model, returning a string the model will then read.
 *
 * Keep tool implementations small and side-effect-aware:
 *   - validate input with Zod before doing work
 *   - return structured JSON strings — the model is good at reading JSON
 *   - throw on unrecoverable errors; the runner catches and feeds the error
 *     back to the model so it can adapt
 */
export interface AgentTool<TInput = unknown> {
  name: string;
  description: string;
  /** JSON Schema for the Anthropic API. */
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
  /** Optional Zod schema for runtime validation of model-supplied input. */
  inputZod?: z.ZodType<TInput>;
  execute: (input: TInput) => Promise<string>;
}

/**
 * Erase the input type so collections of differently-typed tools can be held
 * in a single array. The runner validates with `inputZod` at call time, so
 * this is safe at runtime.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAgentTool = AgentTool<any>;

/** Anthropic-managed server-side tool (e.g. web_search, web_fetch). */
export interface ServerTool {
  type: string;
  name: string;
  /** Optional per-tool limits passed straight to the API. */
  max_uses?: number;
  [key: string]: unknown;
}

export function isServerTool(tool: AgentTool | ServerTool): tool is ServerTool {
  return "type" in tool && typeof (tool as ServerTool).type === "string";
}
