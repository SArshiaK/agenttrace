import { Activity } from "lucide-react";
import type { RunMeta } from "../types";
import { formatRelative } from "../lib/format";

type Props = {
  runs: RunMeta[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  now: number;
};

export function Sidebar({ runs, loading, selectedId, onSelect, now }: Props) {
  return (
    <aside className="sidebar" aria-label="Sessions">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <Activity size={16} strokeWidth={2.25} />
        </span>
        <span className="brand-name">agenttrace</span>
      </div>

      <div className="side-label">
        <span>Sessions</span>
        <span className="side-count num">{runs.length}</span>
      </div>

      <nav className="session-nav">
        {loading && <p className="side-empty">Loading…</p>}
        {!loading && runs.length === 0 && <p className="side-empty">No sessions recorded yet.</p>}
        <ul className="session-list">
          {runs.map((run) => {
            const active = run.id === selectedId;
            const live = run.status === "running";
            return (
              <li key={run.id}>
                <button
                  type="button"
                  className={`session${active ? " is-active" : ""}`}
                  aria-current={active ? "true" : undefined}
                  onClick={() => onSelect(run.id)}
                >
                  <span className={`status-dot s-${run.status}`} aria-hidden="true" />
                  <span className="session-body">
                    <span className="session-title" dir="auto">
                      {run.title}
                    </span>
                    <span className="session-meta">
                      {live ? <span className="live-text">Live</span> : <span>{run.status}</span>}
                      <span aria-hidden="true">·</span>
                      <span>{formatRelative(run.updatedAt, now)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="num">{run.eventCount} events</span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <p className="side-foot">Local only · ~/.agenttrace</p>
    </aside>
  );
}
