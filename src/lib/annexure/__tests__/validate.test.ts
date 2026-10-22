import { describe, expect, it } from "vitest";

import { DEFAULT_ANNEXURE_OPTIONS, type AnnexureRow } from "../types";
import { autoFixRows, computeTotals, validateRow, validateRows } from "../validate";

const OPTIONS = { ...DEFAULT_ANNEXURE_OPTIONS, periodMonth: "2026-10" };

function row(overrides: Partial<AnnexureRow> = {}): AnnexureRow {
  return {
    id: "row-1",
    rowNumber: 1,
    invoiceNo: "SDC0010000123/0001",
    invoiceDate: "2026-10-05",
    counterpartyTin: "102345678",
    counterpartyName: "Eric Mugisha",
    taxableAmountRwf: 250_000,
    vatAmountRwf: 45_000,
    mrcCode: "SDC0010000123",
    currency: "RWF",
    whtRate: null,
    purchaseType: "",
    ...overrides,
  };
}

describe("validateRow — sales", () => {
  it("accepts a clean row", () => {
    const result = validateRow(row(), "SALES", OPTIONS);
    expect(result.status).toBe("VALID");
    expect(result.issues).toHaveLength(0);
  });

  it("blocks TINs that are not exactly 9 digits", () => {
    const shortTin = validateRow(row({ counterpartyTin: "10456789" }), "SALES", OPTIONS);
    expect(shortTin.status).toBe("ERROR");
    expect(shortTin.issues.map((issue) => issue.code)).toContain("TIN_INVALID");

    const missingTin = validateRow(row({ counterpartyTin: "" }), "SALES", OPTIONS);
    expect(missingTin.issues.map((issue) => issue.code)).toContain("TIN_MISSING");
  });

  it("flags invalid dates and dates outside the declared period", () => {
    expect(validateRow(row({ invoiceDate: null }), "SALES", OPTIONS).status).toBe("ERROR");
    const outside = validateRow(row({ invoiceDate: "2026-09-30" }), "SALES", OPTIONS);
    expect(outside.status).toBe("WARNING");
    expect(outside.issues[0]?.code).toBe("DATE_OUTSIDE_PERIOD");
  });

  it("warns inside ±1 RWF and blocks larger 18% VAT gaps", () => {
    const rounding = validateRow(row({ vatAmountRwf: 45_001 }), "SALES", OPTIONS);
    expect(rounding.status).toBe("WARNING");
    expect(rounding.issues.map((issue) => issue.code)).toContain("VAT_ROUNDING");

    const mismatch = validateRow(row({ vatAmountRwf: 45_010 }), "SALES", OPTIONS);
    expect(mismatch.status).toBe("ERROR");
    expect(mismatch.issues.map((issue) => issue.code)).toContain("VAT_MISMATCH");
  });

  it("skips VAT math for non-VAT-registered clients", () => {
    const result = validateRow(row({ vatAmountRwf: 0 }), "SALES", {
      ...OPTIONS,
      vatRegistered: false,
    });
    expect(result.status).toBe("VALID");
  });

  it("validates MRC presence and format", () => {
    const missing = validateRow(row({ mrcCode: "" }), "SALES", OPTIONS);
    expect(missing.issues.map((issue) => issue.code)).toContain("MRC_MISSING");

    const invalid = validateRow(row({ mrcCode: "0010000123" }), "SALES", OPTIONS);
    expect(invalid.issues.map((issue) => issue.code)).toContain("MRC_INVALID");
  });

  it("rejects non-RWF currencies when required", () => {
    const result = validateRow(row({ currency: "USD" }), "SALES", OPTIONS);
    expect(result.issues.map((issue) => issue.code)).toContain("CURRENCY_NOT_RWF");
  });

  it("warns on duplicate invoice numbers", () => {
    const rows = validateRows([row(), row({ id: "row-2", rowNumber: 2 })], "SALES", OPTIONS);
    expect(rows.every((entry) => entry.status === "WARNING")).toBe(true);
    expect(rows[0]?.issues.map((issue) => issue.code)).toContain("INVOICE_NO_DUPLICATE");
  });
});

describe("validateRow — WHT", () => {
  it("accepts 15% and 3% rates with integer rounding", () => {
    const fifteen = validateRow(
      row({ whtRate: 15, taxableAmountRwf: 400_000, vatAmountRwf: 60_000, mrcCode: "" }),
      "WHT",
      OPTIONS,
    );
    expect(fifteen.status).toBe("VALID");

    const three = validateRow(
      row({ whtRate: 3, taxableAmountRwf: 2_500_000, vatAmountRwf: 75_000, mrcCode: "" }),
      "WHT",
      OPTIONS,
    );
    expect(three.status).toBe("VALID");
  });

  it("blocks unsupported rates and wrong withheld amounts", () => {
    const badRate = validateRow(row({ whtRate: 10, vatAmountRwf: 25_000, mrcCode: "" }), "WHT", OPTIONS);
    expect(badRate.status).toBe("ERROR");

    const badAmount = validateRow(row({ whtRate: 15, vatAmountRwf: 30_000, mrcCode: "" }), "WHT", OPTIONS);
    expect(badAmount.issues.map((issue) => issue.code)).toContain("WHT_MISMATCH");
  });
});

describe("autoFixRows", () => {
  it("aligns rounding gaps in 'rounding' mode but leaves big mismatches", () => {
    const rows = [row({ vatAmountRwf: 45_001 }), row({ id: "row-2", rowNumber: 2, vatAmountRwf: 60_000 })];
    const fixed = autoFixRows(rows, "SALES", OPTIONS, "rounding");
    expect(fixed.fixedCount).toBe(1);
    expect(fixed.rows[0]?.vatAmountRwf).toBe(45_000);
    expect(fixed.rows[1]?.vatAmountRwf).toBe(60_000);
  });

  it("recomputes every VAT amount in 'recalculate' mode", () => {
    const fixed = autoFixRows([row({ taxableAmountRwf: 99_999, vatAmountRwf: 0 })], "SALES", OPTIONS, "recalculate");
    expect(fixed.fixedCount).toBe(1);
    expect(fixed.rows[0]?.vatAmountRwf).toBe(18_000); // round(99999 * 0.18) = 18000
  });

  it("computes WHT from the base when recalculating", () => {
    const fixed = autoFixRows(
      [row({ taxableAmountRwf: 900_000, whtRate: 15, vatAmountRwf: 0, mrcCode: "" })],
      "WHT",
      OPTIONS,
      "recalculate",
    );
    expect(fixed.rows[0]?.vatAmountRwf).toBe(135_000);
  });
});

describe("computeTotals", () => {
  it("aggregates taxable, declared VAT and the 18% expectation", () => {
    const validated = validateRows(
      [
        row(),
        row({
          id: "row-2",
          rowNumber: 2,
          invoiceNo: "SDC0010000123/0002",
          taxableAmountRwf: 100_000,
          vatAmountRwf: 18_000,
        }),
      ],
      "SALES",
      OPTIONS,
    );
    const totals = computeTotals(validated, "SALES", OPTIONS);
    expect(totals.rowCount).toBe(2);
    expect(totals.validCount).toBe(2);
    expect(totals.totalTaxableRwf).toBe(350_000);
    expect(totals.totalVatRwf).toBe(63_000);
    expect(totals.expectedVatRwf).toBe(63_000);
    expect(totals.varianceRwf).toBe(0);
  });
});
