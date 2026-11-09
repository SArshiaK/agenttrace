import { randomBytes } from "node:crypto";

export function createId(prefix = ""): string {
  const id = randomBytes(8).toString("hex");
  return prefix ? `${prefix}_${id}` : id;
}

export function createRunId(): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  return `run_${stamp}_${randomBytes(3).toString("hex")}`;
}
