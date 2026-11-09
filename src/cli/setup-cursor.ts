import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CURSOR_HOOK_EVENTS = [
  "sessionStart",
  "sessionEnd",
  "beforeSubmitPrompt",
  "postToolUse",
  "postToolUseFailure",
  "afterFileEdit",
  "afterAgentResponse",
  "afterAgentThought",
  "preCompact",
  "stop",
] as const;

const MARKER = "agenttrace-hook";

type HookEntry = { command: string; timeout?: number; [key: string]: unknown };
type HooksFile = { version: number; hooks: Record<string, HookEntry[]> };

export function hookScriptPath(): string {
  // This module may be bundled into dist/cli/ or into a shared chunk at dist/.
  const candidates = ["../hook/index.js", "./hook/index.js"].map((p) =>
    fileURLToPath(new URL(p, import.meta.url)),
  );
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

export function hookCommand(scriptPath = hookScriptPath()): string {
  // `node` + quoted forward-slash path runs the same under PowerShell, cmd, and sh.
  return `node "${scriptPath.replace(/\\/g, "/")}" --${MARKER}`;
}

export async function setupCursorHooks(opts: { global?: boolean; projectDir?: string }): Promise<{
  file: string;
  command: string;
}> {
  const file = opts.global
    ? join(homedir(), ".cursor", "hooks.json")
    : join(resolve(opts.projectDir ?? process.cwd()), ".cursor", "hooks.json");

  let config: HooksFile = { version: 1, hooks: {} };
  try {
    const parsed = JSON.parse(await readFile(file, "utf8"));
    if (parsed && typeof parsed === "object") {
      config = { version: parsed.version ?? 1, hooks: parsed.hooks ?? {} };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new Error(`Could not parse ${file}; fix or move it, then rerun.`);
    }
  }

  const command = hookCommand();
  for (const event of CURSOR_HOOK_EVENTS) {
    const others = (config.hooks[event] ?? []).filter((h) => !String(h.command).includes(MARKER));
    config.hooks[event] = [...others, { command, timeout: 10 }];
  }

  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { file, command };
}
