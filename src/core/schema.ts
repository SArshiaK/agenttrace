import { z } from "zod";

export const EVENT_TYPES = [
  "run.started",
  "run.ended",
  "tool.started",
  "tool.ended",
  "file.read",
  "file.write",
  "file.delete",
  "model.request",
  "model.response",
  "model.thought",
  "context.compact",
  "turn.ended",
  "error",
  "note",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const EventErrorSchema = z.object({
  message: z.string(),
  stack: z.string().optional(),
});

export const AgentTraceEventSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  ts: z
    .string()
    .min(1)
    .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid ISO timestamp"),

  type: z.string().min(1),
  source: z.string().optional(),
  title: z.string().optional(),
  data: z.record(z.unknown()).optional(),
  durationMs: z.number().nonnegative().optional(),
  error: EventErrorSchema.optional(),
});

export type AgentTraceEvent = z.infer<typeof AgentTraceEventSchema>;

export const RunMetaSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  endedAt: z.string().optional(),
  source: z.string().optional(),
  eventCount: z.number().int().nonnegative().default(0),
  status: z.enum(["running", "ended", "error"]).default("running"),
});

export type RunMeta = z.infer<typeof RunMetaSchema>;

export const IndexSchema = z.object({
  version: z.literal(1),
  currentRunId: z.string().nullable(),
});

export type TraceIndex = z.infer<typeof IndexSchema>;

export function isKnownEventType(type: string): type is EventType {
  return (EVENT_TYPES as readonly string[]).includes(type);
}
