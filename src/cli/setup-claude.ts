import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { hookScriptPath } from "./setup-cursor.js";

/** Claude Code events that map onto the Cursor timeline. */
export const CLAUDE_HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PostToolUse",
  "PostToolUseFailure",
  "PreCompact",
  "Stop",
  "StopFailure",
] as const;

const MARKER = "agenttrace-hook";

type ClaudeHookHandler = { type: "command"; command: string; timeout?: number };
type ClaudeHookGroup = { matcher?: string; hooks: ClaudeHookHandler[] };
type ClaudeSettings = {
  hooks?: Record<string, ClaudeHookGroup[]>;
  [key: string]: unknown;
};

export function claudeHookCommand(scriptPath = hookScriptPath()): string {
  return `node "${scriptPath.replace(/\\/g, "/")}" --${MARKER} --source=claude`;
}

function isOurHook(group: ClaudeHookGroup): boolean {
  return (group.hooks ?? []).some((h) => String(h.command ?? "").includes(MARKER));
}

export async function setupClaudeHooks(opts: { global?: boolean; projectDir?: string }): Promise<{
  file: string;
  command: string;
}> {
  const file = opts.global
    ? join(homedir(), ".claude", "settings.json")
    : join(resolve(opts.projectDir ?? process.cwd()), ".claude", "settings.json");

  let settings: ClaudeSettings = {};
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      settings = parsed as ClaudeSettings;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`Could not parse ${file}; fix or move it, then rerun.`);
    }
  }

  const command = claudeHookCommand();
  const hooks: Record<string, ClaudeHookGroup[]> = { ...(settings.hooks ?? {}) };
  for (const event of CLAUDE_HOOK_EVENTS) {
    const others = (hooks[event] ?? []).filter((group) => !isOurHook(group));
    // SessionEnd has a tight budget in Claude Code; keep our observer fast.
    const timeout = event === "SessionEnd" ? 5 : 10;
    hooks[event] = [...others, { hooks: [{ type: "command", command, timeout }] }];
  }

  const next: ClaudeSettings = { ...settings, hooks };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { file, command };
}
