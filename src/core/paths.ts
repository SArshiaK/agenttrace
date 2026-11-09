import { homedir } from "node:os";
import { join } from "node:path";

export function getAgenttraceHome(override?: string): string {
  return override ?? process.env.AGENTTRACE_HOME ?? join(homedir(), ".agenttrace");
}

export function getRunsDir(home = getAgenttraceHome()): string {
  return join(home, "runs");
}

export function getIndexPath(home = getAgenttraceHome()): string {
  return join(home, "index.json");
}

export function getRunPath(runId: string, home = getAgenttraceHome()): string {
  return join(getRunsDir(home), `${runId}.jsonl`);
}
