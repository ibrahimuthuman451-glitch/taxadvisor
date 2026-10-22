import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { parseAnnexureFile } from "../parse-workbook";

function csvBuffer(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const SALES_CSV = `EBM v2.1 Back Office - Sales Report,,,,
Period: October 2026,,,,
N° Facture,Date Facture,TIN,Nom ou Raison Sociale,Montant HT,TVA,Code MRC
SDC0010000123/0001,01/10/2026,102 345 678,"Nyamirambo Fresh Foods, Ltd",250000,45000,SDC0010000123
SDC0010000123/0002,2026-10-03,103456789,Éric Mugisha,120000,21600,SDC0010000123/0002
Total,,,,370000,66600,
`;

describe("parseAnnexureFile — CSV", () => {
  it("skips title rows, auto-maps French headers and normalizes values", () => {
    const result = parseAnnexureFile({
      buffer: csvBuffer(SALES_CSV),
      fileName: "sales.csv",
      annexureType: "SALES",
    });

    expect(result.headers).toContain("N° Facture");
    expect(result.mapping["N° Facture"]).toBe("invoiceNo");
    expect(result.mapping["Date Facture"]).toBe("invoiceDate");
    expect(result.mapping["Montant HT"]).toBe("taxableAmountRwf");
    expect(result.rows).toHaveLength(2);
    expect(result.skippedRows).toBe(1);
    expect(result.rows[0]).toMatchObject({
      invoiceNo: "SDC0010000123/0001",
      invoiceDate: "2026-10-01",
      counterpartyTin: "102345678",
      counterpartyName: "Nyamirambo Fresh Foods Ltd",
      taxableAmountRwf: 250_000,
      vatAmountRwf: 45_000,
    });
    expect(result.rows[1]?.counterpartyName).toBe("Eric Mugisha");
    expect(result.warnings.join(" ")).toContain("Detected header row 3");
  });

  it("honours a manual column mapping override", () => {
    const custom = csvBuffer(
      "Ref,When,ClientID,ClientName,Net,VAT,Device\nINV-1,05/10/2026,102345678,ACME,100000,18000,SDC0010000999\n",
    );
    const result = parseAnnexureFile({
      buffer: custom,
      fileName: "custom.csv",
      annexureType: "SALES",
      mapping: {
        Ref: "invoiceNo",
        When: "invoiceDate",
        ClientID: "counterpartyTin",
        ClientName: "counterpartyName",
        Net: "taxableAmountRwf",
        VAT: "vatAmountRwf",
        Device: "mrcCode",
      },
    });
    expect(result.rows[0]).toMatchObject({
      invoiceNo: "INV-1",
      counterpartyTin: "102345678",
      taxableAmountRwf: 100_000,
      mrcCode: "SDC0010000999",
    });
  });

  it("rejects unsupported file types", () => {
    expect(() =>
      parseAnnexureFile({
        buffer: csvBuffer("x"),
        fileName: "statement.pdf",
        annexureType: "SALES",
      }),
    ).toThrow(/Unsupported file type/);
  });
});

describe("parseAnnexureFile — XLSX", () => {
  it("reads Excel serial dates, numeric TINs and messy names", () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Company", "Sales annexure", null, null, null, null, null],
      [
        "Invoice Number",
        "Invoice Date",
        "Buyer TIN",
        "Buyer Name",
        "Taxable Amount",
        "VAT",
        "MRC",
      ],
      ["SDC/1", new Date(Date.UTC(2026, 9, 6)), 102345678, "Ngali Holdings", 500_000, 90_000, "SDC0010000888"],
      ["SDC/2", 46297, 103456789, "Muhima Traders", 200_000, 36_000, "SDC0010000888"],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "VAT Sales");
    const buffer = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const result = parseAnnexureFile({
      buffer,
      fileName: "sales.xlsx",
      annexureType: "SALES",
    });

    expect(result.sheetName).toBe("VAT Sales");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.invoiceDate).toBe("2026-10-06");
    expect(result.rows[0]?.counterpartyTin).toBe("102345678");
    expect(result.rows[1]?.invoiceDate).toBe("2026-10-02");
    expect(result.rows[1]?.counterpartyName).toBe("Muhima Traders");
  });
});
