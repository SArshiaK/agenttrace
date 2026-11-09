const PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{16,}/g, "sk-[REDACTED]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "gh_[REDACTED]"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, "xox-[REDACTED]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "AKIA[REDACTED]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [REDACTED]"],
  [
    /\b(api[_-]?key|access[_-]?token|secret|password|passwd)(["']?\s*[:=]\s*["']?)[^\s"',}]{6,}/gi,
    "$1$2[REDACTED]",
  ],
];

export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

/** Roughly 4 characters per token for English/code; good enough to rank heavy steps. */
export function estimateTokens(text: string | undefined | null): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/** Images are billed by size, not by their base64 length; ~1k tokens is a typical screenshot. */
export const IMAGE_TOKENS = 1000;

const BASE64_BLOB = /(?:data:[\w/+.-]+;base64,)?[A-Za-z0-9+/]{1000,}={0,2}/g;

/** Replaces base64 blobs (screenshots, binaries) so they aren't estimated as text. */
export function measureOutput(output: string): { text: string; estTokens: number; blobs: number } {
  let blobs = 0;
  const text = output.replace(BASE64_BLOB, (match) => {
    blobs += 1;
    return `[binary ${Math.round((match.length * 3) / 4 / 1024)} KB]`;
  });
  return { text, estTokens: estimateTokens(text) + blobs * IMAGE_TOKENS, blobs };
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}… [+${text.length - max} chars]` : text;
}
