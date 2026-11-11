import { useMemo, useState } from "react";
import { Activity, ChevronRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { RunMeta } from "../types";
import { formatRelative } from "../lib/format";
import { groupByProject } from "../lib/projects";
import { SOURCES, SOURCE_META, type SourceId } from "../lib/source";

type Props = {
  runs: RunMeta[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  now: number;
  open: boolean;
  onToggle: () => void;
  source: SourceId;
  onSource: (source: SourceId) => void;
  onBackToSources: () => void;
};

function runHref(source: SourceId, runId: string): string {
  return `?source=${encodeURIComponent(source)}&run=${encodeURIComponent(runId)}`;
}

export function Sidebar({
  runs,
  loading,
  selectedId,
  onSelect,
  now,
  open,
  onToggle,
  source,
  onSource,
  onBackToSources,
}: Props) {
  const groups = useMemo(() => groupByProject(runs), [runs]);
  // undefined = follow default (open only the project that holds the selected chat)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <aside
      id="sessions-nav"
      className={`sidebar${open ? " is-open" : " is-collapsed"}`}
      aria-label="Sessions"
    >
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">
          <Activity size={16} strokeWidth={2.25} />
        </span>
        <span className="brand-name">agenttrace</span>
        <button
          type="button"
          className="icon-btn side-toggle"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls="sessions-nav"
          aria-label={open ? "Collapse projects sidebar" : "Expand projects sidebar"}
          title={open ? "Collapse sidebar" : "Expand sidebar"}
        >
          {open ? <PanelLeftClose size={16} aria-hidden="true" /> : <PanelLeftOpen size={16} aria-hidden="true" />}
        </button>
      </div>

      <div className="side-content" aria-hidden={!open} inert={!open ? true : undefined}>
        <div className="source-switch" role="group" aria-label="Harness">
          {SOURCES.map((id) => (
            <button
              key={id}
              type="button"
              className={`source-switch-btn${source === id ? " is-on" : ""}`}
              aria-pressed={source === id}
              onClick={() => onSource(id)}
            >
              {SOURCE_META[id].short}
            </button>
          ))}
          <button type="button" className="source-switch-all" onClick={onBackToSources} title="All harnesses">
            All
          </button>
        </div>

        <nav className="session-nav" aria-label={`${SOURCE_META[source].label} projects`}>
          {loading && <p className="side-empty">Loading…</p>}
          {!loading && runs.length === 0 && (
            <p className="side-empty">No {SOURCE_META[source].short} sessions yet.</p>
          )}
          {groups.map((group) => {
            const hasActive = group.runs.some((r) => r.id === selectedId);
            const groupOpen = !(collapsed[group.key] ?? !hasActive);
            const live = group.runs.some((r) => r.status === "running");
            const listId = `project-${group.key}`;
            return (
              <section key={group.key} className={`project${hasActive ? " has-active" : ""}`}>
                <button
                  type="button"
                  className="project-head"
                  aria-expanded={groupOpen}
                  aria-controls={listId}
                  title={group.path}
                  onClick={() => setCollapsed((c) => ({ ...c, [group.key]: groupOpen }))}
                >
                  <ChevronRight size={14} className="project-chevron" aria-hidden="true" />
                  <span className="project-name">{group.name}</span>
                  {live && <span className="project-live" aria-label="has a live chat" />}
                  <span className="project-count num" aria-label={`${group.runs.length} chats`}>
                    {group.runs.length}
                  </span>
                </button>
                {groupOpen && (
                  <ul className="session-list" id={listId}>
                    {group.runs.map((run) => {
                      const active = run.id === selectedId;
                      const running = run.status === "running";
                      const when = formatRelative(run.updatedAt, now);
                      return (
                        <li key={run.id}>
                          <a
                            href={runHref(source, run.id)}
                            className={`session${active ? " is-active" : ""}${running ? " is-live" : ""}`}
                            aria-current={active ? "page" : undefined}
                            aria-label={`${run.title}, ${running ? "live" : run.status}, ${when}`}
                            onClick={(e) => {
                              // Keep in-app selection for plain left-clicks; let the browser
                              // handle new-tab / middle-click / modified clicks via href.
                              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                              e.preventDefault();
                              onSelect(run.id);
                            }}
                          >
                            <span className={`status-dot s-${run.status}`} aria-hidden="true" />
                            <span className="session-title" dir="auto">
                              {run.title}
                            </span>
                            <span className={`session-when${running ? " is-live" : ""}`}>
                              {running ? "Live" : when}
                            </span>
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </nav>

        <p className="side-foot">Local only · {SOURCE_META[source].label}</p>
      </div>
    </aside>
  );
}
