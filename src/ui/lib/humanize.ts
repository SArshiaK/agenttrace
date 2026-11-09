import type { AgentTraceEvent, RunSummary } from "../types";
import type { FilterKey, Kind } from "./events";
import { estTokens, kindOf, str } from "./events";
import { formatTokens } from "./format";

export type Mode = "technical" | "muggle";

type Finding = RunSummary["findings"][number];
type Health = RunSummary["health"][number];

function basename(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function folder(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 1 ? parts.slice(-3, -1).join("/") : "";
}

function oneLine(text: string, max = 140): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

function joinPlain(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const COMMAND_INTENTS: Array<[RegExp, string]> = [
  [/\b(npm|pnpm|yarn|bun)\s+(i|install|add|ci)\b|\bpip\s+install\b/, "installed packages"],
  [/\btypecheck\b|\btsc\b/, "checked the code for mistakes"],
  [/\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\bvitest\b|\bjest\b|\bpytest\b/, "ran the tests"],
  [/\b(npm|pnpm|yarn|bun)\s+run\s+build\b|\bvite\s+build\b|\btsup\b/, "built the project"],
  [/\b(npm\s+start|npm\s+run\s+dev)\b|\bopen\s+--port\b/, "started the app"],
  [/^\s*git\b|[;&|]\s*git\b/, "used git"],
  [/\bstop-process\b|\bkill\b|\btaskkill\b/, "stopped a running program"],
  [/\bget-childitem\b|\bls\b|\bdir\b|\btest-path\b/, "looked around the folders"],
  [/\bget-content\b|\bcat\b|\bselect-string\b|\brg\b|\bgrep\b/, "looked inside files"],
  [/\bnode\s+-v\b|\bnpm\s+-v\b|\bnpm\s+view\b/, "checked installed versions"],
];

function describeCommand(command: string): string {
  const c = command.toLowerCase();
  const intents = COMMAND_INTENTS.filter(([re]) => re.test(c)).map(([, label]) => label);
  if (!intents.length) return "Ran a command";
  const text = joinPlain([...new Set(intents)].slice(0, 3));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const BROWSER_ACTIONS: Record<string, string> = {
  browser_navigate: "Opened a web page",
  browser_take_screenshot: "Took a screenshot",
  browser_click: "Clicked something on the page",
  browser_snapshot: "Read the page",
  browser_cdp: "Inspected the page",
  browser_type: "Typed on the page",
  browser_fill: "Filled in a form",
  browser_scroll: "Scrolled the page",
  browser_tabs: "Checked the browser tabs",
  browser_press_key: "Pressed a key on the page",
};

/** Friendly name for a tool, used in "what it used most". */
export function humanToolName(name: string): string {
  if (name.startsWith("MCP:")) {
    const tool = name.slice(4);
    if (tool.startsWith("browser_")) return "Browser";
    return `External tool (${tool})`;
  }
  switch (name) {
    case "Shell":
      return "Terminal";
    case "Read":
      return "Reading files";
    case "Write":
    case "StrReplace":
    case "EditNotebook":
      return "Editing files";
    case "Delete":
      return "Deleting files";
    case "Grep":
    case "Glob":
    case "SemanticSearch":
      return "Searching the code";
    case "Task":
      return "Helper agents";
    default:
      return name;
  }
}

/** One plain sentence per event, plus an optional quiet second line. */
export function humanRow(event: AgentTraceEvent): { text: string; sub?: string } {
  const d = event.data ?? {};
  const kind = kindOf(event);
  const name = str(d.name) ?? "";
  const path = str(d.path);
  const args = (d.args ?? {}) as Record<string, unknown>;

  if (kind === "error") {
    const what = name ? humanRow({ ...event, error: undefined }).text : "Something";
    return {
      text: name ? `${what}, but it didn't work` : "Something went wrong",
      sub: oneLine(event.error?.message ?? event.title ?? "", 120),
    };
  }

  if (d.harness) {
    return { text: "Cursor saved a large result to a file", sub: "for the assistant to look through later" };
  }

  switch (kind) {
    case "prompt":
      return { text: "You sent a message", sub: oneLine(str(d.text) ?? "") };
    case "response":
      return { text: "Replied to you", sub: oneLine(str(d.text) ?? "") };
    case "thought":
      return { text: "Thought about what to do next", sub: oneLine(str(d.text) ?? "") };
    case "compact":
      return {
        text: "Its memory filled up, so it summarized older messages",
        sub: typeof d.usagePercent === "number" ? `It was ${d.usagePercent}% full` : undefined,
      };
    case "note":
      return { text: event.title ?? "Left a note", sub: oneLine(str(d.text) ?? "") };
    case "file": {
      const file = path ? basename(path) : "a file";
      const where = path ? folder(path) : "";
      if (event.type === "file.write") return { text: `Edited ${file}`, sub: where ? `in ${where}` : undefined };
      if (event.type === "file.delete") return { text: `Deleted ${file}`, sub: where ? `in ${where}` : undefined };
      return { text: `Read ${file}`, sub: where ? `in ${where}` : undefined };
    }
    case "tool": {
      if (name.startsWith("MCP:")) {
        const tool = name.slice(4);
        return { text: BROWSER_ACTIONS[tool] ?? `Used an external tool (${tool})` };
      }
      const file = path ? basename(path) : undefined;
      const where = path ? folder(path) : "";
      switch (name) {
        case "Shell":
          return { text: describeCommand(str(args.command) ?? event.title ?? "") };
        case "Read":
          return { text: `Read ${file ?? "a file"}`, sub: where ? `in ${where}` : undefined };
        case "Write":
        case "StrReplace":
        case "EditNotebook":
          return { text: `Edited ${file ?? "a file"}`, sub: where ? `in ${where}` : undefined };
        case "Delete":
          return { text: `Deleted ${file ?? "a file"}` };
        case "Grep":
        case "SemanticSearch":
          return { text: "Searched the code", sub: str(args.pattern) ?? str(args.query) };
        case "Glob":
          return { text: "Looked for files", sub: str(args.glob_pattern) };
        case "Task":
          return { text: "Handed a task to a helper", sub: str(args.description) };
        default:
          return { text: `Used ${name || "a tool"}` };
      }
    }
    default:
      return { text: event.title ?? event.type };
  }
}

export type Effort = "light" | "medium" | "heavy";

export function effortOf(tokens: number): Effort {
  if (tokens >= 2000) return "heavy";
  if (tokens >= 300) return "medium";
  return "light";
}

/** ~650 tokens ≈ one page of text (≈500 words). */
export function pagesOf(tokens: number): string {
  const pages = tokens / 650;
  if (pages < 1) return "less than a page";
  if (pages < 10) return `about ${pages.toFixed(1).replace(/\.0$/, "")} pages`;
  return `about ${Math.round(pages)} pages`;
}

/** Compact form for cards and chips: "< 1 page", "≈ 2.5 pages". */
export function pagesShort(tokens: number): string {
  return tokens < 650 ? "< 1 page" : pagesOf(tokens).replace("about ", "≈ ");
}

export const MUGGLE_FILTERS: Record<FilterKey, string> = {
  all: "Everything",
  heavy: "Costly",
  tools: "Actions",
  files: "Files",
  model: "Thinking & replies",
  errors: "Problems",
};

export const MUGGLE_TOKEN_LABELS: Partial<Record<Kind, string>> = {
  tool: "Reading results",
  file: "Writing code",
  response: "Replying",
  thought: "Thinking",
  prompt: "Your messages",
};

export function humanHealth(item: Health): string {
  const n = item.count ?? 0;
  switch (item.id) {
    case "errors":
      return item.ok ? "No problems so far" : `Ran into ${n} problem${n === 1 ? "" : "s"}`;
    case "loops":
      return item.ok ? "Didn't get stuck repeating itself" : "Repeated the same action over and over";
    case "thrash":
      return item.ok ? "File edits look normal" : "Kept rewriting the same file";
    case "heavy":
      return item.ok ? "Never read a huge amount at once" : `Read a huge amount at once ${n}×`;
    case "compactions":
      return item.ok ? "Its memory never filled up" : `Its memory filled up ${n}×`;
    default:
      return item.label;
  }
}

export function humanFinding(finding: Finding): { title: string; detail: string } {
  const count = finding.detail.match(/(\d+) times/)?.[1];
  if (finding.id.startsWith("loop:")) {
    const tool = finding.id.slice(5).split("::")[0] ?? "";
    return {
      title: "Repeated itself",
      detail: `It did the same thing (${humanToolName(tool).toLowerCase()}) ${count ?? "several"} times with the same input.`,
    };
  }
  if (finding.id.startsWith("thrash:")) {
    return {
      title: "Kept rewriting a file",
      detail: `${basename(finding.id.slice(7))} was changed ${count ?? "many"} times.`,
    };
  }
  if (finding.id.startsWith("heavy:")) {
    const k = finding.detail.match(/~(\d+)k/)?.[1];
    return {
      title: "Read a lot at once",
      detail: k ? `One step pulled in ${pagesOf(Number(k) * 1000)} of text.` : finding.detail,
    };
  }
  if (finding.id.startsWith("compact:")) {
    return { title: "Memory filled up", detail: "It had to summarize older parts of the conversation to keep going." };
  }
  if (finding.id === "error-burst") {
    return { title: "Several problems in a row", detail: "A few steps failed one after another." };
  }
  if (finding.id.startsWith("expensive:")) {
    return { title: "A slow or costly reply", detail: finding.detail };
  }
  return { title: finding.title, detail: finding.detail };
}

export function effortLabel(event: AgentTraceEvent): string | undefined {
  const tokens = estTokens(event);
  if (!tokens) return undefined;
  return `${effortOf(tokens)} · ${pagesOf(tokens)} (~${formatTokens(tokens)} tokens)`;
}
