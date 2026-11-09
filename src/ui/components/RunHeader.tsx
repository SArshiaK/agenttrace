import { Code, Folder, PanelRight, Pause, Play, WandSparkles } from "lucide-react";
import { groupByProject } from "../lib/projects";
import type { RunMeta, RunPayload } from "../types";
import { formatDateTime, formatDuration, formatRelative, formatTokens, percent } from "../lib/format";
import { str, type Kind } from "../lib/events";
import { MUGGLE_TOKEN_LABELS, pagesShort, type Mode } from "../lib/humanize";

type Props = {
  payload: RunPayload;
  runs: RunMeta[];
  onSelectRun: (id: string) => void;
  now: number;
  live: boolean;
  onToggleLive: () => void;
  onOpenPanel: () => void;
  mode: Mode;
  onMode: (mode: Mode) => void;
};

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "danger" | "ok" }) {
  return (
    <div className={`kpi${tone ? ` tone-${tone}` : ""}`}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value num">{value}</span>
      {hint && <span className="kpi-hint">{hint}</span>}
    </div>
  );
}

function ModeToggle({ mode, onMode }: { mode: Mode; onMode: (m: Mode) => void }) {
  return (
    <div className="mode-toggle" role="group" aria-label="Display mode">
      <button
        type="button"
        className={`mode-btn${mode === "muggle" ? " is-on" : ""}`}
        aria-pressed={mode === "muggle"}
        onClick={() => onMode("muggle")}
        title="Plain language, no jargon"
      >
        <WandSparkles size={14} aria-hidden="true" />
        Muggle
      </button>
      <button
        type="button"
        className={`mode-btn${mode === "technical" ? " is-on" : ""}`}
        aria-pressed={mode === "technical"}
        onClick={() => onMode("technical")}
        title="Raw tool names, commands, and token numbers"
      >
        <Code size={14} aria-hidden="true" />
        Technical
      </button>
    </div>
  );
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function RunHeader({ payload, runs, onSelectRun, now, live, onToggleLive, onOpenPanel, mode, onMode }: Props) {
  const { run, summary } = payload;
  const { stats } = summary;
  const est = stats.estTokens;
  const running = run.status === "running";
  const muggle = mode === "muggle";
  const failedTools = payload.events.filter((e) => e.type.startsWith("tool.") && e.error).length;
  const changedFiles = new Set(
    payload.events.filter((e) => e.type === "file.write").map((e) => str(e.data?.path)),
  ).size;

  const segments: Array<{ label: string; value: number; kind: Kind }> = [
    { label: "Tool outputs", value: est.tools, kind: "tool" },
    { label: "File edits", value: est.edits, kind: "file" },
    { label: "Responses", value: est.responses, kind: "response" },
    { label: "Thinking", value: est.thinking, kind: "thought" },
    { label: "Your prompts", value: est.prompts, kind: "prompt" },
  ].map((s) => ({ ...s, kind: s.kind as Kind, label: muggle ? (MUGGLE_TOKEN_LABELS[s.kind as Kind] ?? s.label) : s.label }));

  const storyParts = [
    `${running ? "has been working" : "worked"} for ${formatDuration(stats.durationMs)}`,
    `took ${plural(stats.toolCount, "action")}`,
    changedFiles ? `changed ${plural(changedFiles, "file")}` : "didn't change any files",
  ];
  const story = `The assistant ${storyParts[0]}, ${storyParts[1]} and ${storyParts[2]}.`;
  const problems = stats.errorCount
    ? ` ${plural(stats.errorCount, "step")} didn't work along the way.`
    : " Nothing went wrong so far.";

  return (
    <header className="run-header">
      <label className="run-select-wrap">
        <span className="sr-only">Session</span>
        <select className="run-select" value={run.id} onChange={(e) => onSelectRun(e.target.value)}>
          {groupByProject(runs).map((g) => (
            <optgroup key={g.key} label={g.name}>
              {g.runs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>

      <div className="run-title-row">
        <div className="run-title-block">
          <p className="eyebrow">
            <span className={`pill ${running ? "pill-live" : `pill-${run.status}`}`}>
              {running ? (muggle ? "Working" : "Live") : run.status === "error" ? "Error" : muggle ? "Done" : "Ended"}
            </span>
            {run.project && (
              <>
                <span className="eyebrow-project" title={run.project}>
                  <Folder size={12} aria-hidden="true" />
                  {run.project.split("/").filter(Boolean).pop()}
                </span>
                <span aria-hidden="true">·</span>
              </>
            )}
            {!muggle && <span>{run.source ?? "manual"}</span>}
            {!muggle && <span aria-hidden="true">·</span>}
            <span title={formatDateTime(run.createdAt)}>started {formatRelative(run.createdAt, now)}</span>
          </p>
          <h1 className="run-title" dir="auto">
            {run.title}
          </h1>
          {muggle && (
            <p className="story">
              {story}
              {problems}
            </p>
          )}
        </div>
        <div className="run-actions">
          <ModeToggle mode={mode} onMode={onMode} />
          <button
            type="button"
            className="btn"
            onClick={onToggleLive}
            aria-pressed={!live}
            aria-label={live ? "Pause updates" : "Resume updates"}
            title={live ? "Pause updates" : "Resume updates"}
          >
            {live ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
            <span className="btn-text">{live ? "Pause" : "Resume"}</span>
          </button>
          <button type="button" className="btn panel-toggle" onClick={onOpenPanel}>
            <PanelRight size={14} aria-hidden="true" />
            Insights
          </button>
        </div>
      </div>

      {muggle ? (
        <div className="kpis">
          <Kpi label="Time spent" value={formatDuration(stats.durationMs)} hint={running ? "still going" : undefined} />
          <Kpi label="Your messages" value={String(stats.turnCount)} />
          <Kpi
            label="Actions taken"
            value={String(stats.toolCount)}
            hint={failedTools ? `${failedTools} didn't work` : "all went fine"}
            tone={failedTools ? "danger" : undefined}
          />
          <Kpi label="Files changed" value={String(changedFiles)} />
          <Kpi label="Problems" value={String(stats.errorCount)} tone={stats.errorCount ? "danger" : undefined} />
          <Kpi
            label="Text processed"
            value={pagesShort(est.total)}
            hint={`~${formatTokens(est.total)} tokens`}
          />
        </div>
      ) : (
        <div className="kpis">
          <Kpi label="Duration" value={formatDuration(stats.durationMs)} hint={running ? "still running" : undefined} />
          <Kpi label="Turns" value={String(stats.turnCount)} />
          <Kpi
            label="Tool calls"
            value={String(stats.toolCount)}
            hint={failedTools ? `${failedTools} failed` : undefined}
            tone={failedTools ? "danger" : undefined}
          />
          <Kpi label="Errors" value={String(stats.errorCount)} tone={stats.errorCount ? "danger" : undefined} />
          <Kpi label="Into context" value={`~${formatTokens(est.total)}`} hint="tokens, estimated" />
          {stats.contextPeak ? (
            <Kpi
              label="Context peak"
              value={formatTokens(stats.contextPeak.tokens)}
              hint={stats.contextPeak.percent != null ? `${stats.contextPeak.percent}% of window` : "reported by Cursor"}
            />
          ) : (
            <Kpi
              label="Heaviest step"
              value={stats.heaviestSteps[0] ? `~${formatTokens(stats.heaviestSteps[0].estTokens)}` : "—"}
              hint={stats.heaviestSteps[0]?.title}
            />
          )}
        </div>
      )}

      <section className="tokenbar" aria-labelledby="tokenbar-title">
        <div className="tokenbar-head">
          <h2 id="tokenbar-title">{muggle ? "Where the effort went" : "Where tokens went"}</h2>
          <span className="hint">
            {muggle ? "rough estimate · 1 page ≈ 650 tokens" : "estimated from text size · ~4 chars per token"}
          </span>
        </div>
        {est.total > 0 ? (
          <>
            <div
              className="stack"
              role="img"
              aria-label={segments.map((s) => `${s.label} ${percent(s.value, est.total)}%`).join(", ")}
            >
              {segments
                .filter((s) => s.value > 0)
                .map((s) => (
                  <span key={s.kind} className={`seg k-${s.kind}`} style={{ flexGrow: s.value }} />
                ))}
            </div>
            <ul className="legend">
              {segments.map((s) => (
                <li key={s.kind} className={s.value === 0 ? "is-zero" : undefined}>
                  <span className={`swatch k-${s.kind}`} aria-hidden="true" />
                  <span>{s.label}</span>
                  <b className="num">{muggle ? `${percent(s.value, est.total)}%` : `~${formatTokens(s.value)}`}</b>
                  {!muggle && <span className="legend-pct num">{percent(s.value, est.total)}%</span>}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="hint">
            {muggle
              ? "Nothing to show yet. This fills in once the assistant starts working."
              : "Nothing measured yet. Token estimates appear once the agent reads, runs, or replies."}
          </p>
        )}
      </section>
    </header>
  );
}
