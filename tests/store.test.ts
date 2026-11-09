import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TraceStore } from "../src/core/store";
import { summarizeRun } from "../src/core/insights";

const homes: string[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((h) => rm(h, { recursive: true, force: true })));
});

async function tempStore(): Promise<TraceStore> {
  const home = await mkdtemp(join(tmpdir(), "agenttrace-"));
  homes.push(home);
  return new TraceStore(home);
}

describe("TraceStore", () => {
  it("starts, logs, lists, and summarizes a run", async () => {
    const store = await tempStore();
    const { run } = await store.startRun({ title: "unit run", source: "test" });
    await store.appendEvent({
      runId: run.id,
      type: "tool.started",
      title: "rg",
      data: { name: "rg", args: { pattern: "foo" } },
    });
    await store.appendEvent({
      runId: run.id,
      type: "file.read",
      data: { path: "src/index.ts" },
    });
    await store.endRun(run.id);

    const listed = await store.listRuns();
    expect(listed[0]?.id).toBe(run.id);

    const events = await store.readEvents(run.id);
    expect(events.some((e) => e.type === "run.started")).toBe(true);
    expect(events.some((e) => e.type === "run.ended")).toBe(true);

    const fresh = await store.getRun(run.id);
    const summary = summarizeRun(fresh, events);
    expect(summary.stats.eventCount).toBe(events.length);
    expect(summary.stats.fileCount).toBe(1);
  });
});
