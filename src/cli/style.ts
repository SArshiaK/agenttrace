export const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

export function ok(msg: string): string {
  return `${c.green}✓${c.reset} ${msg}`;
}

export function warn(msg: string): string {
  return `${c.yellow}!${c.reset} ${msg}`;
}

export function err(msg: string): string {
  return `${c.red}✗${c.reset} ${msg}`;
}

export function heading(msg: string): string {
  return `${c.bold}${msg}${c.reset}`;
}

export function dim(msg: string): string {
  return `${c.dim}${msg}${c.reset}`;
}
