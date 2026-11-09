import type { AgentTraceEvent, RunMeta } from "./schema.js";

export type InsightFinding = {
  id: string;
  severity: "info" | "warn" | "error";
  title: string;
  detail: string;
};

export type TokenBreakdown = {
  total: number;
  prompts: number;
  responses: number;
  thinking: number;
  tools: number;
  edits: number;
};

export type HeavyStep = {
  eventId: string;
  type: string;
  title: string;
  estTokens: number;
};

export type RunStats = {
  durationMs: number | null;
  eventCount: number;
  toolCount: number;
  fileCount: number;
  modelCount: number;
  errorCount: number;
  turnCount: number;
  approxTokens: number | null;
  approxCostUsd: number | null;
  estTokens: TokenBreakdown;
  heaviestSteps: HeavyStep[];
  heaviestTools: Array<{ name: string; calls: number; estTokens: number; durationMs: number }>;
  contextPeak: { tokens: number; window: number | null; percent: number | null } | null;
  compactions: number;
  filesTouched: Array<{ path: string; count: number }>;
  longTools: Array<{ title: string; durationMs: number }>;
};

export type HealthItem = {
  id: "errors" | "loops" | "thrash" | "heavy" | "compactions";
  ok: boolean;
  label: string;
  count?: number;
};

export type RunSummary = {
  run: RunMeta;
  stats: RunStats;
  findings: InsightFinding[];
  health: HealthItem[];
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeArgs(args: unknown): string {
  try {
    return JSON.stringify(args ?? null);
  } catch {
    return String(args);
  }
}

/** Manual traces may log both started+ended per call; Cursor only logs ended. */
function toolCallEvents(events: AgentTraceEvent[]): AgentTraceEvent[] {
  const ended = events.filter((e) => e.type === "tool.ended");
  return ended.length ? ended : events.filter((e) => e.type === "tool.started");
}

export function toolCallKey(event: AgentTraceEvent): string {
  const name = asString(event.data?.name) ?? event.title ?? "tool";
  return `${name}::${normalizeArgs(event.data?.args ?? event.data?.input)}`;
}

export function computeStats(run: RunMeta, events: AgentTraceEvent[]): RunStats {
  const started = events.find((e) => e.type === "run.started");
  const ended = [...events].reverse().find((e) => e.type === "run.ended");
  let durationMs: number | null = null;
  if (started) {
    const endTs = ended?.ts ?? run.endedAt ?? run.updatedAt;
    durationMs = Math.max(0, Date.parse(endTs) - Date.parse(started.ts));
  }

  const fileMap = new Map<string, number>();
  const toolMap = new Map<string, { calls: number; estTokens: number; durationMs: number }>();
  const longTools: Array<{ title: string; durationMs: number }> = [];
  const heavy: HeavyStep[] = [];
  const est: TokenBreakdown = { total: 0, prompts: 0, responses: 0, thinking: 0, tools: 0, edits: 0 };
  let contextPeak: RunStats["contextPeak"] = null;
  let compactions = 0;
  let modelCount = 0;
  let errorCount = 0;
  let turnCount = 0;
  let tokens = 0;
  let cost = 0;
  let hasTokens = false;
  let hasCost = false;

  for (const event of events) {
    if (event.type.startsWith("model.")) modelCount += 1;
    if (event.type === "error" || event.error) errorCount += 1;
    if (event.type === "model.request") turnCount += 1;

    if (event.type.startsWith("file.")) {
      const path = asString(event.data?.path) ?? asString(event.data?.file) ?? event.title ?? "unknown";
      fileMap.set(path, (fileMap.get(path) ?? 0) + 1);
    }

    if (event.type === "tool.ended" && (event.durationMs ?? 0) >= 5000) {
      longTools.push({
        title: event.title ?? asString(event.data?.name) ?? "tool",
        durationMs: event.durationMs!,
      });
    }

    const estTokens = asNumber(event.data?.estTokens) ?? 0;
    if (estTokens > 0) {
      est.total += estTokens;
      if (event.type === "model.request") est.prompts += estTokens;
      else if (event.type === "model.response") est.responses += estTokens;
      else if (event.type === "model.thought") est.thinking += estTokens;
      else if (event.type.startsWith("tool.")) est.tools += estTokens;
      else if (event.type.startsWith("file.")) est.edits += estTokens;
      heavy.push({
        eventId: event.id,
        type: event.type,
        title: event.title ?? event.type,
        estTokens,
      });
    }

    if (event.type === "tool.ended") {
      const name = asString(event.data?.name) ?? "tool";
      const entry = toolMap.get(name) ?? { calls: 0, estTokens: 0, durationMs: 0 };
      entry.calls += 1;
      entry.estTokens += estTokens;
      entry.durationMs += event.durationMs ?? 0;
      toolMap.set(name, entry);
    }

    if (event.type === "context.compact") {
      compactions += 1;
      const ctx = asNumber(event.data?.contextTokens);
      if (ctx != null && (!contextPeak || ctx > contextPeak.tokens)) {
        contextPeak = {
          tokens: ctx,
          window: asNumber(event.data?.contextWindow) ?? null,
          percent: asNumber(event.data?.usagePercent) ?? null,
        };
      }
    }

    if (event.type === "model.response") {
      const t =
        asNumber(event.data?.tokens) ??
        asNumber(event.data?.totalTokens) ??
        ((asNumber(event.data?.inputTokens) ?? 0) + (asNumber(event.data?.outputTokens) ?? 0) ||
          undefined);
      if (t) {
        tokens += t;
        hasTokens = true;
      }
      const c = asNumber(event.data?.costUsd) ?? asNumber(event.data?.cost);
      if (c) {
        cost += c;
        hasCost = true;
      }
    }
  }

  const filesTouched = [...fileMap.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count);

  return {
    durationMs,
    eventCount: events.length,
    toolCount: toolCallEvents(events).length,
    fileCount: filesTouched.length,
    modelCount,
    errorCount,
    turnCount,
    approxTokens: hasTokens ? tokens : null,
    approxCostUsd: hasCost ? Number(cost.toFixed(6)) : null,
    estTokens: est,
    heaviestSteps: heavy.sort((a, b) => b.estTokens - a.estTokens).slice(0, 8),
    heaviestTools: [...toolMap.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.estTokens - a.estTokens)
      .slice(0, 8),
    contextPeak,
    compactions,
    filesTouched,
    longTools: longTools.sort((a, b) => b.durationMs - a.durationMs).slice(0, 5),
  };
}

export function detectInsights(events: AgentTraceEvent[]): InsightFinding[] {
  const findings: InsightFinding[] = [];

  const toolKeys = new Map<string, number>();
  for (const event of toolCallEvents(events)) {
    const key = toolCallKey(event);
    toolKeys.set(key, (toolKeys.get(key) ?? 0) + 1);
  }
  for (const [key, count] of toolKeys) {
    if (count >= 3) {
      const name = key.split("::")[0] ?? "tool";
      findings.push({
        id: `loop:${key}`,
        severity: "warn",
        title: "Likely tool loop",
        detail: `Tool "${name}" repeated with the same args ${count} times.`,
      });
    }
  }

  const writes = new Map<string, number>();
  for (const event of events) {
    if (event.type !== "file.write") continue;
    const path = asString(event.data?.path) ?? event.title ?? "file";
    writes.set(path, (writes.get(path) ?? 0) + 1);
  }
  for (const [path, count] of writes) {
    if (count >= 4) {
      findings.push({
        id: `thrash:${path}`,
        severity: "warn",
        title: "File thrash",
        detail: `"${path}" was rewritten ${count} times.`,
      });
    }
  }

  for (const event of events) {
    const estTokens = asNumber(event.data?.estTokens) ?? 0;
    if (event.type.startsWith("tool.") && estTokens >= 5000) {
      findings.push({
        id: `heavy:${event.id}`,
        severity: "warn",
        title: "Large tool output",
        detail: `${event.title ?? "tool"} pushed ~${Math.round(estTokens / 1000)}k tokens into context.`,
      });
    }

    if (event.type === "model.response" || event.type === "model.request") {
      const tokens =
        asNumber(event.data?.tokens) ??
        asNumber(event.data?.totalTokens) ??
        ((asNumber(event.data?.inputTokens) ?? 0) + (asNumber(event.data?.outputTokens) ?? 0) || 0);
      const latency = event.durationMs ?? asNumber(event.data?.latencyMs) ?? 0;
      if (tokens >= 8000 || latency >= 15000) {
        findings.push({
          id: `expensive:${event.id}`,
          severity: "info",
          title: "Expensive model call",
          detail: `${event.title ?? "model"} — ${tokens || "?"} tokens, ${latency || "?"}ms.`,
        });
      }
    }

    if (event.type === "context.compact") {
      const pct = asNumber(event.data?.usagePercent);
      const ctx = asNumber(event.data?.contextTokens);
      findings.push({
        id: `compact:${event.id}`,
        severity: "info",
        title: "Context compacted",
        detail: `Context hit ${pct ?? "?"}%${ctx ? ` (${ctx.toLocaleString("en-US")} tokens)` : ""}; older messages were summarized.`,
      });
    }
  }

  let streak = 0;
  let maxStreak = 0;
  for (const event of events) {
    if (event.type === "error" || event.error) {
      streak += 1;
      maxStreak = Math.max(maxStreak, streak);
    } else if (event.type !== "file.read") {
      streak = 0;
    }
  }
  if (maxStreak >= 3) {
    findings.push({
      id: "error-burst",
      severity: "error",
      title: "Error burst",
      detail: `Saw ${maxStreak} errors in a row.`,
    });
  }

  return findings;
}

export function buildHealth(
  stats: RunStats,
  findings: InsightFinding[],
): HealthItem[] {
  const hasLoop = findings.some((f) => f.id.startsWith("loop:"));
  const hasThrash = findings.some((f) => f.id.startsWith("thrash:"));
  const heavyCount = findings.filter((f) => f.id.startsWith("heavy:")).length;
  return [
    {
      id: "errors",
      count: stats.errorCount,
      ok: stats.errorCount === 0,
      label: stats.errorCount === 0 ? "No errors recorded" : `${stats.errorCount} error(s) recorded`,
    },
    { id: "loops", ok: !hasLoop, label: hasLoop ? "Possible tool loop detected" : "No obvious tool loops" },
    { id: "thrash", ok: !hasThrash, label: hasThrash ? "File rewrite thrash detected" : "File writes look stable" },
    {
      id: "heavy",
      count: heavyCount,
      ok: heavyCount === 0,
      label: heavyCount === 0 ? "No oversized tool outputs" : `${heavyCount} oversized tool output(s)`,
    },
    {
      id: "compactions",
      count: stats.compactions,
      ok: stats.compactions === 0,
      label: stats.compactions === 0 ? "Context never compacted" : `Context compacted ${stats.compactions}×`,
    },
  ];
}

export function summarizeRun(run: RunMeta, events: AgentTraceEvent[]): RunSummary {
  const stats = computeStats(run, events);
  const findings = detectInsights(events);
  const health = buildHealth(stats, findings);
  return { run, stats, findings, health };
}
