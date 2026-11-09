import type { AgentTraceEvent, RunMeta } from "../core/schema";
import type { RunSummary } from "../core/insights";

export type { AgentTraceEvent, RunMeta, RunSummary };

export type RunPayload = {
  run: RunMeta;
  events: AgentTraceEvent[];
  summary: RunSummary;
};
