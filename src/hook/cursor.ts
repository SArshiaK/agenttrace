import { basename, isAbsolute, relative } from "node:path";
import { TraceStore } from "../core/store.js";
import { estimateTokens, measureOutput, redact, truncate } from "../core/redact.js";

type HookInput = Record<string, unknown> & {
  hook_event_name?: string;
  conversation_id?: string;
  session_id?: string;
  workspace_roots?: string[];
  model?: string;
};

type EventInput = Parameters<TraceStore["appendEvent"]>[0];

export const EDIT_TOOLS = new Set(["Write", "StrReplace", "EditNotebook", "Edit", "MultiEdit"]);

const TEXT_LIMIT = 4000;
const OUTPUT_LIMIT = 2000;
const ARG_LIMIT = 300;

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function toText(value: unknown): string {
  if (value == null) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function clean(text: string, max: number): string {
  return truncate(redact(text), max);
}

function compactArgs(value: unknown): unknown {
  if (typeof value === "string") return clean(value, ARG_LIMIT);
  if (Array.isArray(value)) return value.slice(0, 20).map(compactArgs);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, compactArgs(v)]),
    );
  }
  return value;
}

function displayPath(path: string, roots: string[] | undefined): string {
  const root = roots?.[0];
  if (root && isAbsolute(path)) {
    const rel = relative(root, path);
    if (rel && !rel.startsWith("..") && !isAbsolute(rel)) return rel.replace(/\\/g, "/");
  }
  return path.replace(/\\/g, "/");
}

function toolPath(input: Record<string, unknown>): string | undefined {
  return (
    str(input.path) ??
    str(input.file_path) ??
    str(input.target_file) ??
    str(input.target_notebook)
  );
}

function toolTitle(name: string, input: Record<string, unknown>, roots?: string[]): string {
  const path = toolPath(input);
  const pick =
    str(input.command) ??
    (path ? displayPath(path, roots) : undefined) ??
    str(input.pattern) ??
    str(input.glob_pattern) ??
    str(input.query) ??
    str(input.description);
  if (!pick) return name;
  const oneLine = pick.replace(/\s+/g, " ").trim();
  return `${name}: ${oneLine.length > 90 ? `${oneLine.slice(0, 90)}…` : oneLine}`;
}

export function runIdFor(input: HookInput): string | null {
  const id = input.conversation_id ?? input.session_id;
  if (!id) return null;
  return `cursor_${String(id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64)}`;
}

/** Maps one Cursor hook payload to zero or more agenttrace events. */
export function mapCursorHook(input: HookInput): EventInput[] {
  const event = input.hook_event_name;
  const roots = input.workspace_roots;
  const model = str(input.model);
  const base = { source: "cursor" };

  switch (event) {
    case "beforeSubmitPrompt": {
      const prompt = toText(input.prompt);
      const attachments = Array.isArray(input.attachments) ? input.attachments.length : 0;
      return [
        {
          ...base,
          type: "model.request",
          title: "You",
          data: {
            text: clean(prompt, TEXT_LIMIT),
            chars: prompt.length,
            estTokens: estimateTokens(prompt),
            attachments,
            model,
          },
        },
      ];
    }

    case "postToolUse":
    case "postToolUseFailure": {
      const name = str(input.tool_name) ?? "tool";
      const toolInput = (input.tool_input ?? {}) as Record<string, unknown>;
      const rawOutput = toText(input.tool_output);
      const measured = measureOutput(rawOutput);
      const output = measured.text;
      const inputText = toText(toolInput);
      const path = toolPath(toolInput);
      const failed = event === "postToolUseFailure";
      const events: EventInput[] = [
        {
          ...base,
          type: "tool.ended",
          title: toolTitle(name, toolInput, roots),
          durationMs: num(input.duration),
          data: {
            name,
            args: compactArgs(toolInput),
            output: output ? clean(output, OUTPUT_LIMIT) : undefined,
            outputChars: rawOutput.length,
            // Edit tools report the whole resulting file as input; afterFileEdit carries the real diff.
            estTokens: measured.estTokens + (EDIT_TOOLS.has(name) ? 0 : estimateTokens(inputText)),
            ...(measured.blobs ? { images: measured.blobs } : {}),
            ...(path ? { path: displayPath(path, roots) } : {}),
            ...(failed ? { failureType: str(input.failure_type), interrupted: input.is_interrupt } : {}),
          },
          error: failed
            ? { message: clean(str(input.error_message) ?? "Tool failed", 500) }
            : undefined,
        },
      ];
      if (!failed && name === "Read" && path) {
        events.push({ ...base, type: "file.read", title: basename(path), data: { path: displayPath(path, roots) } });
      }
      if (!failed && name === "Delete" && path) {
        events.push({ ...base, type: "file.delete", title: basename(path), data: { path: displayPath(path, roots) } });
      }
      return events;
    }

    case "afterFileEdit": {
      const path = str(input.file_path);
      if (!path) return [];
      const edits = Array.isArray(input.edits) ? (input.edits as Array<Record<string, unknown>>) : [];
      const added = edits.reduce((n, e) => n + (str(e.new_string)?.length ?? 0), 0);
      const removed = edits.reduce((n, e) => n + (str(e.old_string)?.length ?? 0), 0);
      return [
        {
          ...base,
          type: "file.write",
          title: basename(path),
          data: {
            path: displayPath(path, roots),
            edits: edits.length,
            addedChars: added,
            removedChars: removed,
            estTokens: Math.ceil((added + removed) / 4),
          },
        },
      ];
    }

    case "afterAgentResponse": {
      const text = toText(input.text);
      return [
        {
          ...base,
          type: "model.response",
          title: "Agent",
          data: { text: clean(text, TEXT_LIMIT), chars: text.length, estTokens: estimateTokens(text), model },
        },
      ];
    }

    case "afterAgentThought": {
      const text = toText(input.text);
      return [
        {
          ...base,
          type: "model.thought",
          title: "Thinking",
          durationMs: num(input.duration_ms),
          data: { text: clean(text, 1500), chars: text.length, estTokens: estimateTokens(text), model },
        },
      ];
    }

    case "preCompact":
      return [
        {
          ...base,
          type: "context.compact",
          title: `Context compacted at ${num(input.context_usage_percent) ?? "?"}%`,
          data: {
            trigger: str(input.trigger),
            contextTokens: num(input.context_tokens),
            contextWindow: num(input.context_window_size),
            usagePercent: num(input.context_usage_percent),
            messageCount: num(input.message_count),
            messagesToCompact: num(input.messages_to_compact),
          },
        },
      ];

    case "stop":
      return [
        {
          ...base,
          type: "turn.ended",
          title: `Turn ${str(input.status) ?? "ended"}`,
          data: { status: str(input.status), loopCount: num(input.loop_count) },
        },
      ];

    default:
      return [];
  }
}

export async function handleCursorHook(input: HookInput, store = new TraceStore()): Promise<void> {
  const runId = runIdFor(input);
  if (!runId) return;
  await store.ensureRun(runId, {
    title: "Cursor chat",
    source: "cursor",
    data: { titleFromPrompt: true, conversationId: input.conversation_id ?? input.session_id },
  });

  if (input.hook_event_name === "sessionEnd") {
    const reason = str(input.reason);
    await store.endRun(runId, {
      source: "cursor",
      status: reason === "error" ? "error" : "ended",
      data: { reason, durationMs: num(input.duration_ms) },
    });
    return;
  }

  for (const event of mapCursorHook(input)) {
    await store.appendEvent({ ...event, runId });
  }
}

export function hookResponse(eventName: string | undefined): Record<string, unknown> {
  return eventName === "beforeSubmitPrompt" ? { continue: true } : {};
}
