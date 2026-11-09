import {
  Bot,
  Brain,
  Camera,
  Globe,
  CircleDot,
  FileText,
  Layers,
  MessageSquare,
  Pencil,
  Plug,
  Search,
  StickyNote,
  Terminal,
  Trash,
  TriangleExclamationPoint,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { AgentTraceEvent } from "../types";
import { kindOf, str } from "../lib/events";

const TOOL_ICONS: Record<string, LucideIcon> = {
  Shell: Terminal,
  Read: FileText,
  Grep: Search,
  Glob: Search,
  SemanticSearch: Search,
  Write: Pencil,
  StrReplace: Pencil,
  EditNotebook: Pencil,
  Delete: Trash,
  Task: Workflow,
};

export function iconFor(event: AgentTraceEvent): LucideIcon {
  const kind = kindOf(event);
  if (kind === "error") return TriangleExclamationPoint;
  if (kind === "prompt") return MessageSquare;
  if (kind === "response") return Bot;
  if (kind === "thought") return Brain;
  if (kind === "compact") return Layers;
  if (kind === "note") return StickyNote;
  if (kind === "file") {
    if (event.type === "file.write") return Pencil;
    if (event.type === "file.delete") return Trash;
    return FileText;
  }
  if (kind === "tool") {
    const name = str(event.data?.name) ?? "";
    if (name.includes("screenshot")) return Camera;
    if (name.startsWith("MCP:browser_")) return Globe;
    if (name.startsWith("MCP")) return Plug;
    return TOOL_ICONS[name] ?? Wrench;
  }
  return CircleDot;
}

export function EventIcon({ event, size = 14 }: { event: AgentTraceEvent; size?: number }) {
  const Icon = iconFor(event);
  return (
    <span className={`event-icon k-${kindOf(event)}`} aria-hidden="true">
      <Icon size={size} strokeWidth={2} />
    </span>
  );
}
