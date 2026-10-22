import { describe, expect, it } from "vitest";

import {
  excelSerialToIso,
  isValidMrc,
  isValidTin,
  normalizeCurrency,
  normalizeMrc,
  normalizeTin,
  parseDateInput,
  parseNumber,
  sanitizeText,
  toRwfInteger,
} from "../normalize";

describe("sanitizeText", () => {
  it("strips accents, tabs, newlines, quotes, commas and slashes", () => {
    expect(sanitizeText("Éric   Mugisha\tLtd,\n\"Kigali\"/Rwanda")).toBe("Eric Mugisha Ltd Kigali Rwanda");
  });

  it("keeps ampersands, hyphens and digits", () => {
    expect(sanitizeText("Nyamirambo Fresh Foods & Co-1")).toBe("Nyamirambo Fresh Foods & Co-1");
  });

  it("returns an empty string for nullish input", () => {
    expect(sanitizeText(null)).toBe("");
    expect(sanitizeText(undefined)).toBe("");
  });
});

describe("TIN normalisation", () => {
  it("strips spaces and hyphens and accepts exactly nine digits", () => {
    expect(normalizeTin("102 345-678")).toBe("102345678");
    expect(isValidTin("102345678")).toBe(true);
  });

  it("rejects 8 or 10 digits and alphanumerics", () => {
    expect(isValidTin("10234567")).toBe(false);
    expect(isValidTin("1023456789")).toBe(false);
    expect(isValidTin("10234567A")).toBe(false);
  });

  it("preserves letters so malformed TINs fail instead of silently changing", () => {
    expect(normalizeTin("RW102345678")).toBe("RW102345678");
  });
});

describe("MRC codes", () => {
  it("normalises and accepts EBM machine codes with receipt suffix", () => {
    expect(normalizeMrc(" sdc0010000123/0001 ")).toBe("SDC0010000123/0001");
    expect(isValidMrc("SDC0010000123")).toBe(true);
    expect(isValidMrc("SDC0010000123/0001")).toBe(true);
  });

  it("rejects malformed MRCs", () => {
    expect(isValidMrc("0010000123")).toBe(false);
    expect(isValidMrc("SDC12")).toBe(false);
  });
});

describe("parseNumber / toRwfInteger", () => {
  it("handles thousands separators, currency codes and parentheses", () => {
    expect(parseNumber("1,250,000")).toBe(1_250_000);
    expect(parseNumber("RWF 250 000")).toBe(250_000);
    expect(parseNumber("(45,000)")).toBe(-45_000);
    expect(parseNumber("1.234.567")).toBe(1_234_567);
    expect(parseNumber("250000.60")).toBeCloseTo(250_000.6);
  });

  it("rounds to whole RWF", () => {
    expect(toRwfInteger("44,999.5")).toBe(45_000);
    expect(toRwfInteger("")).toBeNull();
  });
});

describe("date parsing", () => {
  it("parses ISO, slash and dotted dates", () => {
    expect(parseDateInput("2026-10-05")).toBe("2026-10-05");
    expect(parseDateInput("2026-10-05T08:30:00Z")).toBe("2026-10-05");
    expect(parseDateInput("05/10/2026")).toBe("2026-10-05");
    expect(parseDateInput("05-10-2026")).toBe("2026-10-05");
    expect(parseDateInput("2026/10/05")).toBe("2026-10-05");
    expect(parseDateInput("20261005")).toBe("2026-10-05");
  });

  it("honours day-first Rwandan convention and resolves unambiguous dates", () => {
    expect(parseDateInput("03/04/2026", "DMY")).toBe("2026-04-03");
    expect(parseDateInput("03/04/2026", "MDY")).toBe("2026-03-04");
    expect(parseDateInput("13/04/2026", "MDY")).toBe("2026-04-13");
  });

  it("parses Excel serials (including text serials)", () => {
    expect(excelSerialToIso(46_301)).toBe("2026-10-06");
    expect(parseDateInput(46297)).toBe("2026-10-02");
    expect(parseDateInput("46297")).toBe("2026-10-02");
  });

  it("parses month names in English and French", () => {
    expect(parseDateInput("15 Oct 2026")).toBe("2026-10-15");
    expect(parseDateInput("Oct 15, 2026")).toBe("2026-10-15");
    expect(parseDateInput("15 octobre 2026")).toBe("2026-10-15");
  });

  it("rejects impossible calendar dates", () => {
    expect(parseDateInput("31/02/2026")).toBeNull();
    expect(parseDateInput("not a date")).toBeNull();
    expect(parseDateInput("")).toBeNull();
  });
});

describe("normalizeCurrency", () => {
  it("maps Rwandan variants to RWF", () => {
    expect(normalizeCurrency("rwf")).toBe("RWF");
    expect(normalizeCurrency("FRW")).toBe("RWF");
    expect(normalizeCurrency("USD")).toBe("USD");
    expect(normalizeCurrency("")).toBe("RWF");
  });
});
