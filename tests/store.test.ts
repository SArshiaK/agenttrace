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

  it("hides doubled hook events on read but keeps genuine repeats", async () => {
    const store = await tempStore();
    const { run } = await store.startRun({ title: "dupes", ts: "2026-01-01T10:00:00.000Z" });
    const read = { runId: run.id, type: "tool.ended", title: "Read: a.ts", data: { name: "Read", estTokens: 50 } };
    await store.appendEvent({ ...read, ts: "2026-01-01T10:00:01.000Z" });
    await store.appendEvent({ ...read, ts: "2026-01-01T10:00:01.060Z" });
    await store.appendEvent({ ...read, ts: "2026-01-01T10:00:30.000Z" });

    const events = await store.readEvents(run.id);
    expect(events.filter((e) => e.type === "tool.ended")).toHaveLength(2);
  });

  it("zeroes the estimate of files Cursor saved for itself in old traces", async () => {
    const store = await tempStore();
    const { run } = await store.startRun({ title: "harness" });
    await store.appendEvent({
      runId: run.id,
      type: "file.write",
      data: { path: "C:/Users/me/.cursor/projects/p/agent-tools/x.txt", addedChars: 81_031, estTokens: 20_258 },
    });
    const write = (await store.readEvents(run.id)).find((e) => e.type === "file.write");
    expect(write?.data).toMatchObject({ estTokens: 0, harness: true });
  });
});
