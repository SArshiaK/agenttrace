import { describe, expect, it } from "vitest";
import { detectInsights, summarizeRun } from "../src/core/insights";
import type { AgentTraceEvent, RunMeta } from "../src/core/schema";

const run: RunMeta = {
  id: "run_test",
  title: "test",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:01:00.000Z",
  eventCount: 0,
  status: "ended",
};

function evt(
  partial: Partial<AgentTraceEvent> & Pick<AgentTraceEvent, "type" | "id">,
): AgentTraceEvent {
  return {
    runId: run.id,
    ts: "2026-01-01T00:00:10.000Z",
    ...partial,
  };
}

describe("detectInsights", () => {
  it("flags repeated identical tool calls as loops", () => {
    const events = [1, 2, 3].flatMap((i) => [
      evt({
        id: `s${i}`,
        type: "tool.started",
        data: { name: "shell", args: { command: "npm test" } },
      }),
      evt({
        id: `e${i}`,
        type: "tool.ended",
        data: { name: "shell", args: { command: "npm test" } },
      }),
    ]);
    const findings = detectInsights(events);
    expect(findings.some((f) => f.id.startsWith("loop:"))).toBe(true);
  });

  it("flags file thrash", () => {
    const events = [1, 2, 3, 4].map((i) =>
      evt({
        id: `w${i}`,
        type: "file.write",
        data: { path: "src/a.ts" },
      }),
    );
    const findings = detectInsights(events);
    expect(findings.some((f) => f.id.startsWith("thrash:"))).toBe(true);
  });
});

describe("summarizeRun", () => {
  it("computes duration and health checklist", () => {
    const events: AgentTraceEvent[] = [
      evt({ id: "1", type: "run.started", ts: "2026-01-01T00:00:00.000Z" }),
      evt({
        id: "2",
        type: "model.response",
        ts: "2026-01-01T00:00:20.000Z",
        durationMs: 500,
        data: { totalTokens: 100, costUsd: 0.01 },
      }),
      evt({ id: "3", type: "run.ended", ts: "2026-01-01T00:00:30.000Z" }),
    ];
    const summary = summarizeRun(run, events);
    expect(summary.stats.durationMs).toBe(30000);
    expect(summary.stats.approxTokens).toBe(100);
    expect(summary.stats.approxCostUsd).toBe(0.01);
    expect(summary.health.length).toBeGreaterThan(0);
  });
});
