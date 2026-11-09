import { useCallback, useEffect, useMemo, useState } from "react";
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
const NAV_KEY = "agenttrace.nav";
const PANEL_KEY = "agenttrace.panel";

function readFlag(key: string, fallback: boolean): boolean {
  const value = localStorage.getItem(key);
  if (value === null) return fallback;
  return value === "1";
}

function writeFlag(key: string, value: boolean): void {
  localStorage.setItem(key, value ? "1" : "0");
}

/** Prefer open on desktop, closed as overlay on narrow screens, unless the user chose. */
function initialNavOpen(): boolean {
  return readFlag(NAV_KEY, !window.matchMedia("(max-width: 820px)").matches);
}

/** Insights stay closed by default so the timeline is the first thing you see. */
function initialPanelOpen(): boolean {
  return readFlag(PANEL_KEY, false);
}

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
  const [error, setError] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(initialNavOpen);
  const [panelOpen, setPanelOpen] = useState(initialPanelOpen);
  const [now, setNow] = useState(() => Date.now());
  const [scrollRoot, setScrollRoot] = useState<HTMLElement | null>(null);
  const [focusedTurnKey, setFocusedTurnKey] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("turn");
  const [mode, setMode] = useState<Mode>(() =>
    localStorage.getItem(MODE_KEY) === "technical" ? "technical" : "muggle",
  );

  const changeMode = useCallback((next: Mode) => {
    setMode(next);
    localStorage.setItem(MODE_KEY, next);
  }, []);

  const toggleNav = useCallback(() => {
    setNavOpen((prev) => {
      const next = !prev;
      writeFlag(NAV_KEY, next);
      return next;
    });
  }, []);

  const togglePanel = useCallback(() => {
    setPanelOpen((prev) => {
      const next = !prev;
      writeFlag(PANEL_KEY, next);
      return next;
    });
  }, []);

  const setPanel = useCallback((open: boolean) => {
    setPanelOpen(open);
    writeFlag(PANEL_KEY, open);
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
    const timer = setInterval(load, POLL_MS);
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
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [selectedRunId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (panelOpen) {
        setPanel(false);
        return;
      }
      if (navOpen && window.matchMedia("(max-width: 820px)").matches) {
        setNavOpen(false);
        writeFlag(NAV_KEY, false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen, panelOpen, setPanel]);

  const selectRun = useCallback((id: string) => {
    setSelectedRunId(id);
    setPayload((prev) => (prev?.run.id === id ? prev : null));
    setSelectedEventId(null);
    setFilter("all");
    setQuery("");
    setFocusedTurnKey(null);
    setScope("turn");
    window.history.replaceState(null, "", `?run=${encodeURIComponent(id)}`);
    if (window.matchMedia("(max-width: 820px)").matches) {
      setNavOpen(false);
      writeFlag(NAV_KEY, false);
    }
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
      setPanel(true);
      const owner = turns.find((t) => t.raw.some((e) => e.id === id));
      if (owner) setFocusedTurnKey(owner.key);
    },
    [turns, setPanel],
  );

  const selectedEvent = payload?.events.find((e) => e.id === selectedEventId) ?? null;
  const showEmpty = runs !== null && runs.length === 0;

  return (
    <div
      className={[
        "shell",
        navOpen ? "is-nav-open" : "is-nav-collapsed",
        payload && panelOpen ? "is-panel-open" : "is-panel-collapsed",
      ].join(" ")}
    >
      <a className="skip-link" href="#main">
        Skip to timeline
      </a>
      <Sidebar
        runs={runs ?? []}
        loading={runs === null}
        selectedId={selectedRunId}
        onSelect={selectRun}
        now={now}
        open={navOpen}
        onToggle={toggleNav}
      />

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
              panelOpen={panelOpen}
              onTogglePanel={togglePanel}
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
        <SidePanel
          payload={payload}
          selectedEvent={selectedEvent}
          onSelectEvent={selectEvent}
          onCloseEvent={() => setSelectedEventId(null)}
          open={panelOpen}
          onClose={() => setPanel(false)}
          mode={mode}
          turn={focusedTurn}
          scope={focusedTurn ? scope : "session"}
          onScope={setScope}
        />
      )}

      {(navOpen || panelOpen) && (
        <div
          className="scrim"
          onClick={() => {
            if (window.matchMedia("(max-width: 1100px)").matches && panelOpen) setPanel(false);
            if (window.matchMedia("(max-width: 820px)").matches && navOpen) {
              setNavOpen(false);
              writeFlag(NAV_KEY, false);
            }
          }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
