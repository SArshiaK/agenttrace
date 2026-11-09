/** Normalize Grok / Claude-shaped hook payloads into the Cursor shape our mapper expects. */

const EVENT_ALIASES: Record<string, string> = {
  sessionstart: "sessionStart",
  session_start: "sessionStart",
  sessionend: "sessionEnd",
  session_end: "sessionEnd",
  userpromptsubmit: "beforeSubmitPrompt",
  user_prompt_submit: "beforeSubmitPrompt",
  beforesubmitprompt: "beforeSubmitPrompt",
  posttooluse: "postToolUse",
  post_tool_use: "postToolUse",
  posttoolusefailure: "postToolUseFailure",
  post_tool_use_failure: "postToolUseFailure",
  afterfileedit: "afterFileEdit",
  after_file_edit: "afterFileEdit",
  afteragentresponse: "afterAgentResponse",
  after_agent_response: "afterAgentResponse",
  afteragentthought: "afterAgentThought",
  after_agent_thought: "afterAgentThought",
  precompact: "preCompact",
  pre_compact: "preCompact",
  stop: "stop",
  stopfailure: "stop",
  stop_failure: "stop",
};

const TOOL_ALIASES: Record<string, string> = {
  run_terminal_command: "Shell",
  run_terminal_cmd: "Shell",
  bash: "Shell",
  read_file: "Read",
  search_replace: "StrReplace",
  write_file: "Write",
  edit_file: "Edit",
  delete_file: "Delete",
  list_dir: "Glob",
  glob: "Glob",
  grep: "Grep",
  web_search: "WebSearch",
  web_fetch: "WebFetch",
  spawn_subagent: "Task",
  todo_write: "TodoWrite",
};

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const s = str(value);
    if (s) return s;
  }
  return undefined;
}

function normalizeEventName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return EVENT_ALIASES[raw.toLowerCase()] ?? raw;
}

function normalizeToolName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  return TOOL_ALIASES[name] ?? TOOL_ALIASES[name.toLowerCase()] ?? name;
}

function normalizeToolInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const raw = input as Record<string, unknown>;
  const out: Record<string, unknown> = { ...raw };

  const path = firstString(raw.path, raw.file_path, raw.filePath, raw.target_file, raw.targetFile);
  if (path) {
    out.path ??= path;
    out.file_path ??= path;
  }

  const oldString = firstString(raw.old_string, raw.oldString);
  const newString = firstString(raw.new_string, raw.newString);
  if (oldString !== undefined) out.old_string ??= oldString;
  if (newString !== undefined) out.new_string ??= newString;

  const command = firstString(raw.command);
  if (command) out.command ??= command;

  return out;
}

/**
 * Detect which harness invoked the hook.
 * Explicit --source wins; then Grok/Claude env vars; otherwise Cursor.
 */
export function detectHookSource(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): "cursor" | "grok" | "claude" {
  if (argv.includes("--source=grok") || argv.includes("--agenttrace-hook-grok")) return "grok";
  if (argv.includes("--source=claude") || argv.includes("--agenttrace-hook-claude")) return "claude";
  if (env.GROK_SESSION_ID || env.GROK_HOOK_EVENT || env.GROK_WORKSPACE_ROOT) return "grok";
  // Claude Code exports CLAUDE_PROJECT_DIR for every hook process.
  if (env.CLAUDE_PROJECT_DIR || env.CLAUDE_CODE_ENTRYPOINT) return "claude";
  return "cursor";
}

/** Rewrite a raw hook stdin object into Cursor-compatible field names. */
export function normalizeHookInput(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input };

  const eventName = normalizeEventName(
    firstString(input.hook_event_name, input.hookEventName, input.hook_event),
  );
  if (eventName) out.hook_event_name = eventName;

  const conversationId = firstString(
    input.conversation_id,
    input.session_id,
    input.sessionId,
    process.env.GROK_SESSION_ID,
  );
  if (conversationId) {
    out.conversation_id ??= conversationId;
    out.session_id ??= conversationId;
  }

  const workspace =
    firstString(
      input.workspaceRoot,
      input.workspace_root,
      process.env.GROK_WORKSPACE_ROOT,
      process.env.CLAUDE_PROJECT_DIR,
      input.cwd,
    ) ?? (Array.isArray(input.workspace_roots) ? str(input.workspace_roots[0]) : undefined);
  if (workspace) {
    out.workspace_roots = Array.isArray(input.workspace_roots)
      ? input.workspace_roots
      : [workspace];
  }

  const toolName = normalizeToolName(firstString(input.tool_name, input.toolName));
  if (toolName) out.tool_name = toolName;

  const toolInput = input.tool_input ?? input.toolInput;
  if (toolInput !== undefined) out.tool_input = normalizeToolInput(toolInput);

  // Claude uses tool_response; Grok uses toolResult; Cursor uses tool_output.
  const toolOutput =
    input.tool_output ?? input.tool_response ?? input.toolResponse ?? input.toolResult ?? input.tool_result;
  if (toolOutput !== undefined) out.tool_output = toolOutput;

  const duration = num(input.duration) ?? num(input.durationMs) ?? num(input.duration_ms);
  if (duration !== undefined) {
    out.duration = duration;
    out.duration_ms = duration;
  }

  const prompt = firstString(input.prompt, input.user_prompt, input.userPrompt);
  if (prompt !== undefined) out.prompt = prompt;

  const text = firstString(input.text, input.lastAssistantMessage, input.last_assistant_message);
  if (text !== undefined) {
    out.text = text;
    out.lastAssistantMessage ??= text;
  }

  const errorMessage = firstString(
    input.error_message,
    input.errorMessage,
    input.errorDetails,
    input.error_details,
    // Claude PostToolUseFailure puts the failure text in `error`.
    typeof input.error === "string" ? input.error : undefined,
  );
  if (errorMessage) out.error_message = errorMessage;

  const filePath = firstString(input.file_path, input.filePath);
  if (filePath) out.file_path = filePath;

  const model = firstString(input.model);
  if (model) out.model = model;

  // Grok StopFailure arrives as stop after aliasing; mark it as an error turn.
  const rawEvent = firstString(input.hook_event_name, input.hookEventName)?.toLowerCase();
  if (rawEvent === "stopfailure" || rawEvent === "stop_failure") {
    out.status ??= "error";
  }

  return out;
}
