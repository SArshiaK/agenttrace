import { useMemo, useState } from "react";
import { Activity, ChevronRight, Folder } from "lucide-react";
import type { RunMeta } from "../types";
import { formatRelative } from "../lib/format";
import { groupByProject } from "../lib/projects";

type Props = {
  runs: RunMeta[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  now: number;
};

export function Sidebar({ runs, loading, selectedId, onSelect, now }: Props) {
  const groups = useMemo(() => groupByProject(runs), [runs]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <aside className="sidebar" aria-label="Sessions">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <Activity size={16} strokeWidth={2.25} />
        </span>
        <span className="brand-name">agenttrace</span>
      </div>

      <div className="side-label">
        <span>Projects</span>
        <span className="side-count num">{groups.length}</span>
      </div>

      <nav className="session-nav">
        {loading && <p className="side-empty">Loading…</p>}
        {!loading && runs.length === 0 && <p className="side-empty">No sessions recorded yet.</p>}
        {groups.map((group) => {
          const hasActive = group.runs.some((r) => r.id === selectedId);
          const open = !(collapsed[group.key] ?? false);
          const live = group.runs.some((r) => r.status === "running");
          const listId = `project-${group.key}`;
          return (
            <section key={group.key} className={`project${hasActive ? " has-active" : ""}`}>
              <button
                type="button"
                className="project-head"
                aria-expanded={open}
                aria-controls={listId}
                title={group.path}
                onClick={() => setCollapsed((c) => ({ ...c, [group.key]: open }))}
              >
                <ChevronRight size={14} className="project-chevron" aria-hidden="true" />
                <Folder size={14} className="project-icon" aria-hidden="true" />
                <span className="project-name">{group.name}</span>
                {live && <span className="project-live" aria-label="has a live chat" />}
                <span className="side-count num">{group.runs.length}</span>
              </button>
              {open && (
                <ul className="session-list" id={listId}>
                  {group.runs.map((run) => {
                    const active = run.id === selectedId;
                    const running = run.status === "running";
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
                              {running ? <span className="live-text">Live</span> : <span>{run.status}</span>}
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
              )}
            </section>
          );
        })}
      </nav>

      <p className="side-foot">Local only · ~/.agenttrace</p>
    </aside>
  );
}
