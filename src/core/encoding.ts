// Windows-1252 code points for bytes 0x80–0x9F; the five undefined bytes pass through as C1 controls.
const CP1252_TO_BYTE: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86,
  0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

// A UTF-8 lead byte (Â–ô) followed by a continuation byte, as they look after a cp1252 decode.
const MOJIBAKE_HINT =
  /[\u00C2-\u00F4][\u0080-\u00BF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2013\u2014\u2018-\u201E\u2020-\u2022\u2026\u2030\u2039\u203A\u20AC\u2122]/;

const utf8 = new TextDecoder("utf-8", { fatal: true });

function toByte(char: string | undefined): number | undefined {
  if (char === undefined) return undefined;
  const code = char.charCodeAt(0);
  return code >= 0x80 && code < 0x100 ? code : CP1252_TO_BYTE[code];
}

function sequenceLength(lead: number): number {
  if (lead >= 0xc2 && lead <= 0xdf) return 2;
  if (lead >= 0xe0 && lead <= 0xef) return 3;
  if (lead >= 0xf0 && lead <= 0xf4) return 4;
  return 0;
}

/**
 * Undo UTF-8 text that was decoded as Windows-1252 (Cursor pipes hook input through
 * PowerShell on Windows). Only complete, valid UTF-8 sequences are rewritten, so
 * genuine non-ASCII characters next to the damaged text are left alone.
 */
export function repairMojibake(text: string): string {
  if (!MOJIBAKE_HINT.test(text)) return text;
  let out = "";
  let i = 0;
  while (i < text.length) {
    const lead = toByte(text[i]);
    const len = lead === undefined ? 0 : sequenceLength(lead);
    if (len) {
      const bytes = [lead!];
      for (let j = 1; j < len; j++) {
        const b = toByte(text[i + j]);
        if (b === undefined || b < 0x80 || b > 0xbf) break;
        bytes.push(b);
      }
      if (bytes.length === len) {
        try {
          out += utf8.decode(Uint8Array.from(bytes));
          i += len;
          continue;
        } catch {
          // overlong or surrogate encoding; keep the original characters
        }
      }
    }
    out += text[i];
    i += 1;
  }
  return out;
}
