import { describe, expect, it } from "vitest";
import { groupTurns } from "../src/ui/lib/events";
import type { AgentTraceEvent } from "../src/core/schema";

const path = "src/ui/Timeline.tsx";
let n = 0;
function ev(type: string, ts: string, data: Record<string, unknown> = {}): AgentTraceEvent {
  return { id: `e${n++}`, runId: "r", ts: `2026-01-01T00:00:${ts}Z`, type, data };
}

describe("groupTurns", () => {
  it("pairs back-to-back edits of one file with the tool call that follows each edit", () => {
    const events = [
      ev("model.request", "40.000", { text: "edit it" }),
      ev("file.write", "50.000", { path }),
      ev("tool.ended", "52.067", { name: "Write", path }),
      ev("file.write", "55.234", { path }),
      ev("tool.ended", "57.294", { name: "Write", path }),
      ev("file.write", "59.486", { path }),
      ev("tool.ended", "59.999", { name: "Write", path }),
    ];
    const [turn] = groupTurns(events);
    expect(turn?.events.map((e) => e.type)).toEqual(["file.write", "file.write", "file.write"]);
    expect(turn?.events.every((e) => e.durationMs === undefined || typeof e.durationMs === "number")).toBe(true);
  });

  it("keeps the Read tool row and drops its file.read echo", () => {
    const events = [
      ev("model.request", "00.000", { text: "read it" }),
      ev("tool.ended", "01.000", { name: "Read", path }),
      ev("file.read", "01.001", { path }),
    ];
    const [turn] = groupTurns(events);
    expect(turn?.events.map((e) => e.type)).toEqual(["tool.ended"]);
  });
});
