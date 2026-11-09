import { describe, expect, it } from "vitest";
import { repairMojibake } from "../src/core/encoding";

function cp1252Mojibake(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return new TextDecoder("windows-1252").decode(bytes);
}

describe("repairMojibake", () => {
  it("restores Persian text decoded as Windows-1252", () => {
    const original = "پنلش رو با اسکیل ui ux promax بازطراحی کن";
    expect(repairMojibake(cp1252Mojibake(original))).toBe(original);
  });

  it("keeps genuine characters next to damaged text", () => {
    const damaged = `${cp1252Mojibake("سلام")}…`;
    expect(repairMojibake(damaged)).toBe("سلام…");
  });

  it("leaves correct text untouched", () => {
    for (const text of ["سلام دنیا", "café résumé", "plain ascii", "naïve — “quotes”"]) {
      expect(repairMojibake(text)).toBe(text);
    }
  });
});
