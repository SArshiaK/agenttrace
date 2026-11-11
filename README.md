<div align="center">

# agenttrace

**See what your AI coding agent actually did — every step, every file, where the effort went.**

Live local timeline for [Cursor](https://cursor.com), [Grok Build](https://docs.x.ai/build), and [Claude Code](https://code.claude.com). No cloud, no account.

![License: MIT](https://img.shields.io/badge/license-MIT-22c55e)
![Node ≥ 18](https://img.shields.io/badge/node-%E2%89%A518-3b82f6)
![Local only](https://img.shields.io/badge/data-local%20only-8b5cf6)

</div>

---

In the chat you usually see only the final reply. agenttrace records the middle: prompts, thinking, tools, shell, file edits, MCP calls, errors — grouped by harness and project, one timeline per chat.

Data stays on your machine as JSONL under `~/.agenttrace`.

## Quick start

Needs [Node.js](https://nodejs.org) 18+ and at least one of the harnesses above.

```bash
git clone https://github.com/SArshiaK/agenttrace.git
cd agenttrace
npm install

npm run at -- setup-cursor --global    # ~/.cursor/hooks.json
npm run at -- setup-grok --global      # ~/.grok/hooks/agenttrace.json
npm run at -- setup-claude --global    # ~/.claude/settings.json

npm start
```

Open [http://127.0.0.1:7379](http://127.0.0.1:7379), pick a harness, send a message in that tool, and watch the timeline.

Install any combination. Recording continues even if the UI is closed.

> Hooks point at this clone (`dist/hook/index.js`). If you move the folder, rerun setup from the new path.

<details>
<summary>Trace one project only</summary>

```bash
npm run at -- setup-cursor --dir /path/to/project
npm run at -- setup-grok --dir /path/to/project
npm run at -- setup-claude --dir /path/to/project
```

Grok project hooks need trust once (`/hooks-trust` or `--trust`). Don’t install both global and project hooks for the same harness or events may duplicate.

</details>

## How it works

Each harness fires hooks on prompt / tools / edits / replies / turn end. agenttrace redacts obvious secrets and appends one JSONL line per event.

| | |
|---|---|
| Cursor | `~/.agenttrace/runs/cursor_<id>.jsonl` |
| Grok Build | `~/.agenttrace/runs/grok_<id>.jsonl` |
| Claude Code | `~/.agenttrace/runs/claude_<id>.jsonl` |

The UI only reads those files (polls every ~2s). A failing hook never blocks the agent; errors go to `~/.agenttrace/hook-errors.log`.

## Exact vs estimated

Numbers in the UI are tagged <kbd>exact</kbd> or <kbd>est.</kbd>

| Exact (from the harness) | Estimated by agenttrace |
|---|---|
| Tools, inputs/outputs, durations | Tokens ≈ text length ÷ 4 |
| Files, errors, prompts, replies, thinking | Images ≈ 1k tokens each |
| Compaction context size when the harness reports it | |

Token figures are **not your bill** — they approximate how much text entered context. Billed usage is usually higher.

## Commands

```bash
npm run at -- ls
npm run at -- summary <runId>
npm run at -- export <runId> -f md    # also: json, events
npm run at -- open --port 7400
```

| Command | |
|---|---|
| `setup-cursor` / `setup-grok` / `setup-claude` | Install hooks (`--global` or `--dir`) |
| `open` | Timeline UI (`npm start` shortcut) |
| `ls` / `summary` / `export` / `status` | Inspect stored runs |
| `mcp` | Optional MCP server so an agent can log its own runs |

Store path: `~/.agenttrace` (override with `--home` or `AGENTTRACE_HOME`).

## Privacy

- No telemetry or uploads. UI binds to `127.0.0.1` only.
- API-key-shaped secrets are redacted before write.
- Prompts and replies are still stored as plain text locally — treat `~/.agenttrace` like chat history.

## Troubleshooting

| Problem | Fix |
|---|---|
| Nothing appears | Confirm hooks are installed for that harness, restart the harness, check `~/.agenttrace/hook-errors.log`, ensure `node` works in a terminal |
| Port 7379 busy | `npm run at -- open --port 7400` |
| Pull didn’t update UI | `npm run build` then restart `npm start` |
| Stop tracing | Remove `--agenttrace-hook` entries from the harness hook config (`~/.cursor/hooks.json`, `~/.grok/hooks/…`, or `~/.claude/settings.json`) |

## License

[MIT](LICENSE) · © 2026 [SArshiaK](https://github.com/SArshiaK)
