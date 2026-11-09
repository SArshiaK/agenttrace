import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TraceStore } from "../src/core/store";
import { summarizeRun } from "../src/core/insights";
import { handleCursorHook, hookResponse, mapCursorHook, runIdFor } from "../src/hook/cursor";

const homes: string[] = [];

afterEach(async () => {
  await Promise.all(homes.splice(0).map((h) => rm(h, { recursive: true, force: true })));
});

async function tempStore(): Promise<TraceStore> {
  const home = await mkdtemp(join(tmpdir(), "agenttrace-hook-"));
  homes.push(home);
  return new TraceStore(home);
}

const base = { conversation_id: "conv-123", workspace_roots: ["D:/proj"], model: "test-model" };

describe("mapCursorHook", () => {
  it("maps a shell tool call with duration and token estimate", () => {
    const [event] = mapCursorHook({
      ...base,
      hook_event_name: "postToolUse",
      tool_name: "Shell",
      tool_input: { command: "npm test" },
      tool_output: "x".repeat(4000),
      duration: 1234,
    });
    expect(event?.type).toBe("tool.ended");
    expect(event?.title).toBe("Shell: npm test");
    expect(event?.durationMs).toBe(1234);
    expect(event?.data?.estTokens).toBeGreaterThanOrEqual(1000);
    expect(String(event?.data?.output).length).toBeLessThan(2100);
  });

  it("counts screenshots as images, not as base64 text", () => {
    const image = "iVBORw0KGgo" + "A".repeat(120_000);
    const [event] = mapCursorHook({
      ...base,
      hook_event_name: "postToolUse",
      tool_name: "MCP:browser_take_screenshot",
      tool_input: {},
      tool_output: JSON.stringify({ content: [{ type: "text", text: "ok" }, { type: "image", data: image }] }),
    });
    expect(event?.data?.images).toBe(1);
    expect(event?.data?.estTokens).toBeLessThan(1200);
    expect(String(event?.data?.output)).toContain("[binary");
  });

  it("redacts secrets in prompts", () => {
    const [event] = mapCursorHook({
      ...base,
      hook_event_name: "beforeSubmitPrompt",
      prompt: "use key sk-abcdefghijklmnopqrstuvwxyz123456 please",
    });
    expect(event?.type).toBe("model.request");
    expect(String(event?.data?.text)).not.toContain("abcdefghijklmnop");
  });

  it("records failures as errors and file edits relative to the workspace", () => {
    const [failure] = mapCursorHook({
      ...base,
      hook_event_name: "postToolUseFailure",
      tool_name: "Shell",
      tool_input: { command: "exit 1" },
      error_message: "boom",
    });
    expect(failure?.error?.message).toBe("boom");

    const [edit] = mapCursorHook({
      ...base,
      hook_event_name: "afterFileEdit",
      file_path: "D:/proj/src/a.ts",
      edits: [{ old_string: "a", new_string: "abc" }],
    });
    expect(edit?.type).toBe("file.write");
    expect(edit?.data?.path).toBe("src/a.ts");
  });

  it("only answers beforeSubmitPrompt with continue", () => {
    expect(hookResponse("beforeSubmitPrompt")).toEqual({ continue: true });
    expect(hookResponse("postToolUse")).toEqual({});
  });
});

describe("handleCursorHook", () => {
  it("survives parallel hooks: one run, every event kept, title from first prompt", async () => {
    const store = await tempStore();
    await handleCursorHook(
      { ...base, hook_event_name: "beforeSubmitPrompt", prompt: "Fix the flaky auth test" },
      store,
    );
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        handleCursorHook(
          {
            ...base,
            hook_event_name: "postToolUse",
            tool_name: "Read",
            tool_input: { path: `D:/proj/f${i}.ts` },
            tool_output: "content",
            duration: 5,
          },
          new TraceStore(store.home),
        ),
      ),
    );

    const runId = runIdFor(base)!;
    const events = await new TraceStore(store.home).readEvents(runId);
    expect(events.filter((e) => e.type === "run.started")).toHaveLength(1);
    expect(events.filter((e) => e.type === "tool.ended")).toHaveLength(20);

    const runs = await store.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]?.title).toBe("Fix the flaky auth test");
    expect(runs[0]?.status).toBe("running");

    const summary = summarizeRun(runs[0]!, events);
    expect(summary.stats.toolCount).toBe(20);
    expect(summary.stats.turnCount).toBe(1);
  });

  it("ends the run on sessionEnd", async () => {
    const store = await tempStore();
    await handleCursorHook({ ...base, hook_event_name: "sessionStart" }, store);
    await handleCursorHook({ ...base, hook_event_name: "sessionEnd", reason: "completed" }, store);
    const [run] = await store.listRuns();
    expect(run?.status).toBe("ended");
  });
});
