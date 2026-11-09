# agenttrace

**Observability for AI coding agents — see exactly what your agent did, where it looped, and what it changed.**

Local CLI + lightweight web UI that records an AI coding-agent run (tools, files, costs, loops, failures) and turns it into a clear timeline you can inspect, share, and debug.

## Why this exists

Everyone is shipping agents (Cursor, Claude Code, Codex, OpenCode). Almost nobody ships the plumbing underneath:

- What tools were called?
- Which files were read/edited?
- Where did it loop or waste tokens?
- What failed silently?
- How much did this run cost/time?

`agenttrace` owns that gap.

## Why not just read agent logs?

Raw logs are noisy, incomplete across tools, and painful to compare. Agenttrace stores a **portable JSONL event stream**, derives simple health insights, and gives you a timeline UI that answers “what happened?” in seconds.

## Trace Cursor automatically

```powershell
npm install
npm run at -- setup-cursor          # this project → .cursor/hooks.json
npm run at -- setup-cursor --global # or every project → ~/.cursor/hooks.json
npm start                           # live UI on http://127.0.0.1:7379
```

Send a message in Cursor. Each chat becomes one run, updated live:

- your prompts, the agent's responses and thinking
- every tool call (Shell, Read, Grep, edits, MCP) with duration and output
- failed tool calls, file edits, context compaction
- **where the context text came from**: estimated tokens per step, heaviest steps, per-tool totals, and the real context size Cursor reports at compaction

Secrets that look like API keys or tokens are redacted before anything is written. Hook failures never block Cursor; they're logged to `~/.agenttrace/hook-errors.log`.

### What's exact and what's estimated

The UI tags every number `exact` or `est.` so it's always clear which is which.

| Exact (reported by Cursor) | Estimated by agenttrace |
|---|---|
| Which tools ran, their input and output | Tokens per step: text length ÷ 4 |
| Duration of each step | Screenshots and images: ~1k tokens each |
| Files edited, errors, prompts, replies, thinking | "≈ N pages" in Muggle mode (≈ 650 tokens per page) |
| Context size at compaction (`context_tokens`) | Events recorded before image handling was fixed: adjusted, flagged in the inspector |

**The token numbers are not your bill.** They measure how much text entered the agent's context. Billed usage is usually several times higher, because the model re-reads its whole context on every step (cache reads). Cursor's hooks don't expose per-step token counts or cost. The exact per-request numbers live in Cursor's dashboard (Usage → Export CSV) and, for Team accounts, in the Admin API (`/teams/filtered-usage-events`).

## Manual events

```powershell
npm install

# 1) open the UI
npm start

# 2) in another terminal, create a real run
npm run at -- start --title "manual test"
npm run at -- event note --title hello --text "first real event"
npm run at -- event file.write --title auth.ts --path src/auth.ts
npm run at -- event error --title boom --error "something failed"
npm run at -- end
npm run at -- summary
```

Refresh the browser. That’s it.

- `npm start` → UI on `http://127.0.0.1:7379`
- `npm run at -- <command>` → CLI (auto-builds once if needed)
- Prefer `--text` / `--path` / `--name` instead of raw JSON on PowerShell

Events live in:

```text
~/.agenttrace/runs/<runId>.jsonl
~/.agenttrace/index.json
```

Override the store with `AGENTTRACE_HOME` or `--home`.

## Event model

```ts
type AgentTraceEvent = {
  id: string
  runId: string
  ts: string // ISO
  type: string
  source?: string // cursor | claude | codex | manual | mcp
  title?: string
  data?: Record<string, unknown>
  durationMs?: number
  error?: { message: string; stack?: string }
}
```

Minimum useful types:

- `run.started` / `run.ended`
- `tool.started` / `tool.ended`
- `file.read` / `file.write` / `file.delete`
- `model.request` / `model.response`
- `error`
- `note`

## Insights (heuristics, not ML)

- Likely loops (same tool + similar args ≥ 3)
- File thrash (same file rewritten many times)
- Expensive model calls (high tokens / latency)
- Error bursts
- Short Run Health checklist

## MCP setup (Cursor)

Add to your MCP config:

```json
{
  "mcpServers": {
    "agenttrace": {
      "command": "node",
      "args": ["D:/projects/agenttrace/dist/mcp/index.js"]
    }
  }
}
```

Or via CLI entry after install:

```json
{
  "mcpServers": {
    "agenttrace": {
      "command": "agenttrace",
      "args": ["mcp"]
    }
  }
}
```

Tools exposed:

- `start_run`
- `log_event`
- `end_run`
- `get_run_summary`

## CLI reference

| Command | Purpose |
|---------|---------|
| `agenttrace init` | Create local store |
| `agenttrace start [--title]` | Start a run |
| `agenttrace event <type> [--text\|--path\|--name\|--data]` | Append event |
| `agenttrace end` | End run |
| `agenttrace status` | Current store/run |
| `agenttrace ls` | List runs |
| `agenttrace summary [runId]` | Terminal health summary |
| `agenttrace export [runId] --format md\|json` | Shareable export |
| `agenttrace open [runId]` | Local timeline UI |
| `agenttrace mcp` | Stdio MCP server |

## Architecture

```text
agenttrace/
  src/core/   # JSONL store, schema, insights
  src/cli/    # citty CLI + local static UI server
  src/mcp/    # MCP tools
  src/ui/     # Vite + React timeline
```

Local-first. No cloud. No auth. No agent framework.

## Roadmap

- [ ] Secret redaction in logged payloads
- [ ] Diff view for `file.write` when before/after exists
- [ ] Compare two runs
- [ ] IDE/browser stubs
- [ ] GitHub Action summary attachment

## Contributing

PRs welcome. Keep v1 boring:

1. `npm install`
2. `npm test`
3. `npm run build`

Ship the smallest impressive change.

## License

MIT
