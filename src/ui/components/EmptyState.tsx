import { Activity } from "lucide-react";

export function EmptyState() {
  return (
    <div className="empty-state">
      <span className="empty-mark" aria-hidden="true">
        <Activity size={22} />
      </span>
      <h1>No sessions yet</h1>
      <p>Connect Cursor once and every chat shows up here live.</p>
      <ol className="steps">
        <li>
          <span className="step-n num">1</span>
          <div>
            Install the hooks
            <code className="cmd">npm run at -- setup-cursor</code>
          </div>
        </li>
        <li>
          <span className="step-n num">2</span>
          <div>Send any message in Cursor</div>
        </li>
        <li>
          <span className="step-n num">3</span>
          <div>Watch it appear here (updates every 2s)</div>
        </li>
      </ol>
    </div>
  );
}
