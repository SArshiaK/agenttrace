import { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyRound,
  LoaderCircle,
  Download,
  SendHorizontal,
  Square,
  Terminal,
  MessageSquarePlus,
} from "lucide-react";

type AgentStatus = {
  available: boolean;
  loggedIn: boolean;
  path: string | null;
  version: string | null;
  account: string | null;
  install?: string;
};

type SetupDone = {
  type: "done";
  ok: boolean;
  error?: string;
  path?: string | null;
  account?: string | null;
  status?: AgentStatus;
};

type Props = {
  source: "cursor";
  project: string | undefined;
  /** Only pass a run that was started via in-panel CLI (`via: cursor-cli`). */
  resumeRunId: string | null;
  onStarted: (runId: string) => void;
  /** Clear the selected timeline run so the next send starts fresh. */
  onNewChat?: () => void;
};

async function streamSetup(
  url: string,
  onLog: (line: string) => void,
): Promise<SetupDone> {
  const res = await fetch(url, { method: "POST" });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(text || res.statusText || "Request failed");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let done: SetupDone | null = null;
  while (true) {
    const { value, done: eof } = await reader.read();
    if (eof) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.trim();
      if (!line) continue;
      let msg: { type?: string; line?: string } & Partial<SetupDone>;
      try {
        msg = JSON.parse(line) as typeof msg;
      } catch {
        onLog(line);
        continue;
      }
      if (msg.type === "log" && typeof msg.line === "string") onLog(msg.line);
      else if (msg.type === "done") done = msg as SetupDone;
    }
  }
  if (buf.trim()) {
    try {
      const msg = JSON.parse(buf.trim()) as SetupDone & { type?: string; line?: string };
      if (msg.type === "log" && typeof msg.line === "string") onLog(msg.line);
      else if (msg.type === "done") done = msg;
    } catch {
      onLog(buf.trim());
    }
  }
  if (!done) throw new Error("Setup ended with no result.");
  return done;
}

/** Cursor often stores workspaces as `/d:/foo` — turn into `D:\foo`. */
function normalizeProjectInput(value: string): string {
  let folder = value.trim().replace(/\\/g, "/");
  const driveSlash = folder.match(/^\/([A-Za-z]):(\/.*)?$/);
  if (driveSlash) folder = `${driveSlash[1].toUpperCase()}:${driveSlash[2] ?? "/"}`;
  const wsl = folder.match(/^\/mnt\/([A-Za-z])(\/.*)?$/);
  if (wsl) folder = `${wsl[1].toUpperCase()}:${wsl[2] ?? "/"}`;
  return folder.replace(/\//g, "\\");
}

export function ChatComposer({ source, project, resumeRunId, onStarted, onNewChat }: Props) {
  const [text, setText] = useState("");
  const [projectPath, setProjectPath] = useState(() =>
    project ? normalizeProjectInput(project) : "",
  );
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [phase, setPhase] = useState<"idle" | "sending" | "running">("idle");
  const [activeRunId, setActiveRunId] = useState<string | null>(resumeRunId);
  /** After New chat, ignore parent resumeRunId until the user sends or picks a CLI run. */
  const [freshSession, setFreshSession] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [setupBusy, setSetupBusy] = useState<"install" | "login" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [setupLog, setSetupLog] = useState<string[]>([]);
  const logEndRef = useRef<HTMLPreElement | null>(null);
  const sendLock = useRef(false);

  useEffect(() => {
    if (project) setProjectPath(normalizeProjectInput(project));
  }, [project]);

  useEffect(() => {
    // Follow resume id from parent only when idle and not in "new chat" mode.
    if (phase !== "idle" || freshSession) return;
    setActiveRunId(resumeRunId);
  }, [resumeRunId, phase, freshSession]);

  useEffect(() => {
    logEndRef.current?.scrollTo({ top: logEndRef.current.scrollHeight });
  }, [setupLog]);

  useEffect(() => {
    if (!activeRunId || phase !== "running") return;
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(`/api/agent/busy?runId=${encodeURIComponent(activeRunId)}`);
        const data = (await res.json()) as { busy?: boolean };
        if (!alive) return;
        if (!data.busy) {
          setPhase("idle");
          setPendingPrompt(null);
          setHint("Done.");
        }
      } catch {
        // ignore transient poll errors
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 1200);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [activeRunId, phase]);

  const refreshStatus = useCallback(async () => {
    const res = await fetch("/api/agent/status");
    const data = (await res.json()) as AgentStatus;
    setStatus(data);
    return data;
  }, []);

  useEffect(() => {
    let alive = true;
    refreshStatus().catch(() => {
      if (alive) setStatus({ available: false, loggedIn: false, path: null, version: null, account: null });
    });
    return () => {
      alive = false;
    };
  }, [refreshStatus]);

  const ready = Boolean(status?.available && status.loggedIn);
  const inFlight = phase !== "idle";
  const canSend = Boolean(text.trim() && projectPath.trim() && !inFlight && !setupBusy && ready);

  const appendLog = useCallback((line: string) => {
    setSetupLog((prev) => [...prev.slice(-200), line]);
  }, []);

  async function install() {
    setSetupBusy("install");
    setError(null);
    setHint(null);
    setSetupLog([]);
    try {
      const done = await streamSetup("/api/agent/install", appendLog);
      if (done.status) setStatus(done.status);
      else await refreshStatus();
      if (!done.ok) throw new Error(done.error ?? "Install failed");
      setHint("CLI installed. Next: log in.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSetupBusy(null);
    }
  }

  async function login() {
    setSetupBusy("login");
    setError(null);
    setHint(null);
    setSetupLog([]);
    try {
      const done = await streamSetup("/api/agent/login", appendLog);
      if (done.status) setStatus(done.status);
      else await refreshStatus();
      if (!done.ok) throw new Error(done.error ?? "Login failed");
      setHint(done.account ? `Logged in as ${done.account}` : "Logged in.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await refreshStatus().catch(() => undefined);
    } finally {
      setSetupBusy(null);
    }
  }

  async function send() {
    const prompt = text.trim();
    const folder = normalizeProjectInput(projectPath);
    if (!prompt || !folder || inFlight || !ready || sendLock.current) return;
    sendLock.current = true;
    if (folder !== projectPath.trim()) setProjectPath(folder);

    // Optimistic: clear box + show status immediately so send feels acknowledged.
    setText("");
    setPendingPrompt(prompt);
    setPhase("sending");
    setError(null);
    setHint(null);

    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          project: folder,
          runId: activeRunId ?? undefined,
          source,
        }),
      });
      const data = (await res.json()) as { runId?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      if (!data.runId) throw new Error("Agent started but returned no run id.");
      setFreshSession(false);
      setActiveRunId(data.runId);
      setPhase("running");
      onStarted(data.runId);
      setHint(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("idle");
      setPendingPrompt(null);
      setText(prompt);
    } finally {
      sendLock.current = false;
    }
  }

  async function stop() {
    const id = activeRunId;
    if (!id || phase === "idle") return;
    setError(null);
    try {
      const res = await fetch("/api/agent/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: id }),
      });
      const data = (await res.json()) as { stopped?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      setPhase("idle");
      setPendingPrompt(null);
      setHint(data.stopped ? "Stopped." : "Nothing was running.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function newChat() {
    if (inFlight) return;
    setFreshSession(true);
    setActiveRunId(null);
    setPendingPrompt(null);
    setPhase("idle");
    setError(null);
    setHint(null);
    setText("");
    onNewChat?.();
  }

  return (
    <div className="chat-composer">
      <div className="chat-composer-inner">
        {!ready && (
          <div className="chat-setup">
            <p className="chat-setup-title">Cursor Agent CLI</p>
            <p className="chat-setup-copy">
              {!status
                ? "Checking CLI…"
                : !status.available
                  ? "Not installed on this machine. Install once, then log in."
                  : "Installed, but not logged in. Log in so this panel can send chats."}
            </p>
            <div className="chat-setup-actions">
              <button
                type="button"
                className="chat-setup-btn"
                disabled={setupBusy !== null || status?.available === true}
                onClick={() => void install()}
              >
                {setupBusy === "install" ? (
                  <LoaderCircle size={14} className="spin" aria-hidden="true" />
                ) : (
                  <Download size={14} aria-hidden="true" />
                )}
                {status?.available ? "Installed" : setupBusy === "install" ? "Installing…" : "Install"}
              </button>
              <button
                type="button"
                className="chat-setup-btn is-primary"
                disabled={setupBusy !== null || !status?.available || status.loggedIn}
                onClick={() => void login()}
              >
                {setupBusy === "login" ? (
                  <LoaderCircle size={14} className="spin" aria-hidden="true" />
                ) : (
                  <KeyRound size={14} aria-hidden="true" />
                )}
                {status?.loggedIn ? "Logged in" : setupBusy === "login" ? "Waiting…" : "Log in"}
              </button>
            </div>
            {(setupLog.length > 0 || setupBusy) && (
              <pre className="chat-setup-log" ref={logEndRef} aria-live="polite">
                {setupLog.length > 0 ? setupLog.join("\n") : "Waiting for installer output…"}
              </pre>
            )}
          </div>
        )}

        <label className="chat-project">
          <span className="sr-only">Project folder</span>
          <Terminal size={14} aria-hidden="true" />
          <input
            value={projectPath}
            onChange={(e) => setProjectPath(e.target.value)}
            placeholder="Absolute project path (e.g. D:\projects\my-app)…"
            spellCheck={false}
            disabled={!ready || inFlight}
            title="Workspace folder for the Cursor Agent CLI"
          />
        </label>

        {inFlight ? (
          <div className="chat-status" role="status" aria-live="polite">
            <LoaderCircle size={14} className="spin" aria-hidden="true" />
            <div className="chat-status-copy">
              <strong>{phase === "sending" ? "Sending…" : "Agent working…"}</strong>
              {pendingPrompt && <span className="chat-status-prompt">{pendingPrompt}</span>}
            </div>
          </div>
        ) : freshSession ? (
          <div className="chat-status is-fresh" role="status" aria-live="polite">
            <MessageSquarePlus size={14} aria-hidden="true" />
            <div className="chat-status-copy">
              <strong>New chat ready</strong>
              <span className="chat-status-prompt">Next message starts a fresh CLI session.</span>
            </div>
          </div>
        ) : null}

        <div className="chat-row">
          <textarea
            className="chat-input"
            rows={2}
            value={text}
            disabled={!ready || inFlight || setupBusy !== null}
            placeholder={
              !ready
                ? "Install + log in above to chat from this panel…"
                : phase === "sending"
                  ? "Sending your message…"
                  : phase === "running"
                    ? "Agent is running — hit Stop to cancel…"
                    : activeRunId
                      ? "Message Cursor Agent (continues this CLI chat)…"
                      : "Message Cursor Agent to start a new chat…"
            }
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          {inFlight ? (
            <button
              type="button"
              className="chat-stop"
              onClick={() => void stop()}
              aria-label="Stop agent"
              title="Stop Cursor Agent"
              disabled={phase === "sending"}
            >
              {phase === "sending" ? (
                <LoaderCircle size={16} className="spin" aria-hidden="true" />
              ) : (
                <Square size={14} aria-hidden="true" />
              )}
            </button>
          ) : (
            <button
              type="button"
              className="chat-send"
              disabled={!canSend}
              onClick={() => void send()}
              aria-label="Send"
              title="Send via Cursor CLI"
            >
              <SendHorizontal size={16} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="chat-meta">
          {ready && (
            <button
              type="button"
              className={`chat-new${freshSession ? " is-active" : ""}`}
              onClick={newChat}
              disabled={inFlight}
              title="Start a fresh CLI session (don't resume)"
            >
              <MessageSquarePlus size={13} aria-hidden="true" />
              {freshSession ? "New chat ready" : "New chat"}
            </button>
          )}
          {status?.loggedIn && status.account && (
            <p className="chat-hint">
              Signed in as {status.account}
              {status.version ? ` · ${status.version}` : ""}
              {freshSession || !activeRunId ? " · new session" : " · continuing CLI chat"}
            </p>
          )}
          {hint && <p className="chat-hint">{hint}</p>}
        </div>
        {error && (
          <p className="chat-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
