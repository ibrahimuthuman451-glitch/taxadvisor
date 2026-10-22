import { describe, expect, it } from "vitest";

import { parseEbmFile } from "../parse-ebm";
import { parseStatementFile } from "../parse-statements";
import { buildUnsupportedExpense, summarizeExpenses } from "../expenses";

function buffer(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe("parseStatementFile — MoMo", () => {
  it("maps MoMo merchant columns, times and Collection type to inflows", () => {
    const csv = `MTN MoMo Pay - Merchant Statement,,,,,,,
Merchant: Nyamirambo Fresh Foods Ltd,TIN: 102345678,,,,,,
Financial Transaction ID,Date,Amount,Currency,Type,Payer Message,Sender,Sender TIN
MP2610010001,01/10/2026 09:12,285000,RWF,Collection,Groceries,Jean Claude Niyonzima,103456789
MP2610050003,05/10/2026 16:20,200000,RWF,Collection,Event catering,Eric Habimana,105678901
`;
    const result = parseStatementFile({
      buffer: buffer(csv),
      fileName: "momo.csv",
      source: "MOMO_STATEMENT",
    });
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({
      source: "MOMO_STATEMENT",
      direction: "IN",
      txDate: "2026-10-01",
      amountRwf: 285_000,
      referenceNo: "MP2610010001",
      counterparty: "Jean Claude Niyonzima",
      counterpartyTin: "103456789",
    });
  });
});

describe("parseStatementFile — bank", () => {
  it("uses separate debit/credit columns and skips closing-balance rows", () => {
    const csv = `Bank of Kigali - Current Account Statement,,,,,,
Account 000123456789,Period: October 2026,TIN 102345678,,,,,
Date,Value Date,Narrative,Reference,Debit,Credit,Balance
01/10/2026,01/10/2026,POS COLLECTION NYAMIRAMBO BRANCH,POS/2026/001,,10000,410000
06/10/2026,06/10/2026,PAYMENT TO KIGALI OFFICE SUPPLIES LTD,PAY/2026/011,944000,,910000
31/10/2026,31/10/2026,CLOSING BALANCE,,,0,1815231
`;
    const result = parseStatementFile({
      buffer: buffer(csv),
      fileName: "bank.csv",
      source: "BANK_STATEMENT",
    });
    expect(result.transactions).toHaveLength(2);
    expect(result.skippedRows).toBeGreaterThanOrEqual(1);

    const inflow = result.transactions.find((transaction) => transaction.direction === "IN");
    const outflow = result.transactions.find((transaction) => transaction.direction === "OUT");
    expect(inflow?.amountRwf).toBe(10_000);
    expect(outflow?.amountRwf).toBe(944_000);
    expect(outflow?.counterparty).toContain("KIGALI OFFICE SUPPLIES");
  });

  it("handles signed amounts and negative outflows", () => {
    const csv = `Date,Description,Amount,Reference
02/10/2026,SALARY PAYMENT,-50000,SAL/1
03/10/2026,CUSTOMER PAYMENT,150000,RCV/1
`;
    const result = parseStatementFile({
      buffer: buffer(csv),
      fileName: "bank-signed.csv",
      source: "BANK_STATEMENT",
    });
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({ direction: "OUT", amountRwf: 50_000 });
    expect(result.transactions[1]).toMatchObject({ direction: "IN", amountRwf: 150_000 });
  });
});

describe("parseEbmFile", () => {
  it("adapts EBM sales exports to gross transactions with TINs", () => {
    const csv = `N° Facture,Date Facture,TIN,Nom ou Raison Sociale,Montant HT,TVA,Code MRC
SDC0010000123/0001,01/10/2026,102345678,Nyamirambo Fresh Foods,250000,45000,SDC0010000123
`;
    const result = parseEbmFile({ buffer: buffer(csv), fileName: "sales.csv", kind: "SALES" });
    expect(result.transactions[0]).toMatchObject({
      source: "EBM_SALE",
      direction: "SALE",
      amountRwf: 295_000,
      vatRwf: 45_000,
      txDate: "2026-10-01",
      counterpartyTin: "102345678",
    });
  });
});

describe("unsupported expenses", () => {
  it("flags 15% WHT on individual rent and computes the withheld amount", () => {
    const expense = buildUnsupportedExpense({
      id: "exp-1",
      expenseDate: "2026-10-03",
      category: "RENT_INDIVIDUAL",
      vendorName: "Jean Bosco Habimana",
      amountRwf: 400_000,
    });
    expect(expense.whtRequired).toBe(true);
    expect(expense.whtRate).toBe(15);
    expect(expense.whtAmountRwf).toBe(60_000);
  });

  it("uses 3% for goods and no WHT for utilities", () => {
    const goods = buildUnsupportedExpense({
      id: "exp-2",
      expenseDate: "2026-10-04",
      category: "MARKETING",
      vendorName: "Kigali Printers",
      amountRwf: 100_000,
    });
    expect(goods.whtAmountRwf).toBe(3_000);

    const utilities = buildUnsupportedExpense({
      id: "exp-3",
      expenseDate: "2026-10-05",
      category: "UTILITIES",
      vendorName: "WASAC",
      amountRwf: 50_000,
    });
    expect(utilities.whtRequired).toBe(false);
    expect(utilities.whtAmountRwf).toBe(0);
  });

  it("summarises totals", () => {
    const summary = summarizeExpenses([
      buildUnsupportedExpense({
        id: "a",
        expenseDate: "2026-10-01",
        category: "CASUAL_LABOUR",
        vendorName: "Workers",
        amountRwf: 100_000,
      }),
      buildUnsupportedExpense({
        id: "b",
        expenseDate: "2026-10-02",
        category: "UTILITIES",
        vendorName: "WASAC",
        amountRwf: 20_000,
      }),
    ]);
    expect(summary.totalRwf).toBe(120_000);
    expect(summary.whtDueRwf).toBe(15_000);
    expect(summary.whtSensitiveCount).toBe(1);
  });
});
