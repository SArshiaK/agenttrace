import type { RunMeta } from "../types";

/** Harnesses the UI can show side-by-side. More can be added later. */
export const SOURCES = ["cursor", "grok"] as const;
export type SourceId = (typeof SOURCES)[number];

export const SOURCE_META: Record<
  SourceId,
  { label: string; short: string; blurb: string; ready: boolean }
> = {
  cursor: {
    label: "Cursor",
    short: "Cursor",
    blurb: "Every Agent chat, live — prompts, tools, files, and effort.",
    ready: true,
  },
  grok: {
    label: "Grok Build",
    short: "Grok",
    blurb: "Identical panel for Grok. Hooks wire up next; structure is ready.",
    ready: false,
  },
};

export function isSourceId(value: string | null | undefined): value is SourceId {
  return value === "cursor" || value === "grok";
}

/** Map a stored run onto a harness bucket. Unknown / CLI runs stay out of both for now. */
export function sourceOf(run: Pick<RunMeta, "id" | "source">): SourceId | null {
  const raw = (run.source ?? "").toLowerCase();
  if (raw === "cursor" || run.id.startsWith("cursor_")) return "cursor";
  if (raw === "grok" || run.id.startsWith("grok_")) return "grok";
  return null;
}

export function runsForSource(runs: RunMeta[], source: SourceId): RunMeta[] {
  return runs.filter((r) => sourceOf(r) === source);
}

export function countBySource(runs: RunMeta[]): Record<SourceId, number> {
  return {
    cursor: runsForSource(runs, "cursor").length,
    grok: runsForSource(runs, "grok").length,
  };
}
