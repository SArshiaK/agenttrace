<div align="center">

# agenttrace

**See what your AI coding agent actually did — every step, every file, where the effort went.**

Live local timeline for [Cursor](https://cursor.com). No cloud, no account.

![License: MIT](https://img.shields.io/badge/license-MIT-22c55e)
![Node ≥ 18](https://img.shields.io/badge/node-%E2%89%A518-3b82f6)
![Local only](https://img.shields.io/badge/data-local%20only-8b5cf6)
![npm](https://img.shields.io/npm/v/@arshia9314/agenttrace)

</div>

---

In the chat you usually see only the final reply. agenttrace records the middle: prompts, thinking, tools, shell, file edits, MCP calls, errors — one timeline per chat.

Data stays on your machine as JSONL under `~/.agenttrace`.

## Quick start

Needs [Node.js](https://nodejs.org) 18+ and Cursor.

```bash
npm install -g @arshia9314/agenttrace --registry=https://registry.npmjs.org/
```

```bash
agenttrace setup-cursor --global
```

```bash
agenttrace open
```

Then send a message in Cursor and watch the timeline at [http://127.0.0.1:7379](http://127.0.0.1:7379).

Recording continues even if the UI is closed.

## How it works

Cursor fires hooks on prompt / tools / edits / replies / turn end. agenttrace redacts obvious secrets and appends one JSONL line per event under `~/.agenttrace/runs/cursor_<id>.jsonl`.

The UI only reads those files (polls every ~2s). A failing hook never blocks the agent; errors go to `~/.agenttrace/hook-errors.log`.

## Exact vs estimated

Numbers in the UI are tagged <kbd>exact</kbd> or <kbd>est.</kbd>

| Exact (from the harness) | Estimated by agenttrace |
|---|---|
| Tools, inputs/outputs, durations | Tokens ≈ text length ÷ 4 |
| Files, errors, prompts, replies, thinking | Images ≈ 1k tokens each |
| Compaction context size when the harness reports it | |

Token figures are **not your bill** — they approximate how much text entered context. Billed usage is usually higher.

## Privacy

- No telemetry or uploads. UI binds to `127.0.0.1` only.
- API-key-shaped secrets are redacted before write.
- Prompts and replies are still stored as plain text locally — treat `~/.agenttrace` like chat history.

## Troubleshooting

| Problem | Fix |
|---|---|
| Nothing appears | Confirm hooks are installed (`~/.cursor/hooks.json`), restart Cursor, check `~/.agenttrace/hook-errors.log`, ensure `node` works in a terminal |
| Port 7379 busy | `agenttrace open --port 7400` |
| Stop tracing | Remove `--agenttrace-hook` entries from `~/.cursor/hooks.json` |

## License

[MIT](LICENSE) · © 2026 [SArshiaK](https://github.com/SArshiaK)
