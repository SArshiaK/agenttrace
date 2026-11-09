import type { RunMeta } from "../types";

export const NO_PROJECT = "__none__";

export type ProjectGroup = {
  key: string;
  name: string;
  path?: string;
  runs: RunMeta[];
};

function tail(path: string, parts: number): string {
  return path.split("/").filter(Boolean).slice(-parts).join("/");
}

/** Runs grouped by project folder, most recently active project first. */
export function groupByProject(runs: RunMeta[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const run of runs) {
    const key = run.project ?? NO_PROJECT;
    let group = groups.get(key);
    if (!group) {
      group = { key, name: run.project ? tail(run.project, 1) : "No project", path: run.project, runs: [] };
      groups.set(key, group);
    }
    group.runs.push(run);
  }

  const list = [...groups.values()];
  // Two folders with the same name (e.g. two "app" folders) get their parent shown too.
  const seen = new Map<string, number>();
  for (const g of list) seen.set(g.name, (seen.get(g.name) ?? 0) + 1);
  for (const g of list) if (g.path && (seen.get(g.name) ?? 0) > 1) g.name = tail(g.path, 2);

  const latest = (g: ProjectGroup) => Math.max(...g.runs.map((r) => Date.parse(r.updatedAt)));
  return list.sort((a, b) => {
    if (a.key === NO_PROJECT) return 1;
    if (b.key === NO_PROJECT) return -1;
    return latest(b) - latest(a);
  });
}
