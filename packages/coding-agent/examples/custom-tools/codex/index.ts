/**
 * Codex Tool - Invoke Codex CLI headlessly within pi-mono
 *
 * This tool wraps `codex exec --json` as a subprocess, streaming JSONL events
 * to the TUI and returning the final result. It enables pi-mono users to leverage
 * Codex without switching tools, while delegating auth to the Codex CLI.
 *
 * Prerequisites:
 * - Codex CLI installed (`npm i -g @openai/codex`)
 * - Logged in (`codex login`)
 */

import { spawn, type ChildProcess } from "node:child_process";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";
import type { CustomAgentTool, CustomToolFactory } from "@mariozechner/pi-coding-agent";

// Codex JSONL event types (based on actual Codex CLI output)
interface CodexEvent {
  type: string;
  [key: string]: unknown;
}

// Codex item types within item.completed events
interface CodexItem {
  id: string;
  type: "reasoning" | "command_execution" | "agent_message" | "file_create" | "file_edit";
  text?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  status?: string;
}

interface CodexItemEvent extends CodexEvent {
  type: "item.completed" | "item.started";
  item: CodexItem;
}

interface CodexTurnEvent extends CodexEvent {
  type: "turn.completed";
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cached_input_tokens?: number;
  };
}

// Tool result details
interface CodexDetails {
  events: CodexEvent[];
  exitCode: number | null;
  streaming: boolean;
  lastMessage?: string;
  error?: string;
}

const codexSchema = Type.Object({
  prompt: Type.String({
    description:
      "Task for Codex to execute. Be specific about what you want done.",
  }),
  model: Type.Optional(
    Type.String({
      description:
        "Model override (e.g., 'o3', 'o4-mini'). Uses Codex default if not specified.",
    })
  ),
  sandbox: Type.Optional(
    StringEnum(["read-only", "workspace-write"] as const, {
      description:
        "Sandbox mode. 'read-only' for exploration, 'workspace-write' for modifications.",
    })
  ),
  workDir: Type.Optional(
    Type.String({
      description:
        "Working directory for Codex. Defaults to current directory.",
    })
  ),
});

type CodexParams = {
  prompt: string;
  model?: string;
  sandbox?: "read-only" | "workspace-write";
  workDir?: string;
};

const factory: CustomToolFactory = (pi) => {
  const tool: CustomAgentTool<typeof codexSchema, CodexDetails> = {
    name: "codex",
    label: "Codex",
    description:
      "Invoke OpenAI Codex CLI to execute a task. Codex can read/write files, run commands, and iterate on problems. " +
      "Use this for tasks where Codex's capabilities complement the current model (e.g., specialized code generation, " +
      "alternative perspective). The result will include Codex's final output.",
    parameters: codexSchema,

    async execute(
      _toolCallId: string,
      params: CodexParams,
      signal?: AbortSignal,
      onUpdate?: (result: {
        content: Array<{ type: "text"; text: string }>;
        details: CodexDetails;
      }) => void
    ) {
      const events: CodexEvent[] = [];
      let lastMessage = "";
      let child: ChildProcess | null = null;

      // Build command args
      const args = ["exec", "--json", "--full-auto"];

      if (params.model) {
        args.push("-m", params.model);
      }

      if (params.sandbox) {
        args.push("-s", params.sandbox);
      }

      // Add the prompt
      args.push(params.prompt);

      const workDir = params.workDir || pi.cwd;

      return new Promise((resolve, reject) => {
        // Check if already aborted
        if (signal?.aborted) {
          resolve({
            content: [
              { type: "text", text: "Codex execution aborted before start." },
            ],
            details: {
              events: [],
              exitCode: null,
              streaming: false,
              error: "aborted",
            },
          });
          return;
        }

        // Spawn codex process
        child = spawn("codex", args, {
          cwd: workDir,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let buffer = "";
        let stderr = "";

        // Handle abort
        const onAbort = () => {
          if (child && !child.killed) {
            child.kill("SIGTERM");
            // Force kill after 2 seconds
            setTimeout(() => {
              if (child && !child.killed) {
                child.kill("SIGKILL");
              }
            }, 2000);
          }
        };

        if (signal) {
          signal.addEventListener("abort", onAbort, { once: true });
        }

        // Stream stdout (JSONL events)
        child.stdout?.on("data", (data: Buffer) => {
          buffer += data.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer

          for (const line of lines) {
            if (!line.trim()) continue;

            try {
              const event = JSON.parse(line) as CodexEvent;
              events.push(event);

              // Extract message content for summary from agent_message items
              if (event.type === "item.completed") {
                const itemEvent = event as CodexItemEvent;
                if (itemEvent.item?.type === "agent_message" && itemEvent.item?.text) {
                  lastMessage = itemEvent.item.text;
                }
              }

              // Emit progress update
              onUpdate?.({
                content: [{ type: "text", text: formatEventForDisplay(event) }],
                details: {
                  events: [...events],
                  exitCode: null,
                  streaming: true,
                  lastMessage,
                },
              });
            } catch {
              // Skip malformed JSON lines
            }
          }
        });

        // Capture stderr
        child.stderr?.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        // Handle completion
        child.on("close", (code) => {
          // Clean up abort handler
          if (signal) {
            signal.removeEventListener("abort", onAbort);
          }

          // Process any remaining buffer
          if (buffer.trim()) {
            try {
              const event = JSON.parse(buffer) as CodexEvent;
              events.push(event);
              if (event.type === "item.completed") {
                const itemEvent = event as CodexItemEvent;
                if (itemEvent.item?.type === "agent_message" && itemEvent.item?.text) {
                  lastMessage = itemEvent.item.text;
                }
              }
            } catch {
              // Ignore
            }
          }

          // Build final result
          const wasAborted = signal?.aborted;
          const hasError = code !== 0 && code !== null;

          let resultText: string;
          if (wasAborted) {
            resultText = `Codex execution aborted.\n\nPartial output:\n${
              lastMessage || "(no output)"
            }`;
          } else if (hasError) {
            resultText = `Codex exited with code ${code}.\n\nStderr:\n${
              stderr || "(no stderr)"
            }\n\nOutput:\n${lastMessage || "(no output)"}`;
          } else {
            resultText =
              lastMessage || "(Codex completed with no message output)";
          }

          resolve({
            content: [{ type: "text", text: resultText }],
            details: {
              events,
              exitCode: code,
              streaming: false,
              lastMessage,
              error: wasAborted ? "aborted" : hasError ? stderr : undefined,
            },
          });
        });

        child.on("error", (err) => {
          // Clean up abort handler
          if (signal) {
            signal.removeEventListener("abort", onAbort);
          }

          reject(
            new Error(
              `Failed to spawn Codex: ${err.message}. Is Codex CLI installed?`
            )
          );
        });
      });
    },

    // Custom rendering for tool call
    renderCall(args: CodexParams, theme: any) {
      const model = args.model ? ` (${args.model})` : "";
      const sandbox = args.sandbox ? ` [${args.sandbox}]` : "";
      const prompt =
        args.prompt.length > 80
          ? args.prompt.slice(0, 77) + "..."
          : args.prompt;

      return new Text(
        theme.fg("toolTitle", theme.bold("codex")) +
          theme.fg("dim", model + sandbox) +
          "\n" +
          theme.fg("muted", prompt),
        0,
        0
      );
    },

    // Custom rendering for result
    renderResult(
      result: {
        content: Array<{ type: string; text?: string }>;
        details?: CodexDetails;
        isError?: boolean;
      },
      options: { expanded?: boolean },
      theme: any
    ) {
      const { details, isError } = result;

      // Streaming in progress
      if (details?.streaming) {
        const eventCount = details.events.length;
        const lastEvent = details.events[eventCount - 1];
        const statusText = lastEvent
          ? formatEventForDisplay(lastEvent)
          : "Starting...";
        return new Text(
          theme.fg("warning", "⏳ ") +
            theme.fg("muted", `Codex running (${eventCount} events)`) +
            "\n" +
            statusText,
          0,
          0
        );
      }

      // Completed
      if (isError || details?.error) {
        const errorMsg = details?.error || "Unknown error";
        return new Text(
          theme.fg("error", "✗ Codex error: ") + theme.fg("muted", errorMsg),
          0,
          0
        );
      }

      // Success
      const message = details?.lastMessage || result.content[0]?.text || "";
      const preview =
        message.length > 200 ? message.slice(0, 197) + "..." : message;
      const exitCode = details?.exitCode ?? 0;

      if (options.expanded) {
        return new Text(
          theme.fg("success", "✓ ") +
            theme.fg(
              "muted",
              `Codex completed (exit ${exitCode}, ${
                details?.events.length || 0
              } events)`
            ) +
            "\n\n" +
            message,
          0,
          0
        );
      }

      return new Text(
        theme.fg("success", "✓ ") + theme.fg("muted", `Codex: `) + preview,
        0,
        0
      );
    },
  };

  return tool;
};

/**
 * Format a Codex JSONL event for display in the TUI
 */
function formatEventForDisplay(event: CodexEvent): string {
  switch (event.type) {
    case "thread.started":
      return "[starting]";

    case "turn.started":
      return "[turn started]";

    case "turn.completed": {
      const turn = event as CodexTurnEvent;
      const tokens = turn.usage?.output_tokens || 0;
      return `[turn completed: ${tokens} tokens]`;
    }

    case "item.started": {
      const itemEvent = event as CodexItemEvent;
      const item = itemEvent.item;
      if (item.type === "command_execution") {
        return `→ Running: ${item.command || "(command)"}`;
      }
      return `→ ${item.type}`;
    }

    case "item.completed": {
      const itemEvent = event as CodexItemEvent;
      const item = itemEvent.item;
      switch (item.type) {
        case "reasoning":
          return `💭 ${item.text || ""}`;
        case "command_execution": {
          const output = item.aggregated_output || "";
          const preview = output.length > 50 ? output.slice(0, 47) + "..." : output;
          const status = item.exit_code === 0 ? "✓" : `✗ (${item.exit_code})`;
          return `${status} ${preview.trim()}`;
        }
        case "agent_message":
          return `💬 ${item.text || ""}`;
        case "file_create":
        case "file_edit":
          return `📄 ${item.type}`;
        default:
          return `[${item.type}]`;
      }
    }

    default:
      return `[${event.type}]`;
  }
}

export default factory;
