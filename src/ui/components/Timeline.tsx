import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  Clock,
  Eye,
  Flame,
  Repeat,
  Search,
  Timer,
  TriangleExclamationPoint,
  Wrench,
} from "lucide-react";
import type { AgentTraceEvent, RunPayload } from "../types";
import {
  HEAVY_TOKENS,
  SLOW_MS,
  estTokens,
  isRowEvent,
  kindOf,
  loopKeys,
  matchesFilter,
  matchesQuery,
  rowText,
  str,
  toolKey,
  type FilterKey,
  type Turn,
} from "../lib/events";
import { formatClock, formatDuration, formatTokens } from "../lib/format";
import { MUGGLE_FILTERS, effortOf, humanRow, pagesOf, pagesShort, type Mode } from "../lib/humanize";
import { EventIcon } from "./EventIcon";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "heavy", label: "Heavy" },
  { key: "tools", label: "Tools" },
  { key: "files", label: "Files" },
  { key: "model", label: "Model" },
  { key: "errors", label: "Errors" },
];

type Props = {
  payload: RunPayload;
  filter: FilterKey;
  onFilter: (f: FilterKey) => void;
  query: string;
  onQuery: (q: string) => void;
  selectedEventId: string | null;
  onSelect: (id: string) => void;
  scrollRoot: HTMLElement | null;
  mode: Mode;
  turns: Turn[];
  focusedTurnKey?: string;
  onFocusTurn: (key: string) => void;
};

export function Timeline({
  payload,
  filter,
  onFilter,
  query,
  onQuery,
  selectedEventId,
  onSelect,
  scrollRoot,
  mode,
  turns,
  focusedTurnKey,
  onFocusTurn,
}: Props) {
  const { events } = payload;
  const muggle = mode === "muggle";
  const loops = useMemo(() => loopKeys(events), [events]);
  const maxTokens = useMemo(() => Math.max(1, ...events.map(estTokens)), [events]);
  const counts = useMemo(() => {
    const rows = turns.flatMap((t) => t.events).filter(isRowEvent);
    return Object.fromEntries(
      FILTERS.map((f) => [f.key, rows.filter((e) => matchesFilter(e, f.key)).length]),
    ) as Record<FilterKey, number>;
  }, [turns]);

  const q = query.trim().toLowerCase();
  const narrowed = filter !== "all" || q.length > 0;
  // Newest turn first, newest step first inside each turn.
  const visible = turns
    .map((turn) => ({
      turn,
      rows: turn.events.filter((e) => matchesFilter(e, filter) && matchesQuery(e, q)).reverse(),
    }))
    .filter(({ turn, rows }) => !narrowed || rows.length > 0 || (filter === "all" && matchesQuery(turn.prompt!, q)))
    .reverse();

  // New items are inserted above the reader. If they've scrolled down, keep what they're
  // looking at in place instead of letting it jump.
  const listRef = useRef<HTMLElement>(null);
  const lastHeight = useRef(0);
  useLayoutEffect(() => {
    const height = listRef.current?.scrollHeight ?? 0;
    const delta = height - lastHeight.current;
    if (scrollRoot && lastHeight.current && delta > 0 && scrollRoot.scrollTop > 120) {
      scrollRoot.scrollTop += delta;
    }
    lastHeight.current = height;
  }, [events.length, scrollRoot]);

  const newestKey = turns[turns.length - 1]?.key;
  const running = payload.run.status === "running";

  // Only the newest turn is open by default; anything the user toggles sticks.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const isOpen = (key: string) => overrides[key] ?? (narrowed || key === newestKey);
  const toggle = (key: string) => setOverrides((o) => ({ ...o, [key]: !(o[key] ?? (narrowed || key === newestKey)) }));

  useEffect(() => {
    if (!selectedEventId) return;
    const owner = turns.find(
      (t) => t.prompt?.id === selectedEventId || t.events.some((e) => e.id === selectedEventId),
    );
    if (owner) setOverrides((o) => ({ ...o, [owner.key]: true }));
    // Only react to a new selection, not to every poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEventId]);

  return (
    <section className="timeline" aria-label="Timeline" ref={listRef}>
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="Filter events">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={`seg-btn${filter === f.key ? " is-on" : ""}`}
              aria-pressed={filter === f.key}
              onClick={() => onFilter(f.key)}
            >
              {muggle ? MUGGLE_FILTERS[f.key] : f.label}
              <span className="seg-count num">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <label className="search">
          <Search size={14} aria-hidden="true" />
          <span className="sr-only">Search events</span>
          <input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={muggle ? "Search what it did…" : "Search commands, files, output…"}
          />
        </label>
      </div>

      {visible.length === 0 && (
        <p className="timeline-empty">
          {narrowed
            ? "Nothing matches this filter."
            : muggle
              ? "Waiting for your first message…"
              : "Waiting for the first prompt…"}
        </p>
      )}

      {visible.map(({ turn, rows }) => (
        <TurnGroup
          key={turn.key}
          turn={turn}
          rows={rows}
          selectedEventId={selectedEventId}
          onSelect={onSelect}
          loops={loops}
          maxTokens={maxTokens}
          inProgress={running && turn.key === newestKey && !turn.end}
          muggle={muggle}
          open={isOpen(turn.key)}
          onToggle={() => {
            toggle(turn.key);
            onFocusTurn(turn.key);
          }}
          narrowed={narrowed}
          focused={turn.key === focusedTurnKey}
        />
      ))}
    </section>
  );
}

function TurnGroup({
  turn,
  rows,
  selectedEventId,
  onSelect,
  loops,
  maxTokens,
  inProgress,
  muggle,
  open,
  onToggle,
  narrowed,
  focused,
}: {
  turn: Turn;
  rows: AgentTraceEvent[];
  selectedEventId: string | null;
  onSelect: (id: string) => void;
  loops: Set<string>;
  maxTokens: number;
  inProgress: boolean;
  muggle: boolean;
  open: boolean;
  onToggle: () => void;
  narrowed: boolean;
  focused: boolean;
}) {
  const prompt = turn.prompt!;
  const promptText = str(prompt.data?.text) ?? prompt.title ?? "";
  const duration = Date.parse(turn.endTs) - Date.parse(turn.startTs);
  const headingId = `turn-${turn.key}`;
  const endStatus = str(turn.end?.data?.status);
  const failed = endStatus === "error" || endStatus === "aborted";

  const footer = inProgress ? (
    <p className="turn-foot is-live" role="status">
      <span className="pulse" aria-hidden="true" /> {muggle ? "Still working on it…" : "Agent is working…"}
    </p>
  ) : turn.end ? (
    <p className={`turn-foot${failed ? " is-danger" : ""}`}>
      {muggle
        ? failed
          ? `Stopped at ${formatClock(turn.end.ts)}`
          : `Finished at ${formatClock(turn.end.ts)}`
        : `Turn ${endStatus ?? "ended"} · ${formatClock(turn.end.ts)}`}
    </p>
  ) : null;

  const bodyId = `turn-body-${turn.key}`;
  const unit = narrowed ? (rows.length === 1 ? "match" : "matches") : muggle ? (rows.length === 1 ? "step" : "steps") : "events";
  const endedAt = turn.end ? formatClock(turn.end.ts).slice(0, 5) : undefined;
  const summary = [
    rows.length ? `${rows.length} ${unit} hidden` : undefined,
    inProgress
      ? muggle
        ? "still working"
        : "running"
      : endedAt
        ? muggle
          ? `${failed ? "stopped" : "finished"} at ${endedAt}`
          : `${endStatus ?? "ended"} ${endedAt}`
        : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article
      className={`turn${inProgress ? " is-live" : ""}${open ? "" : " is-collapsed"}${focused ? " is-focused" : ""}`}
      aria-labelledby={headingId}
    >
      <header className="turn-head">
        <button
          type="button"
          className="turn-prompt"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <ChevronRight size={16} className="turn-chevron" aria-hidden="true" />
          <span className="turn-copy">
            <span id={headingId} className="turn-index">
              {muggle ? `You asked · ${formatClock(prompt.ts)}` : `Turn ${turn.index}`}
            </span>
            <span className="turn-text" dir="auto">
              {promptText}
            </span>
            {!open && <span className="turn-summary">{summary}</span>}
          </span>
        </button>
        <div className="turn-side">
          <dl className="turn-stats">
          <div title={muggle ? "How long it took" : "Turn duration"}>
            <dt>
              <Clock size={12} aria-hidden="true" />
              <span className="sr-only">Duration</span>
            </dt>
            <dd className="num">{inProgress ? (muggle ? "working" : "running") : formatDuration(duration)}</dd>
          </div>
          <div title={muggle ? "Actions taken" : "Tool calls"}>
            <dt>
              <Wrench size={12} aria-hidden="true" />
              <span className="sr-only">{muggle ? "Actions" : "Tool calls"}</span>
            </dt>
            <dd className="num">{muggle ? `${turn.tools} actions` : turn.tools}</dd>
          </div>
          <div title={muggle ? "How much text it went through" : "Estimated tokens into context"}>
            {!muggle && (
              <dt>
                <span className="tok-glyph" aria-hidden="true">
                  tok
                </span>
                <span className="sr-only">Estimated tokens</span>
              </dt>
            )}
            <dd className="num">{muggle ? pagesShort(turn.tokens) : `~${formatTokens(turn.tokens)}`}</dd>
          </div>
          {turn.errors > 0 && (
            <div className="is-danger" title={muggle ? "Problems" : "Errors"}>
              <dt>
                <TriangleExclamationPoint size={12} aria-hidden="true" />
                <span className="sr-only">Errors</span>
              </dt>
              <dd className="num">{turn.errors}</dd>
            </div>
          )}
        </dl>
          <button
            type="button"
            className={`icon-btn${selectedEventId === prompt.id ? " is-on" : ""}`}
            onClick={() => onSelect(prompt.id)}
            aria-label={muggle ? "Show your full message" : "Inspect prompt"}
            title={muggle ? "Show your full message" : "Inspect prompt"}
          >
            <Eye size={15} aria-hidden="true" />
          </button>
        </div>
      </header>

      {open && (
        <div id={bodyId}>
          {inProgress && footer}
          {rows.length > 0 && (
            <ol className="rows">
              {rows.map((event) => (
                <EventRow
                  key={event.id}
                  event={event}
                  selected={selectedEventId === event.id}
                  onSelect={onSelect}
                  repeated={event.type.startsWith("tool.") && loops.has(toolKey(event))}
                  maxTokens={maxTokens}
                  muggle={muggle}
                />
              ))}
            </ol>
          )}
          {!inProgress && footer}
        </div>
      )}
    </article>
  );
}

function EventRow({
  event,
  selected,
  onSelect,
  repeated,
  maxTokens,
  muggle,
}: {
  event: AgentTraceEvent;
  selected: boolean;
  onSelect: (id: string) => void;
  repeated: boolean;
  maxTokens: number;
  muggle: boolean;
}) {
  const kind = kindOf(event);
  const tokens = estTokens(event);
  const heavy = tokens >= HEAVY_TOKENS * 5;
  const slow = (event.durationMs ?? 0) >= SLOW_MS;
  const bar = tokens > 0 && (
    <span className="mini-bar" aria-hidden="true">
      <span style={{ width: `${Math.max(3, (tokens / maxTokens) * 100)}%` }} />
    </span>
  );

  if (muggle) {
    const { text, sub } = humanRow(event);
    const effort = tokens ? effortOf(tokens) : undefined;
    return (
      <li>
        <button
          type="button"
          className={`row is-muggle k-${kind}${selected ? " is-selected" : ""}${heavy ? " is-heavy" : ""}`}
          aria-pressed={selected}
          onClick={() => onSelect(event.id)}
        >
          <span className="row-time num">{formatClock(event.ts).slice(0, 5)}</span>
          <EventIcon event={event} />
          <span className="row-main is-stacked">
            <span className="row-sentence" dir="auto">
              {text}
              {repeated && <span className="flag flag-warn">again</span>}
            </span>
            {sub && (
              <span className="row-sub" dir="auto">
                {sub}
              </span>
            )}
          </span>
          <span className="row-tokens" title={tokens ? `${pagesOf(tokens)} of text (~${formatTokens(tokens)} tokens)` : undefined}>
            {effort && (
              <>
                {bar}
                <span className={`effort effort-${effort}`}>{effort}</span>
              </>
            )}
          </span>
          <span className="row-duration num">
            {event.durationMs != null && event.durationMs >= 1000 ? formatDuration(event.durationMs) : ""}
          </span>
        </button>
      </li>
    );
  }

  const { label, detail } = rowText(event);
  return (
    <li>
      <button
        type="button"
        className={`row k-${kind}${selected ? " is-selected" : ""}${heavy ? " is-heavy" : ""}`}
        aria-pressed={selected}
        onClick={() => onSelect(event.id)}
      >
        <span className="row-time num">{formatClock(event.ts)}</span>
        <EventIcon event={event} />
        <span className="row-main">
          <span className="row-label">{label}</span>
          <span className="row-detail" dir="auto">
            {detail}
          </span>
          {(repeated || slow || heavy) && (
            <span className="row-flags">
              {heavy && (
                <span className="flag flag-warn">
                  <Flame size={11} aria-hidden="true" /> heavy
                </span>
              )}
              {repeated && (
                <span className="flag flag-warn">
                  <Repeat size={11} aria-hidden="true" /> repeated
                </span>
              )}
              {slow && (
                <span className="flag flag-info">
                  <Timer size={11} aria-hidden="true" /> slow
                </span>
              )}
            </span>
          )}
        </span>
        <span className="row-tokens" title={tokens ? `~${tokens.toLocaleString()} tokens (estimated)` : undefined}>
          {tokens > 0 ? (
            <>
              {bar}
              <span className="num">~{formatTokens(tokens)}</span>
            </>
          ) : (
            <span className="num faint" aria-hidden="true">
              —
            </span>
          )}
        </span>
        <span className="row-duration num">{event.durationMs != null ? formatDuration(event.durationMs) : ""}</span>
      </button>
    </li>
  );
}
