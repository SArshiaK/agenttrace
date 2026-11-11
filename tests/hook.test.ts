import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TraceStore } from "../src/core/store";
import { summarizeRun } from "../src/core/insights";
import { handleCursorHook, hookResponse, mapCursorHook, runIdFor } from "../src/hook/cursor";
import { detectHookSource, normalizeHookInput } from "../src/hook/normalize";

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

  it("files each chat under its project folder", async () => {
    const store = await tempStore();
    await handleCursorHook(
      { conversation_id: "a", workspace_roots: ["D:\\work\\shop"], hook_event_name: "sessionStart" },
      store,
    );
    await handleCursorHook(
      { conversation_id: "b", workspace_roots: ["d:/work/blog/"], hook_event_name: "beforeSubmitPrompt", prompt: "hi" },
      store,
    );
    const projects = (await store.listRuns()).map((r) => r.project).sort();
    expect(projects).toEqual(["d:/work/blog", "d:/work/shop"]);
  });

  it("records an event once when Cursor runs the same hook twice", async () => {
    const store = await tempStore();
    const payload = {
      ...base,
      hook_event_name: "postToolUse",
      tool_name: "Shell",
      tool_input: { command: "npm test" },
      tool_output: "ok",
      duration: 900,
    };
    await Promise.all([
      handleCursorHook(payload, new TraceStore(store.home)),
      handleCursorHook(payload, new TraceStore(store.home)),
    ]);
    const events = await store.readEvents(runIdFor(base)!);
    expect(events.filter((e) => e.type === "tool.ended")).toHaveLength(1);
  });

  it("doesn't count files Cursor saves for itself as edits", () => {
    const [write] = mapCursorHook({
      ...base,
      hook_event_name: "afterFileEdit",
      file_path: "C:/Users/me/.cursor/projects/d-proj/agent-tools/7073e7cd.txt",
      edits: [{ old_string: "", new_string: "x".repeat(80_000) }],
    });
    expect(write?.data).toMatchObject({ estTokens: 0, harness: true });
  });

  it("ends the run on sessionEnd", async () => {
    const store = await tempStore();
    await handleCursorHook({ ...base, hook_event_name: "sessionStart" }, store);
    await handleCursorHook({ ...base, hook_event_name: "sessionEnd", reason: "completed" }, store);
    const [run] = await store.listRuns();
    expect(run?.status).toBe("ended");
  });
});

describe("Grok Build hooks", () => {
  it("normalizes Grok stdin into Cursor-shaped fields", () => {
    const input = normalizeHookInput({
      hookEventName: "post_tool_use",
      hook_event_name: "PostToolUse",
      sessionId: "sess-9",
      workspaceRoot: "D:/work/app",
      toolName: "run_terminal_command",
      toolInput: { command: "npm test", filePath: "D:/work/app/a.ts" },
      toolResult: "ok",
      durationMs: 42,
    });
    expect(input.hook_event_name).toBe("postToolUse");
    expect(input.conversation_id).toBe("sess-9");
    expect(input.workspace_roots).toEqual(["D:/work/app"]);
    expect(input.tool_name).toBe("Shell");
    expect(input.tool_input).toMatchObject({ command: "npm test", path: "D:/work/app/a.ts" });
    expect(input.tool_output).toBe("ok");
    expect(input.duration).toBe(42);
  });

  it("maps UserPromptSubmit and Stop with the final reply", () => {
    const [prompt] = mapCursorHook(
      normalizeHookInput({
        hook_event_name: "UserPromptSubmit",
        sessionId: "g1",
        workspaceRoot: "D:/proj",
        prompt: "ship it",
      }) as Parameters<typeof mapCursorHook>[0],
      "grok",
    );
    expect(prompt?.type).toBe("model.request");
    expect(prompt?.source).toBe("grok");

    const events = mapCursorHook(
      normalizeHookInput({
        hook_event_name: "Stop",
        sessionId: "g1",
        lastAssistantMessage: "done",
        status: "completed",
      }) as Parameters<typeof mapCursorHook>[0],
      "grok",
    );
    expect(events.map((e) => e.type)).toEqual(["model.response", "turn.ended"]);
    expect(events[0]?.data?.text).toBe("done");
  });

  it("detects Grok from env or argv", () => {
    expect(detectHookSource(["node", "hook.js"], {})).toBe("cursor");
    expect(detectHookSource(["node", "hook.js", "--source=grok"], {})).toBe("grok");
    expect(detectHookSource(["node", "hook.js"], { GROK_SESSION_ID: "abc" })).toBe("grok");
  });

  it("stores Grok chats under grok_ run ids", async () => {
    const store = await tempStore();
    const payload = normalizeHookInput({
      hook_event_name: "UserPromptSubmit",
      sessionId: "grok-conv",
      workspaceRoot: "D:/proj",
      prompt: "trace me",
    });
    await handleCursorHook(payload, store, "grok");
    const runId = runIdFor(payload, "grok");
    expect(runId).toBe("grok_grok-conv");
    const [run] = await store.listRuns();
    expect(run?.id).toBe(runId);
    expect(run?.source).toBe("grok");
    expect(run?.title).toBe("trace me");
  });
});

describe("Claude Code hooks", () => {
  it("normalizes Claude stdin into Cursor-shaped fields", () => {
    const input = normalizeHookInput({
      hook_event_name: "PostToolUse",
      session_id: "claude-sess",
      cwd: "D:/work/app",
      tool_name: "Bash",
      tool_input: { command: "npm test", file_path: "D:/work/app/a.ts" },
      tool_response: { stdout: "ok", stderr: "", interrupted: false },
      duration_ms: 88,
    });
    expect(input.hook_event_name).toBe("postToolUse");
    expect(input.conversation_id).toBe("claude-sess");
    expect(input.workspace_roots).toEqual(["D:/work/app"]);
    expect(input.tool_name).toBe("Shell");
    expect(input.tool_output).toEqual({ stdout: "ok", stderr: "", interrupted: false });
    expect(input.duration).toBe(88);
  });

  it("maps failures and Stop with last_assistant_message", () => {
    const [failure] = mapCursorHook(
      normalizeHookInput({
        hook_event_name: "PostToolUseFailure",
        session_id: "c1",
        cwd: "D:/proj",
        tool_name: "Bash",
        tool_input: { command: "exit 1" },
        error: "Exit code 1\nboom",
      }) as Parameters<typeof mapCursorHook>[0],
      "claude",
    );
    expect(failure?.error?.message).toContain("Exit code 1");
    expect(failure?.source).toBe("claude");

    const events = mapCursorHook(
      normalizeHookInput({
        hook_event_name: "Stop",
        session_id: "c1",
        last_assistant_message: "all set",
      }) as Parameters<typeof mapCursorHook>[0],
      "claude",
    );
    expect(events.map((e) => e.type)).toEqual(["model.response", "turn.ended"]);
    expect(events[0]?.data?.text).toBe("all set");
  });

  it("detects Claude from argv only (Cursor also sets CLAUDE_* env)", () => {
    expect(detectHookSource(["node", "hook.js", "--source=claude"], {})).toBe("claude");
    // Cursor Agent often exports Claude-compat env — must stay cursor without --source=claude.
    expect(detectHookSource(["node", "hook.js", "--agenttrace-hook"], { CLAUDE_PROJECT_DIR: "D:/proj" })).toBe(
      "cursor",
    );
    expect(detectHookSource(["node", "hook.js", "--source=cursor"], { CLAUDE_CODE_ENTRYPOINT: "cli" })).toBe(
      "cursor",
    );
  });

  it("stores Claude chats under claude_ run ids", async () => {
    const store = await tempStore();
    const payload = normalizeHookInput({
      hook_event_name: "UserPromptSubmit",
      session_id: "claude-conv",
      cwd: "D:/proj",
      prompt: "fix the flaky test",
    });
    await handleCursorHook(payload, store, "claude");
    const runId = runIdFor(payload, "claude");
    expect(runId).toBe("claude_claude-conv");
    const [run] = await store.listRuns();
    expect(run?.id).toBe(runId);
    expect(run?.source).toBe("claude");
    expect(run?.title).toBe("fix the flaky test");
  });
});
