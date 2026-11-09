import { Code, Folder, PanelRight, PanelRightClose, WandSparkles } from "lucide-react";
import { groupByProject } from "../lib/projects";
import type { RunMeta, RunPayload } from "../types";
import { formatDateTime, formatDuration, formatTokens, percent } from "../lib/format";
import { type Kind } from "../lib/events";
import { MUGGLE_TOKEN_LABELS, pagesShort, type Mode } from "../lib/humanize";

type Props = {
  payload: RunPayload;
  runs: RunMeta[];
  onSelectRun: (id: string) => void;
  panelOpen: boolean;
  onTogglePanel: () => void;
  mode: Mode;
  onMode: (mode: Mode) => void;
};

export const ESTIMATE_NOTE =
  "Estimated from text size (~4 characters per token). This is how much text entered the agent's context, not your billed usage: the model re-reads its context on every step, so billed tokens are usually several times higher.";

export function Accuracy({ kind }: { kind: "exact" | "est" }) {
  return (
    <span
      className={`accuracy is-${kind}`}
      title={kind === "exact" ? "Reported directly by Cursor" : ESTIMATE_NOTE}
    >
      {kind === "exact" ? "exact" : "est."}
    </span>
  );
}

export function EffortBreakdown({
  est,
  muggle,
}: {
  est: { total: number; tools: number; edits: number; responses: number; thinking: number; prompts: number };
  muggle: boolean;
}) {
  const segments: Array<{ label: string; value: number; kind: Kind }> = [
    { label: "Tool outputs", value: est.tools, kind: "tool" },
    { label: "File edits", value: est.edits, kind: "file" },
    { label: "Responses", value: est.responses, kind: "response" },
    { label: "Thinking", value: est.thinking, kind: "thought" },
    { label: "Your prompts", value: est.prompts, kind: "prompt" },
  ].map((s) => ({
    ...s,
    kind: s.kind as Kind,
    label: muggle ? (MUGGLE_TOKEN_LABELS[s.kind as Kind] ?? s.label) : s.label,
  }));

  if (est.total <= 0) {
    return (
      <p className="hint">
        {muggle
          ? "Nothing to show yet. This fills in once the assistant starts working."
          : "Nothing measured yet. Token estimates appear once the agent reads, runs, or replies."}
      </p>
    );
  }

  return (
    <div className="tokenbar">
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
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <li key={s.kind}>
              <span className={`swatch k-${s.kind}`} aria-hidden="true" />
              <span>{s.label}</span>
              <b className="num">{muggle ? `${percent(s.value, est.total)}%` : `~${formatTokens(s.value)}`}</b>
            </li>
          ))}
      </ul>
      <p className="hint" title={ESTIMATE_NOTE}>
        {muggle ? (
          <>
            Rough guess · {pagesShort(est.total)} total <Accuracy kind="est" />
          </>
        ) : (
          <>
            ~{formatTokens(est.total)} into context · not billed usage <Accuracy kind="est" />
          </>
        )}
      </p>
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
        title="Plain language"
        aria-label="Muggle mode"
      >
        <WandSparkles size={14} aria-hidden="true" />
        <span className="mode-label">Muggle</span>
      </button>
      <button
        type="button"
        className={`mode-btn${mode === "technical" ? " is-on" : ""}`}
        aria-pressed={mode === "technical"}
        onClick={() => onMode("technical")}
        title="Technical details"
        aria-label="Technical mode"
      >
        <Code size={14} aria-hidden="true" />
        <span className="mode-label">Technical</span>
      </button>
    </div>
  );
}

export function RunHeader({
  payload,
  runs,
  onSelectRun,
  panelOpen,
  onTogglePanel,
  mode,
  onMode,
}: Props) {
  const { run, summary } = payload;
  const { stats } = summary;
  const running = run.status === "running";
  const muggle = mode === "muggle";
  const projectName = run.project?.split("/").filter(Boolean).pop();
  const statusLabel = running
    ? muggle
      ? "Working"
      : "Live"
    : run.status === "error"
      ? "Error"
      : muggle
        ? "Done"
        : "Ended";

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

      <div className="run-bar">
        <div className="run-bar-main">
          <span className={`pill ${running ? "pill-live" : `pill-${run.status}`}`}>{statusLabel}</span>
          {projectName && (
            <span className="run-bar-project" title={run.project}>
              <Folder size={12} aria-hidden="true" />
              {projectName}
            </span>
          )}
          <span className="run-bar-sep" aria-hidden="true">
            ·
          </span>
          <span className="run-bar-stat num" title={formatDateTime(run.createdAt)}>
            {formatDuration(stats.durationMs)}
          </span>
          {stats.errorCount > 0 && (
            <>
              <span className="run-bar-sep" aria-hidden="true">
                ·
              </span>
              <span className="run-bar-stat is-danger num">
                {stats.errorCount} {muggle ? "problems" : "errors"}
              </span>
            </>
          )}
        </div>

        <div className="run-actions">
          <ModeToggle mode={mode} onMode={onMode} />
          <button
            type="button"
            className={`icon-btn run-action panel-toggle${panelOpen ? " is-on" : ""}`}
            onClick={onTogglePanel}
            aria-expanded={panelOpen}
            aria-controls="details-panel"
            aria-pressed={panelOpen}
            aria-label={panelOpen ? "Hide details panel" : "Show details panel"}
            title={muggle ? "Overview" : "Insights"}
          >
            {panelOpen ? <PanelRightClose size={15} aria-hidden="true" /> : <PanelRight size={15} aria-hidden="true" />}
          </button>
        </div>
      </div>

      <h1 className="sr-only">{run.title}</h1>
    </header>
  );
}
