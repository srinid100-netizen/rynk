import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient, defaultModel } from "../clients/anthropic.js";
import { createLogger, type Logger } from "../utils/logger.js";
import { withRetry, isTransientError } from "../utils/retry.js";
import { envNumber } from "../utils/env.js";
import { isServerTool, type AnyAgentTool, type ServerTool } from "./tool.js";

export interface AgentRunInput {
  /** System prompt — the agent's role + rules. */
  system: string;
  /** First user message to start the conversation. */
  userMessage: string;
  /** Client-side tools the agent can call. */
  tools?: AnyAgentTool[];
  /** Anthropic-managed server tools (web_search, web_fetch). */
  serverTools?: ServerTool[];
  /** Override default model. */
  model?: string;
  maxOutputTokens?: number;
  /** Safety stop — abort after this many tool-call turns. */
  maxIterations?: number;
  /** Anthropic beta flags. */
  betas?: string[];
  logger?: Logger;
}

export interface AgentRunResult {
  /** Final text output from the model after all tool calls resolved. */
  finalText: string;
  /** Total usage across all iterations. */
  usage: { input_tokens: number; output_tokens: number; iterations: number };
  /** Stop reason of the final message. */
  stopReason: string | null;
}

const MAX_ITERATIONS_DEFAULT = 25;

/**
 * Run a tool-using agent loop against Anthropic.
 *
 * The loop:
 *   1. Send messages to the model
 *   2. If stop_reason === "tool_use", execute each requested client-side tool
 *      and append a "user" message with tool_result blocks
 *   3. Repeat until stop_reason === "end_turn" or maxIterations is reached
 *
 * Server tools (web_search / web_fetch) are executed by Anthropic — we never
 * see a tool_use block for them; results flow straight back in the assistant
 * message and we let the loop continue.
 */
export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const log = input.logger ?? createLogger("agent");
  const client = getAnthropicClient();
  const model = input.model ?? defaultModel();
  const maxOutputTokens = input.maxOutputTokens ?? envNumber("MAX_OUTPUT_TOKENS", 16_000);
  const maxIterations = input.maxIterations ?? MAX_ITERATIONS_DEFAULT;

  const clientTools = input.tools ?? [];
  const serverTools = input.serverTools ?? [];

  // Combine for the API call. The Anthropic SDK accepts both shapes.
  const toolsParam: Array<Anthropic.Tool | ServerTool> = [
    ...clientTools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    })) as Anthropic.Tool[],
    ...serverTools,
  ];

  const toolByName = new Map<string, AnyAgentTool>(clientTools.map((t) => [t.name, t]));

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: input.userMessage },
  ];

  let totalIn = 0;
  let totalOut = 0;
  let lastStop: string | null = null;
  let finalText = "";

  for (let iter = 1; iter <= maxIterations; iter++) {
    log.debug(`iteration ${iter} — sending message`, { messages: messages.length });

    // Use streaming so long-running agents (Layer 1 can run 15-30 min) never
    // hit the SDK's 10-minute non-streaming timeout. .finalMessage() collects
    // the full streamed response and returns the same Anthropic.Message shape.
    const response: Anthropic.Message = await withRetry(
      () =>
        client.messages
          .stream({
            model,
            max_tokens: maxOutputTokens,
            system: input.system,
            messages,
            ...(toolsParam.length > 0 ? { tools: toolsParam as Anthropic.Tool[] } : {}),
            // betas (if ever needed) go via options: { headers: { "anthropic-beta": "..." } }
          })
          .finalMessage(),
      {
        retries: 6,
        baseDelayMs: 1000,
        shouldRetry: (err) => {
          const status = (err as { status?: number }).status;
          if (status === 401 || status === 403) return false;
          return isTransientError(err);
        },
        // 429 rate-limit errors need a full minute to reset — wait 65s.
        // All other transient errors use normal exponential backoff.
        getDelayMs: (err, _attempt, defaultDelay) => {
          const status = (err as { status?: number }).status;
          return status === 429 ? 65_000 + Math.random() * 3_000 : defaultDelay;
        },
        onRetry: (err, attempt, delay) => {
          const status = (err as { status?: number }).status;
          log.warn(`API error, retrying`, {
            attempt,
            delayMs: Math.round(delay),
            waitReason: status === 429 ? "rate limit — waiting 65s for window to reset" : "transient error",
            error: (err as Error).message,
          });
        },
      },
    );

    totalIn += response.usage.input_tokens ?? 0;
    totalOut += response.usage.output_tokens ?? 0;
    lastStop = response.stop_reason;

    // Extract assistant text for return value
    const textParts = response.content.filter(
      (c): c is Anthropic.TextBlock => c.type === "text",
    );
    if (textParts.length > 0) {
      finalText = textParts.map((t) => t.text).join("\n");
    }

    // If end_turn (or anything other than tool_use), we're done.
    if (response.stop_reason !== "tool_use") {
      log.info(`agent finished`, {
        iterations: iter,
        stopReason: response.stop_reason,
        inputTokens: totalIn,
        outputTokens: totalOut,
      });
      return {
        finalText,
        usage: { input_tokens: totalIn, output_tokens: totalOut, iterations: iter },
        stopReason: response.stop_reason,
      };
    }

    // Collect tool_use blocks and execute the client-side ones.
    const toolUseBlocks = response.content.filter(
      (c): c is Anthropic.ToolUseBlock => c.type === "tool_use",
    );

    // Append the assistant's full message (preserving ordering of all blocks).
    messages.push({ role: "assistant", content: response.content });

    const toolResultBlocks: Anthropic.ToolResultBlockParam[] = [];
    for (const block of toolUseBlocks) {
      const tool = toolByName.get(block.name);
      if (!tool) {
        // Server tools are executed by Anthropic — we'd never see a tool_use
        // block for them. An unknown name here is a bug.
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Unknown tool: ${block.name}`,
          is_error: true,
        });
        log.warn(`unknown tool requested`, { name: block.name });
        continue;
      }

      try {
        const validated = tool.inputZod ? tool.inputZod.parse(block.input) : block.input;
        log.debug(`tool call`, { name: tool.name });
        const result = await tool.execute(validated);
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(`tool failed`, { name: tool.name, error: msg });
        toolResultBlocks.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Tool ${tool.name} failed: ${msg}`,
          is_error: true,
        });
      }
    }

    if (toolResultBlocks.length === 0) {
      // No actionable tool_use — break to avoid infinite loop.
      log.warn(`stop_reason=tool_use but no client tool_use blocks; breaking`);
      break;
    }

    messages.push({ role: "user", content: toolResultBlocks });
  }

  log.warn(`max iterations reached`, { maxIterations });
  return {
    finalText,
    usage: { input_tokens: totalIn, output_tokens: totalOut, iterations: maxIterations },
    stopReason: lastStop,
  };
}

export { isServerTool };
