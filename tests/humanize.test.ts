import { describe, expect, it } from "vitest";
import { humanRow, pagesOf } from "../src/ui/lib/humanize";
import type { AgentTraceEvent } from "../src/core/schema";

function tool(name: string, args: Record<string, unknown>, extra: Partial<AgentTraceEvent> = {}): AgentTraceEvent {
  return { id: "e", runId: "r", ts: "2026-01-01T00:00:00Z", type: "tool.ended", data: { name, args }, ...extra };
}

describe("humanRow", () => {
  it("describes chained shell commands in plain words", () => {
    expect(humanRow(tool("Shell", { command: "npm run typecheck; npm test; npm run build" })).text).toBe(
      "Checked the code for mistakes, ran the tests and built the project",
    );
    expect(humanRow(tool("Shell", { command: "whoami" })).text).toBe("Ran a command");
  });

  it("names files by their basename", () => {
    const row = humanRow(tool("Read", { path: "src/ui/App.tsx" }, { data: { name: "Read", path: "src/ui/App.tsx" } }));
    expect(row.text).toBe("Read App.tsx");
    expect(row.sub).toBe("in src/ui");
  });

  it("explains browser and failed steps", () => {
    expect(humanRow(tool("MCP:browser_take_screenshot", {})).text).toBe("Took a screenshot");
    const failed = humanRow(tool("Shell", { command: "npm test" }, { error: { message: "exit 1" } }));
    expect(failed.text).toBe("Ran the tests, but it didn't work");
    expect(failed.sub).toBe("exit 1");
  });
});

describe("pagesOf", () => {
  it("turns tokens into pages", () => {
    expect(pagesOf(100)).toBe("less than a page");
    expect(pagesOf(1300)).toBe("about 2 pages");
    expect(pagesOf(65_000)).toBe("about 100 pages");
  });
});
