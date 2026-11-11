import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, constants as fsConstants } from "node:fs";
import { access, copyFile, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";
import { TraceStore } from "../core/store.js";
import { estimateTokens } from "../core/redact.js";

/** How to launch the Cursor Agent CLI without Windows .cmd shell quirks. */
type AgentInvoke = {
  command: string;
  prefixArgs: string[];
  /** Path shown in UI / status (usually the agent.cmd shim). */
  displayPath: string;
};

export type ChatRequest = {
  prompt: string;
  project: string;
  /** Existing agenttrace run id (`cursor_<session>`). Continues that CLI session when possible. */
  runId?: string;
};

export type ChatStart = {
  runId: string;
  sessionId: string;
  pid: number;
};

type Json = Record<string, unknown>;

const active = new Map<string, ChildProcess>();

function sessionFromRunId(runId: string): string {
  return runId.startsWith("cursor_") ? runId.slice("cursor_".length) : runId;
}

function runIdFromSession(sessionId: string): string {
  return `cursor_${String(sessionId).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64)}`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.X_OK);
    return true;
  } catch {
    try {
      await access(path, fsConstants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

function agentPathEnv(): NodeJS.ProcessEnv {
  const home = homedir();
  return {
    ...process.env,
    PATH: [
      join(home, ".local", "bin"),
      join(home, ".cursor", "bin"),
      join(process.env.LOCALAPPDATA ?? "", "cursor-agent"),
      process.env.PATH ?? "",
    ]
      .filter(Boolean)
      .join(delimiter),
  };
}

/** Windows cannot spawn .cmd/.bat/.ps1 without a shell (Node EINVAL). */
function needsWindowsShell(command: string): boolean {
  if (process.platform !== "win32") return false;
  const base = command.replace(/^"|"$/g, "").toLowerCase();
  return (
    base === "agent" ||
    base === "agent.cmd" ||
    base.endsWith(".cmd") ||
    base.endsWith(".bat") ||
    base.endsWith(".ps1")
  );
}

function runCaptured(
  command: string,
  args: string[],
  opts: { shell?: boolean; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        env: opts.env ?? agentPathEnv(),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: opts.shell ?? needsWindowsShell(command),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      resolve({ code: 1, stdout: "", stderr: message });
      return;
    }
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolve({ code: null, stdout, stderr: stderr || "Timed out" });
    }, opts.timeoutMs ?? 120_000);
    child.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString("utf8");
      if (stdout.length > 20_000) stdout = stdout.slice(-20_000);
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString("utf8");
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * On Windows the public `agent.cmd` shim cannot be spawned without a shell
 * (Node EINVAL), and shell+args is unsafe for user prompts. Prefer the real
 * versions/<ver>/node.exe + index.js entry instead.
 */
async function resolveWindowsAgentNode(): Promise<AgentInvoke | null> {
  const local = process.env.LOCALAPPDATA ?? "";
  if (!local) return null;
  const versionsRoot = join(local, "cursor-agent", "versions");
  try {
    const entries = await readdir(versionsRoot, { withFileTypes: true });
    const names = entries
      .filter((e) => e.isDirectory() && /^\d{4}\.\d{1,2}\.\d{1,2}/.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const name of names) {
      const node = join(versionsRoot, name, "node.exe");
      const entry = join(versionsRoot, name, "index.js");
      if ((await fileExists(node)) && (await fileExists(entry))) {
        const shim = join(local, "cursor-agent", "agent.cmd");
        return {
          command: node,
          prefixArgs: [entry],
          displayPath: (await fileExists(shim)) ? shim : node,
        };
      }
    }
  } catch {
    // not installed yet
  }
  return null;
}

async function resolveAgentInvoke(): Promise<AgentInvoke | null> {
  const env = process.env.AGENTTRACE_CURSOR_AGENT ?? process.env.CURSOR_AGENT;
  if (env && (await fileExists(env))) {
    return { command: env, prefixArgs: [], displayPath: env };
  }

  if (process.platform === "win32") {
    const win = await resolveWindowsAgentNode();
    if (win) return win;
  }

  const home = homedir();
  const candidates = [
    join(home, ".local", "bin", "agent"),
    join(home, ".local", "bin", "agent.exe"),
    join(home, ".cursor", "bin", "agent"),
    join(home, ".cursor", "bin", "agent.exe"),
    join(process.env.LOCALAPPDATA ?? "", "cursor-agent", "agent.exe"),
    join(process.env.LOCALAPPDATA ?? "", "cursor-agent", "agent.cmd"),
    join(process.env.LOCALAPPDATA ?? "", "Programs", "cursor", "resources", "app", "bin", "agent.exe"),
  ].filter(Boolean);

  for (const path of candidates) {
    if (await fileExists(path)) {
      return { command: path, prefixArgs: [], displayPath: path };
    }
  }

  const probe = process.platform === "win32" ? "agent.cmd" : "agent";
  const version = await runCaptured(probe, ["--version"], { timeoutMs: 12_000 });
  if (version.code === 0) {
    return { command: probe, prefixArgs: [], displayPath: probe };
  }
  return null;
}

/** Resolve the Cursor Agent CLI binary (`agent`). */
export async function resolveAgentBinary(): Promise<string | null> {
  const invoke = await resolveAgentInvoke();
  return invoke?.displayPath ?? null;
}

export type AgentCliStatus = {
  available: boolean;
  loggedIn: boolean;
  path: string | null;
  version: string | null;
  account: string | null;
  install: string;
};

export async function agentCliStatus(): Promise<AgentCliStatus> {
  const install = "https://cursor.com/docs/cli/installation";
  const invoke = await resolveAgentInvoke();
  if (!invoke) {
    return { available: false, loggedIn: false, path: null, version: null, account: null, install };
  }

  const version = await runCaptured(invoke.command, [...invoke.prefixArgs, "--version"], {
    timeoutMs: 20_000,
  });
  if (version.code !== 0) {
    return {
      available: false,
      loggedIn: false,
      path: invoke.displayPath,
      version: null,
      account: null,
      install,
    };
  }

  const who = await runCaptured(invoke.command, [...invoke.prefixArgs, "status"], {
    timeoutMs: 20_000,
  });
  const out = `${who.stdout}\n${who.stderr}`.trim();
  const loggedOut = /not logged|unauthenticated|log in|login required|no account/i.test(out);
  // `agent status` prints "Not logged in" with exit 0 — treat that as logged out.
  const loggedIn = who.code === 0 && !loggedOut && out.length > 0;
  const accountMatch = out.match(/(?:logged in as|account|user|email)[:\s]+(\S+)/i);

  return {
    available: true,
    loggedIn,
    path: invoke.displayPath,
    version: version.stdout.trim().split(/\r?\n/)[0] ?? null,
    account: accountMatch?.[1] ?? (loggedIn ? out.split(/\r?\n/)[0]?.trim() ?? null : null),
    install,
  };
}

function runStreaming(
  command: string,
  args: string[],
  opts: {
    shell?: boolean;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    onLog?: (line: string) => void;
  } = {},
): Promise<{ code: number | null; log: string }> {
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        env: opts.env ?? agentPathEnv(),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        shell: opts.shell ?? needsWindowsShell(command),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      opts.onLog?.(`[error] ${message}`);
      resolve({ code: 1, log: message });
      return;
    }
    const lines: string[] = [];
    const emit = (chunk: Buffer, stream: "out" | "err") => {
      const text = chunk.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const prefixed = stream === "err" ? `[stderr] ${line}` : line;
        lines.push(prefixed);
        opts.onLog?.(prefixed);
      }
    };
    const timer = setTimeout(() => {
      opts.onLog?.("[agenttrace] Timed out — stopping process.");
      try {
        child.kill();
      } catch {
        // ignore
      }
      resolve({ code: null, log: lines.join("\n") });
    }, opts.timeoutMs ?? 300_000);

    child.stdout?.on("data", (c: Buffer) => emit(c, "out"));
    child.stderr?.on("data", (c: Buffer) => emit(c, "err"));
    child.on("error", (err) => {
      clearTimeout(timer);
      opts.onLog?.(`[error] ${err.message}`);
      resolve({ code: 1, log: [...lines, err.message].join("\n") });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, log: lines.join("\n") });
    });
  });
}

async function downloadToFile(
  url: string,
  dest: string,
  onLog: (line: string) => void,
): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed (${res.status}) for ${url}`);
  }
  const total = Number(res.headers.get("content-length") || 0);
  if (total) onLog(`[agenttrace] Package size ~${Math.round(total / 1_000_000)}MB`);

  const file = createWriteStream(dest);
  const reader = res.body.getReader();
  let got = 0;
  let lastPct = -1;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.byteLength;
      if (total > 0) {
        const pct = Math.min(100, Math.floor((got / total) * 100));
        if (pct >= lastPct + 5 || pct === 100) {
          lastPct = pct;
          onLog(`[agenttrace] Download ${pct}%`);
        }
      } else if (got === value.byteLength || got % (5 * 1024 * 1024) < value.byteLength) {
        onLog(`[agenttrace] Downloaded ${Math.round(got / 1_000_000)}MB…`);
      }
      await new Promise<void>((resolve, reject) => {
        file.write(Buffer.from(value), (err: Error | null | undefined) =>
          err ? reject(err) : resolve(),
        );
      });
    }
    await new Promise<void>((resolve, reject) => {
      file.end((err: Error | null | undefined) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    file.destroy();
    await rm(dest, { force: true }).catch(() => undefined);
    throw err;
  }
}

async function runTarExtract(zipPath: string, outDir: string): Promise<void> {
  const tar =
    process.env.SYSTEMROOT != null
      ? join(process.env.SYSTEMROOT, "System32", "tar.exe")
      : "tar";
  const result = await runCaptured(tar, ["-xf", zipPath, "-C", outDir], { timeoutMs: 180_000 });
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `tar extract failed (${result.code})`);
  }
}

/** Windows install without Cursor's wipe script (avoids locked-zip / Remove-Item failures). */
async function installCursorAgentWindows(onLog: (line: string) => void): Promise<string> {
  const local = process.env.LOCALAPPDATA;
  if (!local) throw new Error("LOCALAPPDATA is not set.");

  const agentRoot = join(local, "cursor-agent");
  const versionsRoot = join(agentRoot, "versions");

  onLog("[agenttrace] Fetching Cursor Windows install metadata…");
  const scriptRes = await fetch("https://cursor.com/install?win32=true");
  if (!scriptRes.ok) throw new Error(`Could not fetch installer script (${scriptRes.status})`);
  const script = await scriptRes.text();
  const urlPrefix = script.match(/\$downloadUrl\s*=\s*'([^']+)'/)?.[1];
  const version = script.match(/\$version\s*=\s*'([^']+)'/)?.[1];
  if (!urlPrefix || !version) {
    throw new Error("Could not parse Cursor install script (downloadUrl/version).");
  }

  const arch = process.arch === "arm64" ? "arm64" : "x64";
  const zipUrl = `${urlPrefix}windows/${arch}/agent-cli-package.zip`;
  onLog(`[agenttrace] Version ${version} (${arch})`);

  await mkdir(versionsRoot, { recursive: true });
  // Drop leftover partial zips from failed official installs.
  try {
    for (const name of await readdir(versionsRoot)) {
      if (name.endsWith(".zip") || name.startsWith("extract-")) {
        await rm(join(versionsRoot, name), { recursive: true, force: true }).catch(() => undefined);
      }
    }
  } catch {
    // ignore
  }

  const zipPath = join(tmpdir(), `agenttrace-agent-${version}.zip`);
  const extractDir = join(tmpdir(), `agenttrace-agent-extract-${Date.now()}`);
  const finalDir = join(versionsRoot, version);

  try {
    onLog(`[agenttrace] Downloading ${zipUrl}`);
    await downloadToFile(zipUrl, zipPath, onLog);
    onLog("[agenttrace] Extracting package…");
    await mkdir(extractDir, { recursive: true });
    await runTarExtract(zipPath, extractDir);

    const packaged = join(extractDir, "dist-package");
    if (!(await fileExists(packaged))) {
      throw new Error("Zip did not contain dist-package/");
    }

    await rm(finalDir, { recursive: true, force: true }).catch(() => undefined);
    // Node has no fs.rename across drives reliably for dirs — copy via tar already extracted; use spawn move.
    const moved = await runCaptured("cmd.exe", ["/c", "move", "/Y", packaged, finalDir], {
      timeoutMs: 60_000,
    });
    if (moved.code !== 0 || !(await fileExists(join(finalDir, "index.js")))) {
      // Fallback: copy file-by-file using PowerShell if move failed (e.g. cross-volume).
      const copied = await runCaptured(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `Copy-Item -LiteralPath '${packaged.replace(/'/g, "''")}' -Destination '${finalDir.replace(/'/g, "''")}' -Recurse -Force`,
        ],
        { timeoutMs: 120_000 },
      );
      if (copied.code !== 0 || !(await fileExists(join(finalDir, "index.js")))) {
        throw new Error(moved.stderr || copied.stderr || "Failed to place agent package.");
      }
    }

    onLog("[agenttrace] Writing agent shims…");
    for (const name of await readdir(finalDir)) {
      if (!name.startsWith("cursor-agent")) continue;
      await copyFile(join(finalDir, name), join(agentRoot, name));
    }
    // Primary aliases used by docs / our resolver.
    for (const [from, to] of [
      ["cursor-agent.cmd", "agent.cmd"],
      ["cursor-agent.ps1", "agent.ps1"],
      ["cursor-agent.exe", "agent.exe"],
    ] as const) {
      const src = join(agentRoot, from);
      if (await fileExists(src)) await copyFile(src, join(agentRoot, to));
    }

    // Ensure a usable .cmd even if package layout changes.
    if (!(await fileExists(join(agentRoot, "agent.cmd")))) {
      await writeFile(
        join(agentRoot, "agent.cmd"),
        [
          "@echo off",
          "setlocal",
          'set "SCRIPT_DIR=%~dp0"',
          'if "%SCRIPT_DIR:~-1%"=="\\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"',
          `%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%\\cursor-agent.ps1" %*`,
          "",
        ].join("\r\n"),
        "utf8",
      );
    }

    if (!(await fileExists(join(finalDir, "node.exe"))) || !(await fileExists(join(finalDir, "index.js")))) {
      throw new Error("Install incomplete: node.exe/index.js missing in version folder.");
    }

    onLog(`[agenttrace] Installed to ${agentRoot}`);
    return join(agentRoot, "agent.cmd");
  } finally {
    await rm(zipPath, { force: true }).catch(() => undefined);
    await rm(extractDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Download + install the Cursor Agent CLI for this OS. */
export async function installCursorAgent(
  onLog?: (line: string) => void,
): Promise<{ ok: boolean; path: string | null; log: string }> {
  const lines: string[] = [];
  const log = (line: string) => {
    lines.push(line);
    onLog?.(line);
  };

  // Already present? Don't wipe / re-download.
  const existing = await resolveAgentInvoke();
  if (existing) {
    const version = await runCaptured(existing.command, [...existing.prefixArgs, "--version"], {
      timeoutMs: 20_000,
    });
    if (version.code === 0) {
      log(`[agenttrace] Already installed: ${existing.displayPath}`);
      log(`[agenttrace] ${version.stdout.trim().split(/\r?\n/)[0] ?? "ok"}`);
      return { ok: true, path: existing.displayPath, log: lines.join("\n") };
    }
  }

  if (process.platform === "win32") {
    try {
      const path = await installCursorAgentWindows(log);
      const again = await resolveAgentInvoke();
      if (!again) throw new Error("Install finished but agent binary was not detected.");
      log("[agenttrace] Install OK.");
      return { ok: true, path: again.displayPath ?? path, log: lines.join("\n") };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log(`[agenttrace] ${message}`);
      throw new Error(message);
    }
  }

  log("[agenttrace] Running curl | bash installer…");
  const result = await runStreaming("bash", ["-lc", "curl https://cursor.com/install -fsS | bash"], {
    timeoutMs: 300_000,
    onLog: log,
  });
  log(`[agenttrace] Installer exited with code ${result.code ?? "timeout"}`);
  const path = await resolveAgentBinary();
  if (path) log(`[agenttrace] Found: ${path}`);
  const ok = Boolean(path) && (result.code === 0 || Boolean(path));
  if (!ok) throw new Error(result.log || "Cursor Agent CLI install failed.");
  log("[agenttrace] Install OK.");
  return { ok: true, path, log: lines.join("\n") };
}

/**
 * Start `agent login` (opens the browser). Resolves when the process exits
 * or after we detect a successful status check.
 */
export async function loginCursorAgent(
  onLog?: (line: string) => void,
): Promise<{ ok: boolean; account: string | null; log: string }> {
  const log = (line: string) => onLog?.(line);
  const invoke = await resolveAgentInvoke();
  if (!invoke) {
    throw new Error("Install the Cursor Agent CLI first.");
  }

  log(`[agenttrace] Using ${invoke.displayPath}`);
  log("[agenttrace] Starting `agent login` — a browser window should open.");
  const login = await runStreaming(invoke.command, [...invoke.prefixArgs, "login"], {
    timeoutMs: 300_000,
    onLog: log,
  });
  log(`[agenttrace] login exited with code ${login.code ?? "timeout"}`);
  log("[agenttrace] Checking account status…");
  const status = await agentCliStatus();
  if (!status.loggedIn) {
    throw new Error(login.log || "Login did not complete. Finish in the browser, then try again.");
  }
  log(`[agenttrace] Logged in${status.account ? ` as ${status.account}` : ""}.`);
  return { ok: true, account: status.account, log: login.log };
}

/** @deprecated Prefer agentCliStatus() */
export async function agentCliAvailable(): Promise<{ available: boolean; path: string | null }> {
  const status = await agentCliStatus();
  return { available: status.available, path: status.path };
}

function textFromMessage(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const content = (message as Json).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const p = part as Json;
      return typeof p.text === "string" ? p.text : "";
    })
    .filter(Boolean)
    .join("");
}

function toolName(toolCall: Json | undefined): string {
  if (!toolCall) return "Tool";
  if (toolCall.readToolCall) return "Read";
  if (toolCall.writeToolCall) return "Write";
  if (toolCall.function && typeof toolCall.function === "object") {
    const name = (toolCall.function as Json).name;
    if (typeof name === "string") return name;
  }
  const key = Object.keys(toolCall).find((k) => k.endsWith("ToolCall")) ?? Object.keys(toolCall)[0];
  return key?.replace(/ToolCall$/i, "") || "Tool";
}

function toolCallPayload(toolCall: Json | undefined): Json | undefined {
  if (!toolCall) return undefined;
  for (const [key, value] of Object.entries(toolCall)) {
    if (key.endsWith("ToolCall") && value && typeof value === "object" && !Array.isArray(value)) {
      return value as Json;
    }
  }
  return undefined;
}

function toolArgs(toolCall: Json | undefined): Record<string, unknown> {
  if (!toolCall) return {};
  const payload = toolCallPayload(toolCall);
  if (payload?.args && typeof payload.args === "object" && !Array.isArray(payload.args)) {
    return payload.args as Record<string, unknown>;
  }
  if (toolCall.function && typeof toolCall.function === "object") {
    const args = (toolCall.function as Json).arguments;
    if (typeof args === "string") {
      try {
        return JSON.parse(args) as Record<string, unknown>;
      } catch {
        return { arguments: args };
      }
    }
    if (args && typeof args === "object") return args as Record<string, unknown>;
  }
  return {};
}

function toolResult(toolCall: Json | undefined): unknown {
  if (!toolCall) return undefined;
  const payload = toolCallPayload(toolCall);
  if (payload && "result" in payload) return payload.result;
  return undefined;
}

function toolTitle(name: string, args: Record<string, unknown>): string {
  if (typeof args.command === "string" && args.command.trim()) return args.command.trim();
  if (typeof args.path === "string" && args.path.trim()) return args.path.trim();
  if (typeof args.pattern === "string" && args.pattern.trim()) return args.pattern.trim();
  return name;
}

async function ingestLine(
  store: TraceStore,
  runId: string,
  project: string,
  line: string,
  startedAt: Map<string, number>,
): Promise<void> {
  let raw: Json;
  try {
    raw = JSON.parse(line) as Json;
  } catch {
    return;
  }

  const type = String(raw.type ?? "");
  const sessionId = typeof raw.session_id === "string" ? raw.session_id : undefined;

  if (type === "system" && raw.subtype === "init" && sessionId) {
    const title = "CLI chat";
    await store.ensureRun(runId, {
      title,
      source: "cursor",
      data: { title, project, conversationId: sessionId, via: "cursor-cli" },
    });
    return;
  }

  if (type === "user") {
    const text = textFromMessage(raw.message);
    await store.appendEvent({
      runId,
      type: "model.request",
      source: "cursor",
      title: "You",
      data: { text, chars: text.length, estTokens: estimateTokens(text), via: "cursor-cli" },
    });
    return;
  }

  if (type === "assistant") {
    // Skip duplicate flushes when streaming partials aren't enabled; still safe.
    if (raw.model_call_id != null) return;
    const text = textFromMessage(raw.message);
    if (!text.trim()) return;
    await store.appendEvent({
      runId,
      type: "model.response",
      source: "cursor",
      title: "Assistant",
      data: { text, chars: text.length, estTokens: estimateTokens(text), via: "cursor-cli" },
    });
    return;
  }

  if (type === "tool_call") {
    const subtype = String(raw.subtype ?? "");
    const callId = typeof raw.call_id === "string" ? raw.call_id : createFallbackId();
    const toolCall = (raw.tool_call as Json | undefined) ?? undefined;
    const name = toolName(toolCall);
    const args = toolArgs(toolCall);

    if (subtype === "started") {
      startedAt.set(callId, Date.now());
      if (name === "Read" && typeof args.path === "string") {
        await store.appendEvent({
          runId,
          type: "file.read",
          source: "cursor",
          title: args.path,
          data: { path: args.path, toolCallId: callId, via: "cursor-cli" },
        });
        return;
      }
      if (name === "Write" && typeof args.path === "string") {
        await store.appendEvent({
          runId,
          type: "file.write",
          source: "cursor",
          title: args.path,
          data: {
            path: args.path,
            toolCallId: callId,
            content: typeof args.fileText === "string" ? args.fileText.slice(0, 4000) : undefined,
            via: "cursor-cli",
          },
        });
        return;
      }
      await store.appendEvent({
        runId,
        type: "tool.started",
        source: "cursor",
        title: toolTitle(name, args),
        data: { name, arguments: args, args, toolCallId: callId, via: "cursor-cli" },
      });
      return;
    }

    if (subtype === "completed") {
      const started = startedAt.get(callId);
      startedAt.delete(callId);
      const durationMs = started ? Math.max(0, Date.now() - started) : undefined;
      const result = toolResult(toolCall);
      if (name === "Read" || name === "Write") {
        // file.* already recorded on start; optional note with duration.
        if (durationMs != null) {
          await store.appendEvent({
            runId,
            type: "note",
            source: "cursor",
            title: `${name} done`,
            durationMs,
            data: { toolCallId: callId, name, via: "cursor-cli" },
          });
        }
        return;
      }
      const output =
        typeof result === "string"
          ? result
          : result != null
            ? JSON.stringify(result).slice(0, 4000)
            : undefined;
      await store.appendEvent({
        runId,
        type: "tool.ended",
        source: "cursor",
        title: name,
        durationMs,
        data: {
          name,
          arguments: args,
          output,
          estTokens: estimateTokens(output),
          toolCallId: callId,
          via: "cursor-cli",
        },
      });
    }
    return;
  }

  if (type === "result") {
    const ok = raw.is_error !== true && raw.subtype !== "error";
    await store.appendEvent({
      runId,
      type: "turn.ended",
      source: "cursor",
      title: ok ? "Turn ended" : "Turn error",
      durationMs: typeof raw.duration_ms === "number" ? raw.duration_ms : undefined,
      data: {
        status: ok ? "completed" : "error",
        via: "cursor-cli",
        result: typeof raw.result === "string" ? raw.result.slice(0, 2000) : undefined,
      },
      error: ok ? undefined : { message: typeof raw.result === "string" ? raw.result : "Agent failed" },
    });
  }
}

function createFallbackId(): string {
  return `call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Start a Cursor CLI agent turn and stream events into the local store.
 * Resolves once the session id is known (system init / first event).
 */
/**
 * Cursor / remote hooks often emit workspace paths like `/d:/projects/foo`
 * or `/mnt/d/projects/foo`. Normalize those to a real Windows path.
 */
function normalizeProjectPath(project: string): string {
  let folder = project.trim().replace(/\\/g, "/");
  if (!folder) return folder;

  // `/d:/foo` or `/D:/foo` → `D:/foo`
  const driveSlash = folder.match(/^\/([A-Za-z]):(\/.*)?$/);
  if (driveSlash) {
    folder = `${driveSlash[1].toUpperCase()}:${driveSlash[2] ?? "/"}`;
  }

  // WSL: `/mnt/d/foo` → `D:/foo`
  const wsl = folder.match(/^\/mnt\/([A-Za-z])(\/.*)?$/);
  if (wsl) {
    folder = `${wsl[1].toUpperCase()}:${wsl[2] ?? "/"}`;
  }

  if (process.platform === "win32") {
    return folder.replace(/\//g, "\\");
  }
  return folder;
}

async function resolveExistingProjectDir(project: string): Promise<string> {
  const raw = project.trim();
  if (!raw) throw new Error("Project folder is required.");
  const candidates = [normalizeProjectPath(raw), raw].filter(
    (v, i, arr) => v && arr.indexOf(v) === i,
  );

  let lastErr: unknown;
  for (const folder of candidates) {
    try {
      const st = await stat(folder);
      if (!st.isDirectory()) {
        throw new Error(`Project path is not a folder: ${folder}`);
      }
      return folder;
    } catch (err) {
      lastErr = err;
      const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
      if (code !== "ENOENT") {
        throw err instanceof Error ? err : new Error(String(err));
      }
    }
  }

  const code =
    lastErr && typeof lastErr === "object" && "code" in lastErr
      ? String((lastErr as { code?: string }).code)
      : "";
  if (code === "ENOENT") {
    throw new Error(
      `Project folder does not exist: ${raw}. Pick a real absolute path (e.g. D:\\projects\\my-app) and try again.`,
    );
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function startCursorChat(
  store: TraceStore,
  req: ChatRequest,
): Promise<ChatStart> {
  const prompt = req.prompt.trim();
  if (!prompt) throw new Error("Prompt is empty.");
  const project = await resolveExistingProjectDir(req.project ?? "");

  const invoke = await resolveAgentInvoke();
  if (!invoke) {
    throw new Error(
      "Cursor Agent CLI not found. Install it (https://cursor.com/docs/cli/overview), then restart agenttrace.",
    );
  }
  // Verify the real node/binary still exists (stale resolve after a wiped install).
  if (!(await fileExists(invoke.command))) {
    throw new Error(
      `Cursor Agent binary missing: ${invoke.command}. Click Install again, then retry.`,
    );
  }

  const resumeSession = req.runId ? sessionFromRunId(req.runId) : undefined;
  let runId = req.runId ?? "";
  let sessionId = resumeSession ?? "";
  if (runId && active.has(runId)) {
    throw new Error("This chat already has an agent run in progress.");
  }

  const args = [
    ...invoke.prefixArgs,
    "-p",
    "--force",
    "--trust",
    "--output-format",
    "stream-json",
    "--workspace",
    project,
  ];
  if (resumeSession) {
    args.push("--resume", resumeSession);
  }
  args.push(prompt);

  let child: ChildProcess;
  try {
    child = spawn(invoke.command, args, {
      cwd: project,
      env: agentPathEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: needsWindowsShell(invoke.command),
    });
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : String(err));
  }

  if (runId) active.set(runId, child);

  const startedAt = new Map<string, number>();
  let settled = false;

  const ready = new Promise<ChatStart>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          child.kill();
        } catch {
          // ignore
        }
        reject(new Error("Timed out waiting for Cursor Agent to start. Is `agent` installed and logged in?"));
      }
    }, 45_000);

    const finish = (value: ChatStart) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    };

    child.on("error", (err) => {
      if (runId) active.delete(runId);
      fail(
        new Error(
          err.code === "ENOENT"
            ? `Failed to start agent (ENOENT). Usually the project folder is missing: ${project}`
            : `Failed to start Cursor Agent CLI (${invoke.displayPath}): ${err.message}`,
        ),
      );
    });

    // Resume path: we already know the session; unlock the UI immediately.
    if (runId && sessionId) {
      void store
        .ensureRun(runId, {
          title: prompt.slice(0, 80) || "CLI chat",
          source: "cursor",
          data: { title: prompt.slice(0, 80), project, conversationId: sessionId, via: "cursor-cli" },
        })
        .then(() => finish({ runId, sessionId, pid: child.pid ?? 0 }))
        .catch((err) => fail(err instanceof Error ? err : new Error(String(err))));
    }

    if (!child.stdout) {
      fail(new Error("Cursor Agent CLI produced no stdout pipe."));
      return;
    }
    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      void (async () => {
        try {
          let parsed: Json | null = null;
          try {
            parsed = JSON.parse(line) as Json;
          } catch {
            return;
          }
          if (!sessionId && typeof parsed.session_id === "string") {
            sessionId = parsed.session_id;
            runId = runIdFromSession(sessionId);
            active.set(runId, child);
            await store.ensureRun(runId, {
              title: prompt.slice(0, 80) || "CLI chat",
              source: "cursor",
              data: {
                title: prompt.slice(0, 80),
                project,
                conversationId: sessionId,
                via: "cursor-cli",
              },
            });
            finish({ runId, sessionId, pid: child.pid ?? 0 });
          }

          if (runId) {
            await ingestLine(store, runId, project, line, startedAt);
          }
        } catch (err) {
          // Keep the agent running; surface ingest errors on stderr of the server process.
          console.error("[agenttrace] ingest failed:", err);
        }
      })();
    });

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });

    child.on("close", (code) => {
      if (runId) active.delete(runId);
      if (!settled) {
        fail(
          new Error(
            `Cursor Agent exited before starting (code ${code}). ${stderr.trim() || "No stderr."}`,
          ),
        );
      }
    });
  });

  return ready;
}

export function agentBusy(runId: string): boolean {
  return active.has(runId);
}

/** Stop a running in-panel Cursor Agent process (and its Windows process tree). */
export function stopCursorChat(runId: string): { stopped: boolean } {
  const child = active.get(runId);
  if (!child) return { stopped: false };
  const pid = child.pid;
  active.delete(runId);
  try {
    if (process.platform === "win32" && pid) {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      child.kill("SIGTERM");
      setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }, 1500);
    }
  } catch {
    try {
      child.kill();
    } catch {
      // ignore
    }
  }
  return { stopped: true };
}
