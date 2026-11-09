import type { AgentTraceEvent } from "../types";

export type Kind =
  | "prompt"
  | "response"
  | "thought"
  | "tool"
  | "file"
  | "error"
  | "compact"
  | "note"
  | "system";

export type FilterKey = "all" | "heavy" | "tools" | "files" | "model" | "errors";

export const HEAVY_TOKENS = 1000;
export const SLOW_MS = 5000;

export function kindOf(event: AgentTraceEvent): Kind {
  if (event.error || event.type === "error") return "error";
  switch (event.type) {
    case "model.request":
      return "prompt";
    case "model.response":
      return "response";
    case "model.thought":
      return "thought";
    case "context.compact":
      return "compact";
    case "note":
      return "note";
  }
  if (event.type.startsWith("tool.")) return "tool";
  if (event.type.startsWith("file.")) return "file";
  return "system";
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function estTokens(event: AgentTraceEvent): number {
  const n = event.data?.estTokens;
  return typeof n === "number" ? n : 0;
}

function firstLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Short label + one-line detail for a timeline row. */
export function rowText(event: AgentTraceEvent): { label: string; detail: string } {
  const d = event.data ?? {};
  const kind = kindOf(event);
  const name = str(d.name);
  const title = event.title ?? "";
  const detailFromTitle = name && title.startsWith(`${name}: `) ? title.slice(name.length + 2) : title;

  switch (kind) {
    case "prompt":
      return { label: "You", detail: firstLine(str(d.text) ?? title) };
    case "response":
      return { label: "Response", detail: firstLine(str(d.text) ?? "") };
    case "thought":
      return { label: "Thinking", detail: firstLine(str(d.text) ?? "") };
    case "compact":
      return { label: "Compaction", detail: title };
    case "error":
      return {
        label: name ?? "Error",
        detail: firstLine(event.error?.message ?? (detailFromTitle || title)),
      };
    case "file": {
      const verb =
        event.type === "file.write" ? "Edited" : event.type === "file.delete" ? "Deleted" : "Read";
      return { label: verb, detail: str(d.path) ?? title };
    }
    case "tool": {
      let detail = firstLine(detailFromTitle);
      if ((!detail || detail === name) && d.args != null) detail = firstLine(JSON.stringify(d.args)).slice(0, 160);
      return { label: name ?? "Tool", detail: detail === name ? "" : detail };
    }
    case "note":
      return { label: title || "Note", detail: firstLine(str(d.text) ?? "") };
    default:
      return { label: event.type, detail: title };
  }
}

export function toolKey(event: AgentTraceEvent): string {
  const name = String(event.data?.name ?? event.title ?? "tool");
  return `${name}::${JSON.stringify(event.data?.args ?? event.data?.input ?? null)}`;
}

export function loopKeys(events: AgentTraceEvent[]): Set<string> {
  const ended = events.filter((e) => e.type === "tool.ended");
  const calls = ended.length ? ended : events.filter((e) => e.type === "tool.started");
  const counts = new Map<string, number>();
  for (const e of calls) counts.set(toolKey(e), (counts.get(toolKey(e)) ?? 0) + 1);
  return new Set([...counts].filter(([, n]) => n >= 3).map(([k]) => k));
}

export function matchesFilter(event: AgentTraceEvent, filter: FilterKey): boolean {
  const kind = kindOf(event);
  switch (filter) {
    case "all":
      return true;
    case "heavy":
      return estTokens(event) >= HEAVY_TOKENS;
    case "tools":
      return event.type.startsWith("tool.");
    case "files":
      return kind === "file" || (event.type.startsWith("tool.") && str(event.data?.path) !== undefined);
    case "model":
      return kind === "prompt" || kind === "response" || kind === "thought" || kind === "compact";
    case "errors":
      return kind === "error";
  }
}

export function matchesQuery(event: AgentTraceEvent, q: string): boolean {
  if (!q) return true;
  return `${event.type} ${event.title ?? ""} ${JSON.stringify(event.data ?? {})} ${event.error?.message ?? ""}`
    .toLowerCase()
    .includes(q);
}

const HIDDEN_TYPES = new Set(["run.started", "run.ended", "turn.ended"]);

export function isRowEvent(event: AgentTraceEvent): boolean {
  return !HIDDEN_TYPES.has(event.type);
}

export type Turn = {
  key: string;
  index: number;
  prompt?: AgentTraceEvent;
  events: AgentTraceEvent[];
  end?: AgentTraceEvent;
  startTs: string;
  endTs: string;
  tokens: number;
  tools: number;
  errors: number;
};

/** Each user prompt opens a turn; everything until the next prompt belongs to it. */
export function groupTurns(events: AgentTraceEvent[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;
  let promptCount = 0;

  const open = (prompt?: AgentTraceEvent, ts?: string): Turn => {
    const turn: Turn = {
      key: prompt?.id ?? `pre-${ts}`,
      index: prompt ? ++promptCount : 0,
      prompt,
      events: [],
      startTs: prompt?.ts ?? ts ?? new Date().toISOString(),
      endTs: prompt?.ts ?? ts ?? new Date().toISOString(),
      tokens: prompt ? estTokens(prompt) : 0,
      tools: 0,
      errors: 0,
    };
    turns.push(turn);
    return turn;
  };

  for (const event of events) {
    if (event.type === "model.request") {
      current = open(event);
      continue;
    }
    if (event.type === "run.started" || event.type === "run.ended") continue;
    current ??= open(undefined, event.ts);
    current.endTs = event.ts;
    if (event.type === "turn.ended") {
      current.end = event;
      continue;
    }
    current.events.push(event);
    current.tokens += estTokens(event);
    if (event.type.startsWith("tool.")) current.tools += 1;
    if (kindOf(event) === "error") current.errors += 1;
  }

  for (const turn of turns) turn.events = mergeFileEchoes(turn.events);
  return turns.filter((t) => t.prompt || t.events.length > 0);
}

const EDIT_TOOLS = new Set(["Write", "StrReplace", "EditNotebook", "Edit", "MultiEdit"]);

/**
 * Cursor reports each file operation twice (tool call + file hook). Show one row:
 * edits keep the file.write row (it has the real diff size) with the tool's duration;
 * reads/deletes keep the tool row.
 */
function mergeFileEchoes(events: AgentTraceEvent[]): AgentTraceEvent[] {
  const tools = events.filter((e) => e.type.startsWith("tool.") && str(e.data?.path));
  if (!tools.length) return events;
  const hidden = new Set<string>();
  const replaced = new Map<string, AgentTraceEvent>();

  for (const file of events) {
    if (!file.type.startsWith("file.")) continue;
    const ts = Date.parse(file.ts);
    // afterFileEdit fires just before the tool's postToolUse, so prefer the closest tool
    // call that follows the edit; back-to-back edits of one file must not pair crosswise.
    const candidates = tools.filter(
      (t) =>
        !hidden.has(t.id) &&
        str(t.data?.path) === str(file.data?.path) &&
        Math.abs(Date.parse(t.ts) - ts) <= 10_000,
    );
    const distance = (t: AgentTraceEvent) => {
      const delta = Date.parse(t.ts) - ts;
      return delta >= 0 ? delta : 20_000 - delta;
    };
    const tool = candidates.sort((a, b) => distance(a) - distance(b))[0];
    if (!tool) continue;
    if (file.type === "file.write" && EDIT_TOOLS.has(str(tool.data?.name) ?? "") && !tool.error) {
      hidden.add(tool.id);
      replaced.set(file.id, { ...file, durationMs: tool.durationMs });
    } else {
      hidden.add(file.id);
    }
  }
  return events.filter((e) => !hidden.has(e.id)).map((e) => replaced.get(e.id) ?? e);
}
