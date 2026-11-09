import { Activity } from "lucide-react";
import { SOURCE_META, type SourceId } from "../lib/source";

type Props = {
  source: SourceId;
};

export function EmptyState({ source }: Props) {
  const meta = SOURCE_META[source];

  return (
    <div className="empty-state">
      <span className="empty-mark" aria-hidden="true">
        <Activity size={22} />
      </span>
      <h1>No {meta.short} sessions yet</h1>
      <p>Connect {meta.label} once and every chat shows up here live.</p>
      <ol className="steps">
        <li>
          <span className="step-n num">1</span>
          <div>
            Install the hooks
            <code className="cmd">{meta.setup}</code>
          </div>
        </li>
        <li>
          <span className="step-n num">2</span>
          <div>Send any message in {meta.label}</div>
        </li>
        <li>
          <span className="step-n num">3</span>
          <div>Watch it appear here (updates every 2s)</div>
        </li>
      </ol>
    </div>
  );
}
