import type { AgentTraceEvent } from "./schema.js";
import type { RunSummary } from "./insights.js";

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}

export function formatTokens(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1000) return String(Math.round(n));
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
}

export function formatMoney(usd: number | null | undefined): string {
  if (usd == null) return "—";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function summaryToMarkdown(summary: RunSummary): string {
  const { run, stats, findings, health } = summary;
  const lines = [
    `# Agenttrace summary: ${run.title}`,
    "",
    `- **Run ID:** \`${run.id}\``,
    `- **Status:** ${run.status}`,
    `- **Duration:** ${formatDuration(stats.durationMs)}`,
    `- **Events:** ${stats.eventCount}`,
    `- **Tools:** ${stats.toolCount}`,
    `- **Files:** ${stats.fileCount}`,
    `- **Models:** ${stats.modelCount}`,
    `- **Errors:** ${stats.errorCount}`,
    `- **Tokens (reported):** ${stats.approxTokens ?? "—"}`,
    `- **Text into context (estimate, not billed usage):** ~${formatTokens(stats.estTokens.total)} tokens`,
    `- **Cost:** ${formatMoney(stats.approxCostUsd)}`,
    "",
    "## Where the context text came from (estimate)",
    "",
    "_Estimated from text length (~4 chars/token). Billed tokens are usually several times higher because the model re-reads its context on every step._",
    "",
    `- Tool outputs: ~${formatTokens(stats.estTokens.tools)}`,
    `- File edits: ~${formatTokens(stats.estTokens.edits)}`,
    `- Your prompts: ~${formatTokens(stats.estTokens.prompts)}`,
    `- Agent responses: ~${formatTokens(stats.estTokens.responses)}`,
    `- Thinking: ~${formatTokens(stats.estTokens.thinking)}`,
    ...(stats.contextPeak
      ? [`- Context peak (reported by Cursor): ${formatTokens(stats.contextPeak.tokens)}`]
      : []),
    "",
    ...(stats.heaviestSteps.length
      ? [
          "## Heaviest steps",
          ...stats.heaviestSteps.map((s) => `- ~${formatTokens(s.estTokens)} — ${s.title}`),
          "",
        ]
      : []),
    "## Run health",
    ...health.map((h) => `- [${h.ok ? "x" : " "}] ${h.label}`),
    "",
  ];

  if (findings.length) {
    lines.push("## Findings", "");
    for (const f of findings) {
      lines.push(`- **${f.severity.toUpperCase()} — ${f.title}:** ${f.detail}`);
    }
    lines.push("");
  }

  if (stats.filesTouched.length) {
    lines.push("## Files touched", "");
    for (const f of stats.filesTouched.slice(0, 12)) {
      lines.push(`- \`${f.path}\` (${f.count})`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function summaryToJson(summary: RunSummary): string {
  return `${JSON.stringify(summary, null, 2)}\n`;
}

export function eventsToJson(events: AgentTraceEvent[]): string {
  return `${JSON.stringify(events, null, 2)}\n`;
}
