import { useEffect, useMemo, useState } from "react";
import { Check, CircleCheck, Copy, Info, TriangleExclamationPoint, X } from "lucide-react";
import { summarizeRun } from "../../core/insights";
import type { AgentTraceEvent, RunPayload, RunSummary } from "../types";
import { estTokens, kindOf, rowText, str, type Turn } from "../lib/events";
import { formatClock, formatDateTime, formatDuration, formatTokens } from "../lib/format";
import {
  effortOf,
  humanFinding,
  humanHealth,
  humanRow,
  humanToolName,
  pagesOf,
  pagesShort,
  type Mode,
} from "../lib/humanize";
import { EventIcon } from "./EventIcon";
import { Accuracy, EffortBreakdown, ESTIMATE_NOTE } from "./RunHeader";

type Props = {
  payload: RunPayload;
  selectedEvent: AgentTraceEvent | null;
  onSelectEvent: (id: string) => void;
  onCloseEvent: () => void;
  open: boolean;
  onClose: () => void;
  mode: Mode;
  turn?: Turn;
  scope: Scope;
  onScope: (scope: Scope) => void;
};

export type Scope = "turn" | "session";

/** Insights for one message: the same heuristics as the session, run on that turn's events. */
function turnSummary(payload: RunPayload, turn: Turn): RunSummary {
  const summary = summarizeRun(payload.run, turn.raw);
  const durationMs = Date.parse(turn.endTs) - Date.parse(turn.startTs);
  return { ...summary, stats: { ...summary.stats, durationMs } };
}

export function SidePanel({
  payload,
  selectedEvent,
  onSelectEvent,
  onCloseEvent,
  open,
  onClose,
  mode,
  turn,
  scope,
  onScope,
}: Props) {
  const [tab, setTab] = useState<"insights" | "event">("insights");
  const selectedId = selectedEvent?.id;
  useEffect(() => {
    if (selectedId) setTab("event");
  }, [selectedId]);
  const active = selectedEvent ? tab : "insights";
  const muggle = mode === "muggle";
  const summary = useMemo(
    () => (scope === "turn" && turn ? turnSummary(payload, turn) : payload.summary),
    [scope, turn, payload],
  );

  return (
    <aside
      id="details-panel"
      className={`panel${open ? " is-open" : " is-collapsed"}`}
      aria-label="Details"
      aria-hidden={!open}
      inert={!open ? true : undefined}
    >
      <div className="panel-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={active === "insights"}
          className={`tab${active === "insights" ? " is-on" : ""}`}
          onClick={() => setTab("insights")}
          tabIndex={open ? undefined : -1}
        >
          {muggle ? "Overview" : "Insights"}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={active === "event"}
          className={`tab${active === "event" ? " is-on" : ""}`}
          disabled={!selectedEvent}
          onClick={() => setTab("event")}
          tabIndex={open ? undefined : -1}
        >
          {muggle ? "Step" : "Event"}
        </button>
        <button
          type="button"
          className="icon-btn panel-close"
          onClick={onClose}
          aria-label="Collapse details panel"
          title="Collapse panel"
          tabIndex={open ? undefined : -1}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="panel-body">
        {active === "event" && selectedEvent ? (
          <Inspector
            key={selectedEvent.id}
            event={selectedEvent}
            muggle={muggle}
            onClose={() => {
              onCloseEvent();
              setTab("insights");
            }}
          />
        ) : (
          <>
            <ScopeBar turn={turn} scope={scope} onScope={onScope} muggle={muggle} />
            <Insights
              summary={summary}
              events={payload.events}
              muggle={muggle}
              onSelectEvent={(id) => {
                onSelectEvent(id);
                setTab("event");
              }}
            />
          </>
        )}
      </div>
    </aside>
  );
}

function ScopeBar({
  turn,
  scope,
  onScope,
  muggle,
}: {
  turn?: Turn;
  scope: Scope;
  onScope: (s: Scope) => void;
  muggle: boolean;
}) {
  const promptText = str(turn?.prompt?.data?.text) ?? turn?.prompt?.title ?? "";
  return (
    <div className="scope">
      <div className="scope-toggle" role="group" aria-label={muggle ? "Show overview for" : "Insights scope"}>
        <button
          type="button"
          className={`scope-btn${scope === "turn" ? " is-on" : ""}`}
          aria-pressed={scope === "turn"}
          disabled={!turn}
          onClick={() => onScope("turn")}
        >
          {muggle ? "This message" : "This turn"}
        </button>
        <button
          type="button"
          className={`scope-btn${scope === "session" ? " is-on" : ""}`}
          aria-pressed={scope === "session"}
          onClick={() => onScope("session")}
        >
          {muggle ? "Whole chat" : "Whole session"}
        </button>
      </div>
      {scope === "turn" && turn && (
        <p className="scope-caption">
          <span className="scope-label">
            {muggle ? `You asked · ${formatClock(turn.startTs).slice(0, 5)}` : `Turn ${turn.index}`}
          </span>
          <span className="scope-text" dir="auto">
            {promptText}
          </span>
        </p>
      )}
    </div>
  );
}

function Insights({
  summary,
  events,
  muggle,
  onSelectEvent,
}: {
  summary: RunSummary;
  events: AgentTraceEvent[];
  muggle: boolean;
  onSelectEvent: (id: string) => void;
}) {
  const { stats, findings, health } = summary;
  const maxStep = stats.heaviestSteps[0]?.estTokens ?? 1;
  const byId = new Map(events.map((e) => [e.id, e]));

  const tools = muggle
    ? [
        ...stats.heaviestTools
          .reduce((acc, t) => {
            const name = humanToolName(t.name);
            const prev = acc.get(name) ?? { name, calls: 0, estTokens: 0, durationMs: 0 };
            acc.set(name, {
              name,
              calls: prev.calls + t.calls,
              estTokens: prev.estTokens + t.estTokens,
              durationMs: prev.durationMs + t.durationMs,
            });
            return acc;
          }, new Map<string, (typeof stats.heaviestTools)[number]>())
          .values(),
      ].sort((a, b) => b.estTokens - a.estTokens)
    : stats.heaviestTools;

  const issues = health.filter((item) => !item.ok);
  const topSteps = stats.heaviestSteps.slice(0, 5);
  const topTools = tools.slice(0, 5);

  return (
    <>
      <dl className="mini-kpis">
        <div>
          <dt>{muggle ? "Took" : "Duration"}</dt>
          <dd className="num">{formatDuration(stats.durationMs)}</dd>
        </div>
        <div>
          <dt>{muggle ? "Actions" : "Tools"}</dt>
          <dd className="num">{stats.toolCount}</dd>
        </div>
        <div>
          <dt>
            {muggle ? "Text" : "Tokens"} <Accuracy kind="est" />
          </dt>
          <dd className="num">
            {muggle ? pagesShort(stats.estTokens.total) : `~${formatTokens(stats.estTokens.total)}`}
          </dd>
        </div>
        <div className={stats.errorCount ? "is-danger" : undefined}>
          <dt>{muggle ? "Problems" : "Errors"}</dt>
          <dd className="num">{stats.errorCount}</dd>
        </div>
      </dl>

      <section className="card">
        <h2 className="card-title">
          {muggle ? "Where the effort went" : "Context text"} <Accuracy kind="est" />
        </h2>
        <EffortBreakdown est={stats.estTokens} muggle={muggle} />
      </section>

      <section className="card">
        <h2 className="card-title">
          {muggle ? "Heaviest steps" : "Heaviest steps"} <Accuracy kind="est" />
        </h2>
        {topSteps.length === 0 ? (
          <p className="hint">{muggle ? "Nothing yet." : "No token-bearing steps yet."}</p>
        ) : (
          <ol className="rank">
            {topSteps.map((step) => {
              const event = byId.get(step.eventId);
              const title = muggle && event ? humanRow(event).text : step.title;
              return (
                <li key={step.eventId}>
                  <button type="button" className="rank-row" onClick={() => onSelectEvent(step.eventId)}>
                    <span className="rank-title" dir="auto">
                      {title}
                    </span>
                    <span className="rank-value num">
                      {muggle ? pagesShort(step.estTokens) : `~${formatTokens(step.estTokens)}`}
                    </span>
                    <span className="rank-bar" aria-hidden="true">
                      <span style={{ width: `${(step.estTokens / maxStep) * 100}%` }} />
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {issues.length > 0 || findings.length > 0 ? (
        <section className="card">
          <h2 className="card-title">{muggle ? "Problems" : "Issues"}</h2>
          {issues.length > 0 && (
            <ul className="health">
              {issues.map((item) => (
                <li key={item.id} className="is-bad">
                  <TriangleExclamationPoint size={14} aria-hidden="true" />
                  <span>{muggle ? humanHealth(item) : item.label}</span>
                </li>
              ))}
            </ul>
          )}
          {findings.length > 0 && (
            <ul className="findings">
              {findings.map((f) => {
                const text = muggle ? humanFinding(f) : { title: f.title, detail: f.detail };
                return (
                  <li key={f.id} className={`finding sev-${f.severity}`}>
                    {f.severity === "info" ? (
                      <Info size={14} aria-hidden="true" />
                    ) : (
                      <TriangleExclamationPoint size={14} aria-hidden="true" />
                    )}
                    <div>
                      <strong>{text.title}</strong>
                      <p>{text.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : (
        <p className="health-ok">
          <CircleCheck size={14} aria-hidden="true" />
          {muggle ? "No problems in this scope." : "No issues detected."}
        </p>
      )}

      {(topTools.length > 0 || stats.filesTouched.length > 0) && (
        <details className="more-details">
          <summary>{muggle ? "More breakdown" : "Tools & files"}</summary>
          {topTools.length > 0 && (
            <section className="card is-nested">
              <h2 className="card-title">{muggle ? "What it used most" : "By tool"}</h2>
              <table className="tool-table">
                <thead>
                  <tr>
                    <th scope="col">{muggle ? "Used" : "Tool"}</th>
                    <th scope="col">{muggle ? "Times" : "Calls"}</th>
                    <th scope="col" title={ESTIMATE_NOTE}>
                      {muggle ? "Effort" : "Est. tokens"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {topTools.map((t) => (
                    <tr key={t.name}>
                      <td>{t.name}</td>
                      <td className="num">{t.calls}</td>
                      <td className="num">{muggle ? effortOf(t.estTokens) : `~${formatTokens(t.estTokens)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {stats.filesTouched.length > 0 && (
            <section className="card is-nested">
              <h2 className="card-title">{muggle ? "Files it worked on" : "Files touched"}</h2>
              <ul className="files">
                {stats.filesTouched.slice(0, 8).map((f) => (
                  <li key={f.path}>
                    <span className="file-path" title={f.path}>
                      {muggle ? (f.path.split(/[\\/]/).pop() ?? f.path) : f.path}
                    </span>
                    <span className="num faint">{f.count}×</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </details>
      )}
    </>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={copied ? "Copied" : `Copy ${label}`}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    </button>
  );
}

function Block({ title, text }: { title: string; text: string }) {
  return (
    <section className="block">
      <div className="block-head">
        <h3>{title}</h3>
        <CopyButton text={text} label={title.toLowerCase()} />
      </div>
      <pre className="code" dir="auto">
        {text}
      </pre>
    </section>
  );
}

const SHOWN_KEYS = new Set([
  "text",
  "output",
  "args",
  "estTokens",
  "chars",
  "outputChars",
  "name",
  "path",
  "model",
  "images",
  "estimateAdjusted",
]);

/** Says how a step's token number was produced, so nobody mistakes it for a measurement. */
function estimateBasis(event: AgentTraceEvent, muggle: boolean): string | undefined {
  const d = event.data ?? {};
  if (d.harness) {
    return muggle
      ? "Cursor wrote this file itself. The assistant didn't read it all, only the parts it searched for later, so it costs nothing here."
      : "Written by Cursor, not the agent: a large tool result saved to disk. Only what the agent later reads or greps enters context, so it counts 0 here.";
  }
  if (!estTokens(event)) return undefined;
  const images = typeof d.images === "number" ? d.images : 0;
  if (d.estimateAdjusted === "legacy-image") {
    return muggle
      ? "Recorded before screenshots were measured properly, so this number is an adjusted guess."
      : "Adjusted guess: recorded before image handling; the original counted the screenshot's base64 as text.";
  }
  const parts = [
    muggle ? "Guessed from the amount of text" : "Estimated from text length (~4 chars/token)",
    images ? (muggle ? `plus about 1k per image (${images})` : `+ ~1k per image (${images})`) : undefined,
  ].filter(Boolean);
  return `${parts.join(" ")}. ${muggle ? "Not what you're billed." : "Not billed usage."}`;
}

function Inspector({ event, muggle, onClose }: { event: AgentTraceEvent; muggle: boolean; onClose: () => void }) {
  const d = event.data ?? {};
  const kind = kindOf(event);
  const { label, detail } = rowText(event);
  const human = humanRow(event);
  const tokens = estTokens(event);
  const rest = Object.fromEntries(Object.entries(d).filter(([k, v]) => !SHOWN_KEYS.has(k) && v !== undefined));

  const fields: Array<[string, string | undefined]> = muggle
    ? [
        ["When", formatClock(event.ts)],
        ["Took", event.durationMs != null ? formatDuration(event.durationMs) : undefined],
        ["Effort", tokens ? `${effortOf(tokens)} · ${pagesOf(tokens)} of text` : undefined],
        ["File", str(d.path)?.split(/[\\/]/).pop()],
      ]
    : [
        ["Time", formatDateTime(event.ts)],
        ["Duration", event.durationMs != null ? formatDuration(event.durationMs) : undefined],
        ["Est. tokens", tokens ? `~${tokens.toLocaleString()}` : undefined],
        ["Tool", str(d.name)],
        ["Path", str(d.path)],
        ["Model", str(d.model)],
        ["Type", event.type],
      ];

  const textTitle = muggle
    ? kind === "prompt"
      ? "Your message"
      : kind === "thought"
        ? "What it was thinking"
        : kind === "response"
          ? "What it told you"
          : "Text"
    : kind === "prompt"
      ? "Prompt"
      : "Text";

  return (
    <div className="inspector">
      <div className="inspector-head">
        <EventIcon event={event} size={16} />
        <div className="inspector-title">
          {!muggle && <span className={`kind-label k-${kind}`}>{label}</span>}
          <h2 dir="auto">{muggle ? human.text : detail || event.title || event.type}</h2>
          {muggle && human.sub && kind !== "prompt" && kind !== "thought" && kind !== "response" && (
            <p className="hint" dir="auto">
              {human.sub}
            </p>
          )}
        </div>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <dl className="fields">
        {fields
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd className={k === "Path" || k === "Type" ? "mono" : undefined}>{v}</dd>
            </div>
          ))}
      </dl>

      {estimateBasis(event, muggle) && (
        <p className="estimate-basis">
          <Accuracy kind="est" />
          <span>{estimateBasis(event, muggle)}</span>
        </p>
      )}

      {event.error && (
        <div className="callout is-danger" role="note">
          <TriangleExclamationPoint size={14} aria-hidden="true" />
          <span>
            {muggle && <strong>What went wrong: </strong>}
            {event.error.message}
          </span>
        </div>
      )}

      {str(d.text) && <Block title={textTitle} text={str(d.text)!} />}

      {muggle ? (
        (str(d.output) || d.args != null) && (
          <details className="raw">
            <summary>Show technical details</summary>
            {str(d.output) && <Block title="What it got back" text={str(d.output)!} />}
            {d.args != null && <Block title="What it sent" text={JSON.stringify(d.args, null, 2)} />}
          </details>
        )
      ) : (
        <>
          {str(d.output) && <Block title="Output" text={str(d.output)!} />}
          {d.args != null && <Block title="Input" text={JSON.stringify(d.args, null, 2)} />}
          {Object.keys(rest).length > 0 && (
            <details className="raw">
              <summary>More fields</summary>
              <pre className="code">{JSON.stringify(rest, null, 2)}</pre>
            </details>
          )}
        </>
      )}
    </div>
  );
}
