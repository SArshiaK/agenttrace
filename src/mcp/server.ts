import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { TraceStore } from "../core/store.js";
import { summarizeRun } from "../core/insights.js";
import { summaryToMarkdown } from "../core/format.js";

export async function startMcpServer(home?: string): Promise<void> {
  const store = new TraceStore(home);

  const server = new Server(
    { name: "agenttrace", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "start_run",
        description: "Start a new agenttrace run and return its run id.",
        inputSchema: {
          type: "object",
          properties: {
            title: { type: "string", description: "Human-readable run title" },
            source: { type: "string", description: "Emitter label, e.g. cursor" },
          },
        },
      },
      {
        name: "log_event",
        description: "Append a structured event to a run (or the current run).",
        inputSchema: {
          type: "object",
          properties: {
            type: {
              type: "string",
              description:
                "Event type, e.g. tool.started, file.write, model.response, error, note",
            },
            runId: { type: "string" },
            title: { type: "string" },
            source: { type: "string" },
            data: { type: "object", additionalProperties: true },
            durationMs: { type: "number" },
            error: {
              type: "object",
              properties: {
                message: { type: "string" },
                stack: { type: "string" },
              },
              required: ["message"],
            },
          },
          required: ["type"],
        },
      },
      {
        name: "end_run",
        description: "Mark a run as ended.",
        inputSchema: {
          type: "object",
          properties: {
            runId: { type: "string" },
            status: { type: "string", enum: ["ended", "error"] },
          },
        },
      },
      {
        name: "get_run_summary",
        description: "Get a markdown/JSON summary of a run.",
        inputSchema: {
          type: "object",
          properties: {
            runId: { type: "string" },
            format: { type: "string", enum: ["md", "json"] },
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;

    try {
      if (name === "start_run") {
        const title = z.string().optional().parse(args.title);
        const source = z.string().optional().parse(args.source) ?? "mcp";
        const { run } = await store.startRun({ title, source, project: process.cwd() });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ runId: run.id, title: run.title }),
            },
          ],
        };
      }

      if (name === "log_event") {
        const type = z.string().min(1).parse(args.type);
        const event = await store.appendEvent({
          type,
          runId: typeof args.runId === "string" ? args.runId : undefined,
          title: typeof args.title === "string" ? args.title : undefined,
          source: typeof args.source === "string" ? args.source : "mcp",
          data:
            args.data && typeof args.data === "object" && !Array.isArray(args.data)
              ? (args.data as Record<string, unknown>)
              : undefined,
          durationMs:
            typeof args.durationMs === "number" ? args.durationMs : undefined,
          error:
            args.error && typeof args.error === "object"
              ? z
                  .object({ message: z.string(), stack: z.string().optional() })
                  .parse(args.error)
              : undefined,
        });
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, event }) }],
        };
      }

      if (name === "end_run") {
        const runId = typeof args.runId === "string" ? args.runId : undefined;
        const status =
          args.status === "error" || args.status === "ended"
            ? args.status
            : "ended";
        const { run } = await store.endRun(runId, { status, source: "mcp" });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ runId: run.id, status: run.status }),
            },
          ],
        };
      }

      if (name === "get_run_summary") {
        const runId = typeof args.runId === "string" ? args.runId : undefined;
        const format = args.format === "json" ? "json" : "md";
        const run = await store.getRun(runId);
        const events = await store.readEvents(run.id);
        const summary = summarizeRun(run, events);
        const text =
          format === "json"
            ? JSON.stringify(summary, null, 2)
            : summaryToMarkdown(summary);
        return { content: [{ type: "text", text }] };
      }

      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: message }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
