import {
  access,
  appendFile,
  mkdir,
  open,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import {
  AgentTraceEventSchema,
  IndexSchema,
  type AgentTraceEvent,
  type RunMeta,
  type TraceIndex,
} from "./schema.js";
import { repairMojibake } from "./encoding.js";
import { IMAGE_TOKENS, estimateTokens } from "./redact.js";

const LEGACY_EDIT_TOOLS = new Set(["Write", "StrReplace", "EditNotebook", "Edit", "MultiEdit"]);
import { createId, createRunId } from "./ids.js";
import {
  getAgenttraceHome,
  getIndexPath,
  getRunPath,
  getRunsDir,
} from "./paths.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function emptyIndex(): TraceIndex {
  return { version: 1, currentRunId: null };
}

type AppendInput = {
  runId?: string;
  type: string;
  source?: string;
  title?: string;
  data?: Record<string, unknown>;
  durationMs?: number;
  error?: { message: string; stack?: string };
  id?: string;
  ts?: string;
};

function parseEvents(raw: string): AgentTraceEvent[] {
  const events: AgentTraceEvent[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      // Runs recorded before the hook repaired its input are fixed at read time.
      events.push(AgentTraceEventSchema.parse(JSON.parse(repairMojibake(line))));
    } catch {
      // a half-written trailing line or a corrupt line; skip it
    }
  }
  return events;
}

/**
 * Early hook versions estimated MCP screenshots by their base64 length. Large MCP outputs
 * without an `images` marker are almost always one screenshot plus a short text preview.
 */
function correctLegacyEstimates(event: AgentTraceEvent): AgentTraceEvent {
  const d = event.data;
  // Early edit events counted the whole resulting file; the diff size is what the model produced.
  if (event.type === "file.write" && d && d.estTokens === undefined) {
    const added = typeof d.addedChars === "number" ? d.addedChars : 0;
    const removed = typeof d.removedChars === "number" ? d.removedChars : 0;
    return { ...event, data: { ...d, estTokens: Math.ceil((added + removed) / 4) } };
  }
  if (
    event.type === "tool.ended" &&
    d &&
    typeof d.name === "string" &&
    LEGACY_EDIT_TOOLS.has(d.name) &&
    typeof (d.args as Record<string, unknown> | undefined)?.content === "string"
  ) {
    return { ...event, data: { ...d, estTokens: estimateTokens(typeof d.output === "string" ? d.output : "") } };
  }
  if (
    event.type !== "tool.ended" ||
    !d ||
    d.images !== undefined ||
    typeof d.name !== "string" ||
    !d.name.startsWith("MCP:") ||
    typeof d.outputChars !== "number" ||
    d.outputChars < 50_000 ||
    typeof d.estTokens !== "number"
  ) {
    return event;
  }
  return { ...event, data: { ...d, estTokens: Math.min(d.estTokens, IMAGE_TOKENS * 2.5), images: 1 } };
}

/** Cursor can fire afterAgentThought twice for the same block. */
function dropRepeatedThoughts(events: AgentTraceEvent[]): AgentTraceEvent[] {
  const lastSeen = new Map<string, number>();
  return events.filter((event) => {
    if (event.type !== "model.thought") return true;
    const text = typeof event.data?.text === "string" ? event.data.text : "";
    const ts = Date.parse(event.ts);
    const prev = lastSeen.get(text);
    lastSeen.set(text, ts);
    return prev === undefined || ts - prev > 30_000;
  });
}

export function deriveRunMeta(runId: string, events: AgentTraceEvent[]): RunMeta {
  const started = events.find((e) => e.type === "run.started");
  const ended = [...events].reverse().find((e) => e.type === "run.ended");
  const firstPrompt = events.find((e) => e.type === "model.request");
  const first = events[0];
  const last = events[events.length - 1];

  let title =
    (typeof started?.data?.title === "string" && started.data.title) ||
    started?.title ||
    "Untitled run";
  if (started?.data?.titleFromPrompt && typeof firstPrompt?.data?.text === "string") {
    const text = firstPrompt.data.text.replace(/\s+/g, " ").trim();
    if (text) title = text.length > 80 ? `${text.slice(0, 80)}\u2026` : text;
  }

  const endedStatus = ended?.data?.status === "error" ? "error" : "ended";
  // Chats recorded before projects were tracked pick theirs up from the next prompt.
  const projectSource =
    (typeof started?.data?.project === "string" && started.data.project) ||
    events.find((e) => typeof e.data?.workspace === "string")?.data?.workspace;
  return {
    id: runId,
    title,
    createdAt: started?.ts ?? first?.ts ?? new Date(0).toISOString(),
    updatedAt: last?.ts ?? started?.ts ?? new Date(0).toISOString(),
    endedAt: ended?.ts,
    source: started?.source,
    project: typeof projectSource === "string" ? normalizeProject(projectSource) : undefined,
    eventCount: events.length,
    status: ended ? endedStatus : "running",
  };
}

/** One key per folder regardless of slash style or drive-letter case. */
export function normalizeProject(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .replace(/^([A-Za-z]):/, (_, drive: string) => `${drive.toLowerCase()}:`);
}

export class TraceStore {
  readonly home: string;
  private cache = new Map<string, { mtimeMs: number; size: number; events: AgentTraceEvent[] }>();

  constructor(home = getAgenttraceHome()) {
    this.home = home;
  }

  async init(): Promise<{ home: string; created: boolean }> {
    const indexPath = getIndexPath(this.home);
    const created = !(await exists(indexPath));
    await mkdir(getRunsDir(this.home), { recursive: true });
    if (created) await this.writeIndex(emptyIndex());
    return { home: this.home, created };
  }

  async readIndex(): Promise<TraceIndex> {
    try {
      const raw = await readFile(getIndexPath(this.home), "utf8");
      if (!raw.trim()) return emptyIndex();
      const parsed = IndexSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : emptyIndex();
    } catch {
      return emptyIndex();
    }
  }

  async writeIndex(index: TraceIndex): Promise<void> {
    await mkdir(getRunsDir(this.home), { recursive: true });
    await writeFile(
      getIndexPath(this.home),
      `${JSON.stringify({ version: 1, currentRunId: index.currentRunId }, null, 2)}\n`,
      "utf8",
    );
  }

  async runExists(runId: string): Promise<boolean> {
    return exists(getRunPath(runId, this.home));
  }

  private async writeEvent(input: AppendInput & { runId: string }): Promise<AgentTraceEvent> {
    const event = AgentTraceEventSchema.parse({
      id: input.id ?? createId("evt"),
      runId: input.runId,
      ts: input.ts ?? new Date().toISOString(),
      type: input.type,
      source: input.source,
      title: input.title,
      data: input.data,
      durationMs: input.durationMs,
      error: input.error,
    });
    await appendFile(getRunPath(input.runId, this.home), `${JSON.stringify(event)}\n`, "utf8");
    return event;
  }

  async startRun(
    opts: {
      title?: string;
      source?: string;
      runId?: string;
      ts?: string;
      makeCurrent?: boolean;
      project?: string;
    } = {},
  ): Promise<{ run: RunMeta; event: AgentTraceEvent }> {
    await this.init();
    const runId = opts.runId ?? createRunId();
    const title = opts.title?.trim() || "Untitled run";
    const event = await this.writeEvent({
      runId,
      type: "run.started",
      source: opts.source ?? "cli",
      title,
      data: { title, ...(opts.project ? { project: opts.project } : {}) },
      ts: opts.ts,
    });
    if (opts.makeCurrent !== false) {
      await this.writeIndex({ ...(await this.readIndex()), currentRunId: runId });
    }
    return { run: deriveRunMeta(runId, [event]), event };
  }

  /**
   * Creates the run file exactly once even when several processes race
   * (Cursor fires hooks in parallel). Returns true for the process that created it.
   */
  async ensureRun(
    runId: string,
    opts: { title: string; source: string; data?: Record<string, unknown> },
  ): Promise<boolean> {
    await mkdir(getRunsDir(this.home), { recursive: true });
    let handle;
    try {
      handle = await open(getRunPath(runId, this.home), "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
    try {
      const event = AgentTraceEventSchema.parse({
        id: createId("evt"),
        runId,
        ts: new Date().toISOString(),
        type: "run.started",
        source: opts.source,
        title: opts.title,
        data: { title: opts.title, ...(opts.data ?? {}) },
      });
      await handle.write(`${JSON.stringify(event)}\n`);
    } finally {
      await handle.close();
    }
    return true;
  }

  async endRun(
    runId?: string,
    opts: {
      status?: "ended" | "error";
      source?: string;
      data?: Record<string, unknown>;
      ts?: string;
    } = {},
  ): Promise<{ run: RunMeta; event: AgentTraceEvent }> {
    const index = await this.readIndex();
    const id = runId ?? index.currentRunId;
    if (!id) throw new Error("No active run. Start one with `agenttrace start`.");
    if (!(await this.runExists(id))) throw new Error(`Run not found: ${id}`);

    const status = opts.status ?? "ended";
    await this.writeEvent({
      runId: id,
      type: "run.ended",
      source: opts.source ?? "cli",
      title: `Run ${status}`,
      data: { status, ...(opts.data ?? {}) },
      ts: opts.ts,
    });
    if (index.currentRunId === id) {
      await this.writeIndex({ ...index, currentRunId: null });
    }
    const events = await this.readEvents(id);
    return { run: deriveRunMeta(id, events), event: events[events.length - 1]! };
  }

  async appendEvent(input: AppendInput): Promise<AgentTraceEvent> {
    await this.init();
    const runId = input.runId ?? (await this.readIndex()).currentRunId;
    if (!runId) throw new Error("No active run. Pass --run or start a run first.");
    if (!(await this.runExists(runId))) throw new Error(`Run not found: ${runId}`);
    return this.writeEvent({ ...input, runId });
  }

  private async readRunFile(runId: string): Promise<AgentTraceEvent[]> {
    const path = getRunPath(runId, this.home);
    let info;
    try {
      info = await stat(path);
    } catch {
      return [];
    }
    const cached = this.cache.get(runId);
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) {
      return cached.events;
    }
    const events = dropRepeatedThoughts(parseEvents(await readFile(path, "utf8"))).map(
      correctLegacyEstimates,
    );
    this.cache.set(runId, { mtimeMs: info.mtimeMs, size: info.size, events });
    return events;
  }

  async listRuns(): Promise<RunMeta[]> {
    let files: string[];
    try {
      files = await readdir(getRunsDir(this.home));
    } catch {
      return [];
    }
    const runs = await Promise.all(
      files
        .filter((f) => f.endsWith(".jsonl"))
        .map(async (f) => {
          const id = f.slice(0, -".jsonl".length);
          return deriveRunMeta(id, await this.readRunFile(id));
        }),
    );
    return runs.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  async getRun(runId?: string): Promise<RunMeta> {
    const id = runId ?? (await this.readIndex()).currentRunId ?? (await this.listRuns())[0]?.id;
    if (!id) throw new Error("No runs found. Create one with `agenttrace start`.");
    if (!(await this.runExists(id))) throw new Error(`Run not found: ${id}`);
    return deriveRunMeta(id, await this.readRunFile(id));
  }

  async resolveRunId(runId?: string): Promise<string> {
    return (await this.getRun(runId)).id;
  }

  async readEvents(runId?: string): Promise<AgentTraceEvent[]> {
    return this.readRunFile(await this.resolveRunId(runId));
  }

  async status(): Promise<{
    home: string;
    currentRunId: string | null;
    runCount: number;
    current?: RunMeta;
  }> {
    await this.init();
    const index = await this.readIndex();
    const runs = await this.listRuns();
    return {
      home: this.home,
      currentRunId: index.currentRunId,
      runCount: runs.length,
      current: runs.find((r) => r.id === index.currentRunId),
    };
  }
}
