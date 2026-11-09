import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TriangleExclamationPoint } from "lucide-react";
import type { RunMeta, RunPayload } from "./types";
import { groupTurns, type FilterKey } from "./lib/events";
import type { Scope } from "./components/SidePanel";
import type { Mode } from "./lib/humanize";
import { Sidebar } from "./components/Sidebar";
import { RunHeader } from "./components/RunHeader";
import { Timeline } from "./components/Timeline";
import { SidePanel } from "./components/SidePanel";
import { EmptyState } from "./components/EmptyState";

const POLL_MS = 2000;
const MODE_KEY = "agenttrace.mode";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json();
}

export function App() {
  const [runs, setRuns] = useState<RunMeta[] | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [payload, setPayload] = useState<RunPayload | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const [live, setLive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [scrollRoot, setScrollRoot] = useState<HTMLElement | null>(null);
  const [focusedTurnKey, setFocusedTurnKey] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("turn");
  const [mode, setMode] = useState<Mode>(() =>
    localStorage.getItem(MODE_KEY) === "technical" ? "technical" : "muggle",
  );
  const liveRef = useRef(live);
  liveRef.current = live;

  const changeMode = useCallback((next: Mode) => {
    setMode(next);
    localStorage.setItem(MODE_KEY, next);
  }, []);

  useEffect(() => {
    let alive = true;
    const initial = new URLSearchParams(window.location.search).get("run");
    const load = () => {
      setNow(Date.now());
      return getJson<{ runs: RunMeta[] }>("/api/runs")
        .then((data) => {
          if (!alive) return;
          setRuns(data.runs);
          setSelectedRunId((prev) => {
            if (prev && data.runs.some((r) => r.id === prev)) return prev;
            if (initial && data.runs.some((r) => r.id === initial)) return initial;
            return data.runs[0]?.id ?? null;
          });
        })
        .catch((e) => alive && setError(String(e)));
    };
    load();
    const timer = setInterval(() => liveRef.current && load(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!selectedRunId) return;
    let alive = true;
    const load = () =>
      getJson<RunPayload>(`/api/runs/${encodeURIComponent(selectedRunId)}`)
        .then((data) => {
          if (!alive) return;
          setError(null);
          setPayload(data);
        })
        .catch((e) => alive && setError(String(e)));
    load();
    if (!live) return () => void (alive = false);
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [selectedRunId, live]);

  const selectRun = useCallback((id: string) => {
    setSelectedRunId(id);
    setPayload((prev) => (prev?.run.id === id ? prev : null));
    setSelectedEventId(null);
    setFilter("all");
    setQuery("");
    setFocusedTurnKey(null);
    setScope("turn");
    window.history.replaceState(null, "", `?run=${encodeURIComponent(id)}`);
  }, []);

  const turns = useMemo(() => (payload ? groupTurns(payload.events).filter((t) => t.prompt) : []), [payload]);
  // null = follow the newest message.
  const focusedTurn = turns.find((t) => t.key === focusedTurnKey) ?? turns[turns.length - 1];

  const focusTurn = useCallback((key: string) => {
    setFocusedTurnKey(key);
    setScope("turn");
  }, []);

  const selectEvent = useCallback(
    (id: string) => {
      setSelectedEventId(id);
      setPanelOpen(true);
      const owner = turns.find((t) => t.raw.some((e) => e.id === id));
      if (owner) setFocusedTurnKey(owner.key);
    },
    [turns],
  );

  const selectedEvent = payload?.events.find((e) => e.id === selectedEventId) ?? null;
  const showEmpty = runs !== null && runs.length === 0;

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to timeline
      </a>
      <Sidebar runs={runs ?? []} loading={runs === null} selectedId={selectedRunId} onSelect={selectRun} now={now} />

      <main className="main" id="main" ref={setScrollRoot} tabIndex={-1}>
        {error && (
          <div className="banner" role="alert">
            <TriangleExclamationPoint size={14} aria-hidden="true" />
            <span>Can't reach the local server: {error}</span>
          </div>
        )}
        {showEmpty && <EmptyState />}
        {!showEmpty && !payload && !error && <p className="loading">Loading session…</p>}
        {payload && (
          <>
            <RunHeader
              payload={payload}
              runs={runs ?? []}
              onSelectRun={selectRun}
              now={now}
              live={live}
              onToggleLive={() => setLive((v) => !v)}
              onOpenPanel={() => setPanelOpen(true)}
              mode={mode}
              onMode={changeMode}
            />
            <Timeline
              key={payload.run.id}
              payload={payload}
              turns={turns}
              focusedTurnKey={scope === "turn" ? focusedTurn?.key : undefined}
              onFocusTurn={focusTurn}
              filter={filter}
              onFilter={setFilter}
              query={query}
              onQuery={setQuery}
              selectedEventId={selectedEventId}
              onSelect={selectEvent}
              scrollRoot={scrollRoot}
              mode={mode}
            />
          </>
        )}
      </main>

      {payload && (
        <>
          <SidePanel
            payload={payload}
            selectedEvent={selectedEvent}
            onSelectEvent={selectEvent}
            onCloseEvent={() => setSelectedEventId(null)}
            open={panelOpen}
            onClose={() => setPanelOpen(false)}
            mode={mode}
            turn={focusedTurn}
            scope={focusedTurn ? scope : "session"}
            onScope={setScope}
          />
          {panelOpen && <div className="scrim" onClick={() => setPanelOpen(false)} aria-hidden="true" />}
        </>
      )}
    </div>
  );
}
