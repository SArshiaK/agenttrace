import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { hookScriptPath } from "./setup-cursor.js";

/** Native Grok Build events that map onto the Cursor timeline. */
export const GROK_HOOK_EVENTS = [
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

type GrokHookHandler = { type: "command"; command: string; timeout?: number };
type GrokHookGroup = { hooks: GrokHookHandler[] };
type GrokHooksFile = { hooks: Record<string, GrokHookGroup[]> };

export function grokHookCommand(scriptPath = hookScriptPath()): string {
  return `node "${scriptPath.replace(/\\/g, "/")}" --${MARKER} --source=grok`;
}

export async function setupGrokHooks(opts: { global?: boolean; projectDir?: string }): Promise<{
  file: string;
  command: string;
}> {
  const file = opts.global
    ? join(homedir(), ".grok", "hooks", "agenttrace.json")
    : join(resolve(opts.projectDir ?? process.cwd()), ".grok", "hooks", "agenttrace.json");

  const command = grokHookCommand();
  const config: GrokHooksFile = { hooks: {} };
  for (const event of GROK_HOOK_EVENTS) {
    config.hooks[event] = [{ hooks: [{ type: "command", command, timeout: 10 }] }];
  }

  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { file, command };
}
