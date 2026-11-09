#!/usr/bin/env node
/**
 * Cursor → agenttrace bridge.
 * Auto-logs session/tool/file events into ~/.agenttrace without the agent opting in.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const HOME = process.env.AGENTTRACE_HOME ?? join(homedir(), ".agenttrace");
const SESSIONS_PATH = join(HOME, "sessions.json");

function out(obj = {}) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

async function loadSessions() {
  try {
    return JSON.parse(await readFile(SESSIONS_PATH, "utf8"));
  } catch {
    return { version: 1, conversations: {} };
  }
}

async function saveSessions(sessions) {
  await mkdir(HOME, { recursive: true });
  await writeFile(SESSIONS_PATH, `${JSON.stringify(sessions, null, 2)}\n`, "utf8");
}

async function getStore() {
  const modPath = pathToFileURL(join(ROOT, "dist", "core", "index.js")).href;
  const mod = await import(modPath);
  return new mod.TraceStore(HOME);
}

function clip(value, max = 2000) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value ?? null);
  if (!text) return text;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function mapToolEvent(payload) {
  const name = String(payload.tool_name ?? "tool");
  const input = payload.tool_input ?? {};
  const durationMs =
    typeof payload.duration === "number" ? payload.duration : undefined;

  if (name === "Read" || name === "TabRead") {
    return {
      type: "file.read",
      title: input.path ?? input.file_path ?? name,
      data: {
        path: input.path ?? input.file_path,
        tool: name,
      },
      durationMs,
    };
  }

  if (name === "Write" || name === "StrReplace" || name === "Delete") {
    return {
      type: name === "Delete" ? "file.delete" : "file.write",
      title: input.path ?? name,
      data: {
        path: input.path,
        tool: name,
      },
      durationMs,
    };
  }

  if (name === "Shell") {
    return {
      type: "tool.ended",
      title: "shell",
      data: {
        name: "shell",
        args: { command: input.command },
        output: clip(payload.tool_output, 1200),
      },
      durationMs,
    };
  }

  if (name === "Grep" || name === "Glob") {
    return {
      type: "tool.ended",
      title: name.toLowerCase(),
      data: {
        name: name.toLowerCase(),
        args: input,
      },
      durationMs,
    };
  }

  return {
    type: "tool.ended",
    title: name,
    data: {
      name,
      args: input,
      output: clip(payload.tool_output, 800),
    },
    durationMs,
  };
}

async function ensureRun(store, conversationId, meta = {}) {
  const sessions = await loadSessions();
  const existing = sessions.conversations?.[conversationId];
  if (existing) {
    try {
      await store.getRun(existing);
      return existing;
    } catch {
      // stale mapping
    }
  }

  const titleBits = [
    "Cursor agent",
    meta.composer_mode ? `(${meta.composer_mode})` : null,
    conversationId ? conversationId.slice(0, 8) : null,
  ].filter(Boolean);

  const { run } = await store.startRun({
    title: titleBits.join(" "),
    source: "cursor-hook",
  });

  sessions.conversations = sessions.conversations ?? {};
  sessions.conversations[conversationId] = run.id;
  await saveSessions(sessions);
  return run.id;
}

async function main() {
  const payload = await readStdin();
  const eventName = payload.hook_event_name ?? payload.event ?? "";
  const conversationId =
    payload.conversation_id ?? payload.session_id ?? "unknown";

  try {
    const store = await getStore();
    await store.init();

    if (eventName === "sessionStart") {
      const runId = await ensureRun(store, conversationId, payload);
      out({
        env: { AGENTTRACE_RUN_ID: runId },
        additional_context:
          `agenttrace is recording this Cursor session as run ${runId}. Open with: npm start`,
      });
      return;
    }

    const runId = await ensureRun(store, conversationId, payload);

    if (eventName === "postToolUse") {
      const mapped = mapToolEvent(payload);
      await store.appendEvent({
        runId,
        source: "cursor-hook",
        ...mapped,
      });
      out({});
      return;
    }

    if (eventName === "postToolUseFailure") {
      await store.appendEvent({
        runId,
        type: "error",
        source: "cursor-hook",
        title: String(payload.tool_name ?? "tool failure"),
        data: {
          name: payload.tool_name,
          args: payload.tool_input,
          failureType: payload.failure_type,
        },
        durationMs:
          typeof payload.duration === "number" ? payload.duration : undefined,
        error: {
          message: String(payload.error_message ?? "tool failed"),
        },
      });
      out({});
      return;
    }

    if (eventName === "afterFileEdit") {
      await store.appendEvent({
        runId,
        type: "file.write",
        source: "cursor-hook",
        title: payload.file_path,
        data: {
          path: payload.file_path,
          edits: Array.isArray(payload.edits) ? payload.edits.length : undefined,
        },
      });
      out({});
      return;
    }

    if (eventName === "sessionEnd" || eventName === "stop") {
      const status =
        payload.reason === "error" || payload.status === "error"
          ? "error"
          : "ended";
      try {
        await store.endRun(runId, {
          status,
          source: "cursor-hook",
          data: {
            reason: payload.reason ?? payload.status,
            durationMs: payload.duration_ms,
          },
        });
      } catch {
        // already ended
      }
      const sessions = await loadSessions();
      if (sessions.conversations?.[conversationId]) {
        delete sessions.conversations[conversationId];
        await saveSessions(sessions);
      }
      out({});
      return;
    }

    out({});
  } catch (error) {
    // Never block the agent.
    console.error("[agenttrace-hook]", error);
    out({});
  }
}

main();
