import type { CSSProperties } from "react";
import { Activity, ArrowRight, Code2, Sparkles, Terminal } from "lucide-react";
import { SOURCES, SOURCE_META, type SourceId } from "../lib/source";

type Props = {
  counts: Record<SourceId, number>;
  onPick: (source: SourceId) => void;
};

const ICONS: Record<SourceId, typeof Code2> = {
  cursor: Code2,
  grok: Sparkles,
  claude: Terminal,
};

export function SourcePicker({ counts, onPick }: Props) {
  return (
    <div className="source-gate">
      <div className="source-atmosphere" aria-hidden="true">
        <span className="source-atmosphere-grid" />
        <span className="source-atmosphere-glow" />
        <span className="source-atmosphere-trace" />
      </div>

      <header className="source-gate-brand">
        <span className="source-gate-mark" aria-hidden="true">
          <Activity size={20} strokeWidth={2.25} />
        </span>
        <p className="source-gate-kicker">Local agent observability</p>
        <h1 className="source-gate-title">agenttrace</h1>
        <p className="source-gate-sub">
          Choose a harness. Same timeline, same insights — only the sessions change.
        </p>
      </header>

      <div className="source-grid" role="group" aria-label="Choose a harness">
        {SOURCES.map((id, index) => {
          const meta = SOURCE_META[id];
          const n = counts[id];
          const Icon = ICONS[id];
          return (
            <button
              key={id}
              type="button"
              className={`source-card source-${id}${meta.ready ? "" : " is-soon"}`}
              style={{ "--stagger": String(index) } as CSSProperties}
              onClick={() => onPick(id)}
            >
              <span className="source-card-icon" aria-hidden="true">
                <Icon size={18} strokeWidth={2} />
              </span>
              <span className="source-card-top">
                <span className="source-card-name">{meta.label}</span>
                {!meta.ready && <span className="source-badge">Soon</span>}
              </span>
              <span className="source-card-blurb">{meta.blurb}</span>
              <span className="source-card-foot">
                <span className="source-card-count num">
                  {n === 0 ? "No sessions yet" : `${n} session${n === 1 ? "" : "s"}`}
                </span>
                <span className="source-card-cta">
                  {meta.ready ? "Open" : "Preview"}
                  <ArrowRight size={15} aria-hidden="true" />
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
