import { createServer, type IncomingMessage } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TraceStore } from "../core/store.js";
import { summarizeRun } from "../core/insights.js";
import {
  agentBusy,
  agentCliStatus,
  installCursorAgent,
  loginCursorAgent,
  startCursorChat,
  stopCursorChat,
} from "./cursor-agent.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

function contentType(filePath: string): string {
  switch (extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".json":
      return "application/json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

async function findUiRoot(): Promise<string> {
  const candidates = [
    join(__dirname, "../ui"),
    join(__dirname, "../../dist/ui"),
    join(process.cwd(), "dist/ui"),
  ];
  for (const dir of candidates) {
    try {
      await readFile(join(dir, "index.html"));
      return dir;
    } catch {
      // continue
    }
  }
  throw new Error(
    "UI assets not found. Run `npm run build` first (or `npm run build:ui`).",
  );
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw) as unknown;
}

function sendJson(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

export async function openUi(opts: {
  runId?: string;
  port?: number;
  home?: string;
}): Promise<{ url: string; close: () => void }> {
  const store = new TraceStore(opts.home);
  await store.init();
  let runId: string | null = null;
  if (opts.runId) {
    runId = (await store.getRun(opts.runId)).id;
  } else {
    const runs = await store.listRuns();
    runId = runs[0]?.id ?? null;
  }
  const uiRoot = await findUiRoot();
  const port = opts.port ?? 7379;

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);

      if (url.pathname === "/api/agent/status" && req.method === "GET") {
        sendJson(res, 200, await agentCliStatus());
        return;
      }

      if (url.pathname === "/api/agent/install" && req.method === "POST") {
        res.writeHead(200, {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache",
          "X-Accel-Buffering": "no",
        });
        const write = (obj: unknown) => {
          res.write(`${JSON.stringify(obj)}\n`);
        };
        try {
          write({ type: "log", line: "[agenttrace] Install started…" });
          const result = await installCursorAgent((line) => write({ type: "log", line }));
          const status = await agentCliStatus();
          write({ type: "done", ok: true, path: result.path, status });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          write({ type: "done", ok: false, error: message, status: await agentCliStatus() });
        }
        res.end();
        return;
      }

      if (url.pathname === "/api/agent/login" && req.method === "POST") {
        res.writeHead(200, {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-cache",
          "X-Accel-Buffering": "no",
        });
        const write = (obj: unknown) => {
          res.write(`${JSON.stringify(obj)}\n`);
        };
        try {
          write({ type: "log", line: "[agenttrace] Login started…" });
          const result = await loginCursorAgent((line) => write({ type: "log", line }));
          const status = await agentCliStatus();
          write({ type: "done", ok: true, account: result.account, status });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          write({ type: "done", ok: false, error: message, status: await agentCliStatus() });
        }
        res.end();
        return;
      }

      if (url.pathname === "/api/agent/chat" && req.method === "POST") {
        const body = (await readJsonBody(req)) as {
          prompt?: string;
          project?: string;
          runId?: string;
          source?: string;
        };
        if (body.source && body.source !== "cursor") {
          sendJson(res, 400, { error: "In-panel chat is only wired for Cursor CLI right now." });
          return;
        }
        if (body.runId && agentBusy(body.runId)) {
          sendJson(res, 409, { error: "Agent is already running for this chat." });
          return;
        }
        // Never --resume an IDE-hooked conversation: it collides with the live Cursor
        // session and re-answers the same user line in a loop.
        let resumeRunId = body.runId?.trim() || undefined;
        if (resumeRunId) {
          try {
            const events = await store.readEvents(resumeRunId);
            const isCli = events.some(
              (e) => (e.data as { via?: string } | undefined)?.via === "cursor-cli",
            );
            if (!isCli) resumeRunId = undefined;
          } catch {
            resumeRunId = undefined;
          }
        }
        try {
          const started = await startCursorChat(store, {
            prompt: String(body.prompt ?? ""),
            project: String(body.project ?? ""),
            runId: resumeRunId,
          });
          sendJson(res, 200, started);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          sendJson(res, 400, { error: message });
        }
        return;
      }

      if (url.pathname === "/api/agent/stop" && req.method === "POST") {
        const body = (await readJsonBody(req)) as { runId?: string };
        const id = String(body.runId ?? "").trim();
        if (!id) {
          sendJson(res, 400, { error: "runId is required." });
          return;
        }
        const result = stopCursorChat(id);
        if (result.stopped) {
          try {
            await store.appendEvent({
              runId: id,
              type: "turn.ended",
              source: "cursor",
              title: "Stopped",
              data: { status: "stopped", via: "cursor-cli", stoppedBy: "user" },
            });
          } catch {
            // run may not exist yet
          }
        }
        sendJson(res, 200, { ...result, busy: agentBusy(id) });
        return;
      }

      if (url.pathname === "/api/agent/busy" && req.method === "GET") {
        const id = url.searchParams.get("runId")?.trim() ?? "";
        sendJson(res, 200, { runId: id || null, busy: id ? agentBusy(id) : false });
        return;
      }

      if (url.pathname === "/api/runs") {
        const runs = await store.listRuns();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ runs, currentRunId: runId }));
        return;
      }

      if (url.pathname.startsWith("/api/runs/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/runs/".length));
        const run = await store.getRun(id);
        const events = await store.readEvents(id);
        const summary = summarizeRun(run, events);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ run, events, summary }));
        return;
      }

      const rel =
        url.pathname === "/" ? "/index.html" : url.pathname.replace(/^\//, "");
      const filePath = join(uiRoot, rel);
      const body = await readFile(filePath);
      res.writeHead(200, { "Content-Type": contentType(filePath) });
      res.end(body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  const url = runId
    ? `http://127.0.0.1:${port}/?run=${encodeURIComponent(runId)}`
    : `http://127.0.0.1:${port}/`;
  return {
    url,
    close: () => server.close(),
  };
}
