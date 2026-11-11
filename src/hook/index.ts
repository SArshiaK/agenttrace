import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { repairMojibake } from "../core/encoding.js";
import { getAgenttraceHome } from "../core/paths.js";
import { TraceStore } from "../core/store.js";
import { handleCursorHook, hookResponse } from "./cursor.js";
import { detectHookSource, normalizeHookInput } from "./normalize.js";

/**
 * Read hook stdin until end, or until it goes idle after the first byte.
 * A hard wall-clock timeout alone used to cut mid-JSON on large tool payloads
 * (Unterminated string → silent drop → "tracing stopped").
 */
function readStdin(opts: { firstByteMs?: number; idleMs?: number; maxMs?: number } = {}): Promise<string> {
  const firstByteMs = opts.firstByteMs ?? 5_000;
  const idleMs = opts.idleMs ?? 400;
  const maxMs = opts.maxMs ?? 25_000;
  return new Promise((resolve) => {
    let data = "";
    let settled = false;
    let idleTimer: NodeJS.Timeout | undefined;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(firstTimer);
      clearTimeout(maxTimer);
      if (idleTimer) clearTimeout(idleTimer);
      resolve(data);
    };
    const firstTimer = setTimeout(done, firstByteMs);
    const maxTimer = setTimeout(done, maxMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      clearTimeout(firstTimer);
      data += chunk;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(done, idleMs);
    });
    process.stdin.on("end", done);
    process.stdin.on("error", done);
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
  let raw = "";
  try {
    raw = repairMojibake((await readStdin()).replace(/^\uFEFF/, ""));
    const parsed = raw.trim() ? JSON.parse(raw) : {};
    const input = normalizeHookInput(
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {},
    );
    eventName = typeof input.hook_event_name === "string" ? input.hook_event_name : undefined;
    const source = detectHookSource();
    await handleCursorHook(input, new TraceStore(), source);
  } catch (error) {
    const preview =
      raw.length > 0
        ? ` rawChars=${raw.length} head=${JSON.stringify(raw.slice(0, 120))} tail=${JSON.stringify(raw.slice(-120))}`
        : " raw=<empty>";
    await logFailure(`${error instanceof Error ? error.stack ?? error.message : String(error)}${preview}`);
  }
  process.stdout.write(JSON.stringify(hookResponse(eventName)));
  process.exit(0);
}

main();
