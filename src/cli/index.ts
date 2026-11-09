import { defineCommand, runMain } from "citty";
import { spawn } from "node:child_process";
import { TraceStore } from "../core/store.js";
import { summarizeRun } from "../core/insights.js";
import {
  eventsToJson,
  formatDuration,
  formatMoney,
  formatTokens,
  summaryToJson,
  summaryToMarkdown,
} from "../core/format.js";
import { openUi } from "./server.js";
import { dim, err, heading, ok, warn } from "./style.js";

function storeFromArgs(args: { home?: string }): TraceStore {
  return new TraceStore(args.home);
}

function printError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  console.error(err(message));
  process.exit(1);
}

const initCmd = defineCommand({
  meta: { name: "init", description: "Create ~/.agenttrace store" },
  args: {
    home: { type: "string", description: "Override AGENTTRACE_HOME" },
  },
  async run({ args }) {
    try {
      const store = storeFromArgs(args);
      const result = await store.init();
      console.log(
        ok(
          result.created
            ? `Initialized store at ${result.home}`
            : `Store already exists at ${result.home}`,
        ),
      );
    } catch (error) {
      printError(error);
    }
  },
});

const startCmd = defineCommand({
  meta: { name: "start", description: "Start a new traced run" },
  args: {
    title: { type: "string", description: "Run title", alias: "t" },
    source: { type: "string", description: "Source label", default: "cli" },
    home: { type: "string", description: "Override AGENTTRACE_HOME" },
  },
  async run({ args }) {
    try {
      const store = storeFromArgs(args);
      const { run } = await store.startRun({
        title: args.title,
        source: args.source,
      });
      console.log(ok(`Started ${run.id}`));
      console.log(dim(`title: ${run.title}`));
      console.log(dim(`store: ${store.home}`));
    } catch (error) {
      printError(error);
    }
  },
});

const eventCmd = defineCommand({
  meta: { name: "event", description: "Append a structured event" },
  args: {
    type: { type: "positional", description: "Event type", required: true },
    data: { type: "string", description: "JSON object payload", alias: "d" },
    text: {
      type: "string",
      description: "Plain text payload (PowerShell-friendly, becomes data.text)",
    },
    path: { type: "string", description: "File path helper (becomes data.path)" },
    name: { type: "string", description: "Tool/model name helper (becomes data.name)" },
    title: { type: "string", description: "Event title", alias: "t" },
    run: { type: "string", description: "Run id", alias: "r" },
    source: { type: "string", description: "Source label", default: "manual" },
    durationMs: { type: "string", description: "Duration in ms" },
    error: { type: "string", description: "Error message" },
    home: { type: "string", description: "Override AGENTTRACE_HOME" },
  },
  async run({ args }) {
    try {
      const store = storeFromArgs(args);
      let data: Record<string, unknown> | undefined;
      if (args.data) {
        const parsed = JSON.parse(args.data);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("--data must be a JSON object");
        }
        data = parsed as Record<string, unknown>;
      }
      if (args.text || args.path || args.name) {
        data = {
          ...(data ?? {}),
          ...(args.text ? { text: args.text } : {}),
          ...(args.path ? { path: args.path } : {}),
          ...(args.name ? { name: args.name } : {}),
        };
      }
      const event = await store.appendEvent({
        runId: args.run,
        type: String(args.type),
        title: args.title,
        source: args.source,
        data,
        durationMs: args.durationMs ? Number(args.durationMs) : undefined,
        error: args.error ? { message: args.error } : undefined,
      });
      console.log(ok(`Logged ${event.type} (${event.id})`));
    } catch (error) {
      printError(error);
    }
  },
});

const endCmd = defineCommand({
  meta: { name: "end", description: "End the current (or given) run" },
  args: {
    run: { type: "string", description: "Run id", alias: "r" },
    home: { type: "string", description: "Override AGENTTRACE_HOME" },
  },
  async run({ args }) {
    try {
      const store = storeFromArgs(args);
      const { run } = await store.endRun(args.run);
      console.log(ok(`Ended ${run.id} (${run.status})`));
    } catch (error) {
      printError(error);
    }
  },
});

const statusCmd = defineCommand({
  meta: { name: "status", description: "Show store / current run status" },
  args: {
    home: { type: "string", description: "Override AGENTTRACE_HOME" },
  },
  async run({ args }) {
    try {
      const store = storeFromArgs(args);
      const status = await store.status();
      console.log(heading("agenttrace status"));
      console.log(`home: ${status.home}`);
      console.log(`runs: ${status.runCount}`);
      console.log(`current: ${status.currentRunId ?? "none"}`);
      if (status.current) {
        console.log(dim(`  ${status.current.title} [${status.current.status}]`));
      }
    } catch (error) {
      printError(error);
    }
  },
});

const lsCmd = defineCommand({
  meta: { name: "ls", description: "List runs" },
  args: {
    home: { type: "string", description: "Override AGENTTRACE_HOME" },
  },
  async run({ args }) {
    try {
      const store = storeFromArgs(args);
      const runs = await store.listRuns();
      if (!runs.length) {
        console.log(warn("No runs yet. Try `agenttrace start`."));
        return;
      }
      for (const run of runs) {
        console.log(
          `${run.id}  ${run.status.padEnd(7)}  ${String(run.eventCount).padStart(4)} ev  ${run.title}`,
        );
      }
    } catch (error) {
      printError(error);
    }
  },
});

const summaryCmd = defineCommand({
  meta: { name: "summary", description: "Print run health summary" },
  args: {
    run: { type: "positional", description: "Run id", required: false },
    home: { type: "string", description: "Override AGENTTRACE_HOME" },
  },
  async run({ args }) {
    try {
      const store = storeFromArgs(args);
      const run = await store.getRun(args.run ? String(args.run) : undefined);
      const events = await store.readEvents(run.id);
      const summary = summarizeRun(run, events);
      console.log(heading(run.title));
      console.log(dim(run.id));
      console.log(
        [
          `duration ${formatDuration(summary.stats.durationMs)}`,
          `${summary.stats.eventCount} events`,
          `${summary.stats.toolCount} tools`,
          `${summary.stats.errorCount} errors`,
          `~${formatTokens(summary.stats.estTokens.total)} tokens into context (est.)`,
          `cost ${formatMoney(summary.stats.approxCostUsd)}`,
        ].join(" · "),
      );
      const est = summary.stats.estTokens;
      if (est.total > 0) {
        console.log("");
        console.log(heading("Where tokens went (estimate)"));
        console.log(
          `tools ~${formatTokens(est.tools)} · edits ~${formatTokens(est.edits)} · prompts ~${formatTokens(est.prompts)} · responses ~${formatTokens(est.responses)} · thinking ~${formatTokens(est.thinking)}`,
        );
        for (const step of summary.stats.heaviestSteps.slice(0, 5)) {
          console.log(dim(`  ~${formatTokens(step.estTokens).padStart(5)}  ${step.title}`));
        }
      }
      console.log("");
      console.log(heading("Run health"));
      for (const item of summary.health) {
        console.log(`${item.ok ? ok(item.label) : warn(item.label)}`);
      }
      if (summary.findings.length) {
        console.log("");
        console.log(heading("Findings"));
        for (const f of summary.findings) {
          console.log(`- [${f.severity}] ${f.title}: ${f.detail}`);
        }
      }
    } catch (error) {
      printError(error);
    }
  },
});

const exportCmd = defineCommand({
  meta: { name: "export", description: "Export a run as markdown or JSON" },
  args: {
    run: { type: "positional", description: "Run id", required: false },
    format: {
      type: "string",
      description: "md | json | events",
      default: "md",
      alias: "f",
    },
    home: { type: "string", description: "Override AGENTTRACE_HOME" },
  },
  async run({ args }) {
    try {
      const store = storeFromArgs(args);
      const run = await store.getRun(args.run ? String(args.run) : undefined);
      const events = await store.readEvents(run.id);
      const summary = summarizeRun(run, events);
      const format = (args.format ?? "md").toLowerCase();
      if (format === "md" || format === "markdown") {
        process.stdout.write(summaryToMarkdown(summary));
      } else if (format === "json") {
        process.stdout.write(summaryToJson(summary));
      } else if (format === "events") {
        process.stdout.write(eventsToJson(events));
      } else {
        throw new Error(`Unknown format: ${args.format}`);
      }
    } catch (error) {
      printError(error);
    }
  },
});

const openCmd = defineCommand({
  meta: { name: "open", description: "Open the local timeline UI" },
  args: {
    run: { type: "positional", description: "Run id", required: false },
    port: { type: "string", description: "Port", default: "7379" },
    home: { type: "string", description: "Override AGENTTRACE_HOME" },
    noOpen: { type: "boolean", description: "Do not launch a browser", default: false },
  },
  async run({ args }) {
    try {
      const { url } = await openUi({
        runId: args.run ? String(args.run) : undefined,
        port: Number(args.port),
        home: args.home,
      });
      console.log(ok(`Timeline UI at ${url}`));
      console.log(dim("Press Ctrl+C to stop."));
      if (!args.noOpen) {
        const platform = process.platform;
        const cmd =
          platform === "win32" ? "cmd" : platform === "darwin" ? "open" : "xdg-open";
        const cmdArgs = platform === "win32" ? ["/c", "start", "", url] : [url];
        spawn(cmd, cmdArgs, { stdio: "ignore", detached: true }).unref();
      }
      await new Promise(() => {});
    } catch (error) {
      printError(error);
    }
  },
});

const mcpCmd = defineCommand({
  meta: { name: "mcp", description: "Start the MCP server (stdio)" },
  args: {
    home: { type: "string", description: "Override AGENTTRACE_HOME" },
  },
  async run({ args }) {
    try {
      const { startMcpServer } = await import("../mcp/server.js");
      await startMcpServer(args.home);
    } catch (error) {
      printError(error);
    }
  },
});

const setupCursorCmd = defineCommand({
  meta: {
    name: "setup-cursor",
    description: "Install Cursor hooks so every chat is traced automatically",
  },
  args: {
    global: {
      type: "boolean",
      description: "Install for all projects (~/.cursor/hooks.json)",
      default: false,
    },
    dir: { type: "string", description: "Project directory (default: current)" },
  },
  async run({ args }) {
    try {
      const { setupCursorHooks, hookScriptPath } = await import("./setup-cursor.js");
      const { access } = await import("node:fs/promises");
      await access(hookScriptPath()).catch(() => {
        throw new Error("Hook script not built. Run `npm run build` first.");
      });
      const { file } = await setupCursorHooks({ global: args.global, projectDir: args.dir });
      console.log(ok(`Cursor hooks installed → ${file}`));
      console.log(dim("Send a new message in Cursor, then run `npm start` to watch it."));
      console.log(dim("Debug: Cursor Settings → Hooks, or ~/.agenttrace/hook-errors.log"));
    } catch (error) {
      printError(error);
    }
  },
});

const main = defineCommand({
  meta: {
    name: "agenttrace",
    description:
      "Observability for AI coding agents — inspect tools, files, loops, and cost.",
  },
  subCommands: {
    init: initCmd,
    start: startCmd,
    event: eventCmd,
    end: endCmd,
    status: statusCmd,
    ls: lsCmd,
    summary: summaryCmd,
    export: exportCmd,
    open: openCmd,
    mcp: mcpCmd,
    "setup-cursor": setupCursorCmd,
  },
});

runMain(main);
