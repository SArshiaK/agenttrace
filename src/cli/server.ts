import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TraceStore } from "../core/store.js";
import { summarizeRun } from "../core/insights.js";

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
