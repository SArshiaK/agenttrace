import { useEffect, useState } from "react";
import { Check, CircleCheck, Copy, Info, TriangleExclamationPoint, X } from "lucide-react";
import type { AgentTraceEvent, RunPayload } from "../types";
import { estTokens, kindOf, rowText, str } from "../lib/events";
import { formatClock, formatDateTime, formatDuration, formatTokens } from "../lib/format";
import {
  effortOf,
  humanFinding,
  humanHealth,
  humanRow,
  humanToolName,
  pagesOf,
  type Mode,
} from "../lib/humanize";
import { EventIcon } from "./EventIcon";

type Props = {
  payload: RunPayload;
  selectedEvent: AgentTraceEvent | null;
  onSelectEvent: (id: string) => void;
  onCloseEvent: () => void;
  open: boolean;
  onClose: () => void;
  mode: Mode;
};

export function SidePanel({ payload, selectedEvent, onSelectEvent, onCloseEvent, open, onClose, mode }: Props) {
  const [tab, setTab] = useState<"insights" | "event">("insights");
  const selectedId = selectedEvent?.id;
  useEffect(() => {
    if (selectedId) setTab("event");
  }, [selectedId]);
  const active = selectedEvent ? tab : "insights";
  const muggle = mode === "muggle";

  return (
    <aside className={`panel${open ? " is-open" : ""}`} aria-label="Details">
      <div className="panel-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={active === "insights"}
          className={`tab${active === "insights" ? " is-on" : ""}`}
          onClick={() => setTab("insights")}
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
        >
          {muggle ? "Step" : "Event"}
        </button>
        <button type="button" className="icon-btn panel-close" onClick={onClose} aria-label="Close panel">
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
          <Insights
            payload={payload}
            muggle={muggle}
            onSelectEvent={(id) => {
              onSelectEvent(id);
              setTab("event");
            }}
          />
        )}
      </div>
    </aside>
  );
}

function Insights({
  payload,
  muggle,
  onSelectEvent,
}: {
  payload: RunPayload;
  muggle: boolean;
  onSelectEvent: (id: string) => void;
}) {
  const { stats, findings, health } = payload.summary;
  const maxStep = stats.heaviestSteps[0]?.estTokens ?? 1;
  const byId = new Map(payload.events.map((e) => [e.id, e]));

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

  return (
    <>
      <section className="card">
        <h2 className="card-title">{muggle ? "What took the most effort" : "Heaviest steps"}</h2>
        {stats.heaviestSteps.length === 0 ? (
          <p className="hint">{muggle ? "Nothing yet." : "No token-bearing steps yet."}</p>
        ) : (
          <ol className="rank">
            {stats.heaviestSteps.map((step) => {
              const event = byId.get(step.eventId);
              const title = muggle && event ? humanRow(event).text : step.title;
              return (
                <li key={step.eventId}>
                  <button type="button" className="rank-row" onClick={() => onSelectEvent(step.eventId)}>
                    <span className="rank-title" dir="auto">
                      {title}
                    </span>
                    <span className="rank-value num">
                      {muggle ? pagesOf(step.estTokens).replace("about ", "≈ ") : `~${formatTokens(step.estTokens)}`}
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

      {tools.length > 0 && (
        <section className="card">
          <h2 className="card-title">{muggle ? "What it used most" : "By tool"}</h2>
          <table className="tool-table">
            <thead>
              <tr>
                <th scope="col">{muggle ? "Used" : "Tool"}</th>
                <th scope="col">{muggle ? "Times" : "Calls"}</th>
                <th scope="col">{muggle ? "Effort" : "Tokens"}</th>
                <th scope="col">Time</th>
              </tr>
            </thead>
            <tbody>
              {tools.map((t) => (
                <tr key={t.name}>
                  <td>{t.name}</td>
                  <td className="num">{t.calls}</td>
                  <td className="num">{muggle ? effortOf(t.estTokens) : `~${formatTokens(t.estTokens)}`}</td>
                  <td className="num">{formatDuration(t.durationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="card">
        <h2 className="card-title">{muggle ? "Health check" : "Run health"}</h2>
        <ul className="health">
          {health.map((item) => (
            <li key={item.id} className={item.ok ? "is-ok" : "is-bad"}>
              {item.ok ? (
                <CircleCheck size={14} aria-hidden="true" />
              ) : (
                <TriangleExclamationPoint size={14} aria-hidden="true" />
              )}
              <span>{muggle ? humanHealth(item) : item.label}</span>
            </li>
          ))}
        </ul>
      </section>

      {findings.length > 0 && (
        <section className="card">
          <h2 className="card-title">
            {muggle ? "Worth knowing" : "Findings"} <span className="count-badge num">{findings.length}</span>
          </h2>
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
        </section>
      )}

      {stats.filesTouched.length > 0 && (
        <section className="card">
          <h2 className="card-title">{muggle ? "Files it worked on" : "Files touched"}</h2>
          <ul className="files">
            {stats.filesTouched.slice(0, 12).map((f) => (
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

const SHOWN_KEYS = new Set(["text", "output", "args", "estTokens", "chars", "outputChars", "name", "path", "model"]);

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
        ["Tokens", tokens ? `~${tokens.toLocaleString()} (estimated)` : undefined],
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
