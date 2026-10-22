import { describe, expect, it } from "vitest";

import { ANNEXURE_FORMATS, formatOutputValue } from "../annexure-config";
import { buildEtaFileName, buildEtaText, etaLineCount } from "../export-eta";
import { DEFAULT_ANNEXURE_OPTIONS, AnnexureExportError, type AnnexureRow } from "../types";
import { validateRows } from "../validate";

const OPTIONS = { ...DEFAULT_ANNEXURE_OPTIONS, periodMonth: "2026-10" };

function validated(overrides: Partial<AnnexureRow>[] = []) {
  const base: AnnexureRow = {
    id: "row-1",
    rowNumber: 1,
    invoiceNo: "SDC0010000123/0001",
    invoiceDate: "2026-10-05",
    counterpartyTin: "102345678",
    counterpartyName: "Nyamirambo Fresh Foods Ltd",
    taxableAmountRwf: 250_000,
    vatAmountRwf: 45_000,
    mrcCode: "SDC0010000123/0001",
    currency: "RWF",
    whtRate: null,
    purchaseType: "",
  };
  const rows = overrides.length === 0 ? [base] : overrides.map((patch, index) => ({
    ...base,
    id: `row-${index + 1}`,
    rowNumber: index + 1,
    ...patch,
  }));
  return validateRows(rows, "SALES", OPTIONS);
}

describe("buildEtaText", () => {
  it("emits a headerless, tab-delimited, CRLF line with DD/MM/YYYY and integers", () => {
    const text = buildEtaText(validated(), "SALES");
    expect(text).toBe(
      "SDC0010000123/0001\t05/10/2026\t102345678\tNyamirambo Fresh Foods Ltd\t250000\t45000\tSDC0010000123/0001\r\n",
    );
    expect(text.startsWith("Invoice")).toBe(false);
    expect(text.split("\r\n").filter(Boolean)).toHaveLength(1);
  });

  it("never leaks tabs or newlines embedded in names", () => {
    const rows = validated([{ counterpartyName: "ACME\tLtd\nKigali" }]);
    const text = buildEtaText(rows, "SALES");
    expect(text.trimEnd().split("\t")).toHaveLength(
      ANNEXURE_FORMATS.SALES.outputColumns.length,
    );
    expect(text.trimEnd().split("\r\n")).toHaveLength(1);
    expect(text).not.toContain("\tLtd");
  });

  it("refuses to export while blocking errors remain", () => {
    const rows = validated([{ counterpartyTin: "123" }]);
    expect(() => buildEtaText(rows, "SALES")).toThrow(AnnexureExportError);
    try {
      buildEtaText(rows, "SALES");
    } catch (error) {
      const exportError = error as AnnexureExportError;
      expect(exportError.issues[0]?.rowNumber).toBe(1);
      expect(exportError.issues[0]?.issues[0]?.code).toBe("TIN_INVALID");
    }
  });

  it("can emit a preview even when errors exist", () => {
    const rows = validated([{ counterpartyTin: "123" }]);
    const text = buildEtaText(rows, "SALES", { blockOnErrors: false });
    expect(text).toContain("123\t");
  });

  it("writes WHT rate without trailing decimals", () => {
    const rows = validateRows(
      [
        {
          id: "wht-1",
          rowNumber: 1,
          invoiceNo: "WHT/001",
          invoiceDate: "2026-10-03",
          counterpartyTin: "102345678",
          counterpartyName: "Ingabire Properties",
          taxableAmountRwf: 900_000,
          vatAmountRwf: 135_000,
          mrcCode: "",
          currency: "RWF",
          whtRate: 15,
          purchaseType: "",
        },
      ],
      "WHT",
      OPTIONS,
    );
    expect(buildEtaText(rows, "WHT")).toBe(
      "WHT/001\t03/10/2026\t102345678\tIngabire Properties\t900000\t15\t135000\r\n",
    );
  });
});

describe("formatOutputValue", () => {
  it("formats each canonical field", () => {
    const [row] = validated();
    if (!row) throw new Error("fixture missing");
    expect(formatOutputValue("invoiceDate", row)).toBe("05/10/2026");
    expect(formatOutputValue("taxableAmountRwf", { ...row, taxableAmountRwf: 1_500_000.4 })).toBe(
      "1500000",
    );
  });
});

describe("file names & line counts", () => {
  it("builds a deterministic RRA file name", () => {
    expect(
      buildEtaFileName({ clientTin: "102345678", periodMonth: "2026-10", type: "SALES" }),
    ).toBe("VAT_SALES_102345678_2026-10.txt");
    expect(buildEtaFileName({ clientTin: "bad", periodMonth: "2026-10", type: "WHT" })).toBe(
      "WHT_NO-TIN_2026-10.txt",
    );
  });

  it("counts lines without the trailing CRLF", () => {
    expect(etaLineCount(buildEtaText(validated(), "SALES"))).toBe(1);
    expect(etaLineCount("")).toBe(0);
  });
});
