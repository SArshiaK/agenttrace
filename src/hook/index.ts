import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { repairMojibake } from "../core/encoding.js";
import { getAgenttraceHome } from "../core/paths.js";
import { handleCursorHook, hookResponse } from "./cursor.js";

function readStdin(timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    const timer = setTimeout(() => resolve(data), timeoutMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => {
      clearTimeout(timer);
      resolve(data);
    });
    process.stdin.on("error", () => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function logFailure(error: unknown): Promise<void> {
  try {
    const home = getAgenttraceHome();
    await mkdir(home, { recursive: true });
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    await appendFile(join(home, "hook-errors.log"), `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch {
    // never let logging break the agent
  }
}

async function main() {
  let eventName: string | undefined;
  try {
    const raw = repairMojibake((await readStdin(3000)).replace(/^\uFEFF/, ""));
    const input = raw.trim() ? JSON.parse(raw) : {};
    eventName = input.hook_event_name;
    await handleCursorHook(input);
  } catch (error) {
    await logFailure(error);
  }
  process.stdout.write(JSON.stringify(hookResponse(eventName)));
  process.exit(0);
}

main();
