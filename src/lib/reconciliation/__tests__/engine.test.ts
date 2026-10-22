import { describe, expect, it } from "vitest";

import { compareDaily, compareWeekly, inputVatFromGross, matchPurchases, reconcile } from "../engine";
import { DEFAULT_RECONCILIATION_OPTIONS, type StatementTransaction } from "../types";

const OPTIONS = { ...DEFAULT_RECONCILIATION_OPTIONS, periodMonth: "2026-10" };

function tx(overrides: Partial<StatementTransaction> = {}): StatementTransaction {
  return {
    id: "tx-1",
    source: "BANK_STATEMENT",
    direction: "IN",
    txDate: "2026-10-01",
    referenceNo: "REF-1",
    description: "POS collection",
    counterparty: "Walk-in customer",
    counterpartyTin: null,
    amountRwf: 100_000,
    vatRwf: 0,
    ...overrides,
  };
}

function purchase(overrides: Partial<StatementTransaction> = {}): StatementTransaction {
  return tx({
    id: "purchase-1",
    source: "EBM_PURCHASE",
    direction: "PURCHASE",
    txDate: "2026-10-05",
    referenceNo: "ABC/2026/0451",
    description: "Kigali Office Supplies Ltd",
    counterparty: "Kigali Office Supplies Ltd",
    counterpartyTin: "102345678",
    amountRwf: 944_000,
    vatRwf: 144_000,
    ...overrides,
  });
}

describe("compareDaily / compareWeekly", () => {
  it("aggregates both wallets per day and flags deposits above EBM sales", () => {
    const sales = [
      tx({ direction: "SALE", source: "EBM_SALE", txDate: "2026-10-01", amountRwf: 250_000 }),
      tx({ id: "sale-2", direction: "SALE", source: "EBM_SALE", txDate: "2026-10-02", amountRwf: 100_000 }),
    ];
    const deposits = [
      tx({ txDate: "2026-10-01", amountRwf: 200_000 }),
      tx({ id: "dep-2", source: "MOMO_STATEMENT", txDate: "2026-10-01", amountRwf: 80_000 }),
      tx({ id: "dep-3", txDate: "2026-10-03", amountRwf: 40_000 }),
    ];
    const daily = compareDaily(sales, deposits, OPTIONS);
    expect(daily).toHaveLength(3);
    expect(daily[0]).toMatchObject({ ebmSalesRwf: 250_000, depositsRwf: 280_000, varianceRwf: 30_000 });
    expect(daily[0]?.status).toBe("DEPOSITS_EXCEED_SALES");
    expect(daily[2]?.status).toBe("DEPOSITS_EXCEED_SALES");

    const weekly = compareWeekly(daily);
    expect(weekly).toHaveLength(1);
    expect(weekly[0]?.weekStart).toBe("2026-09-28");
    expect(weekly[0]?.depositsRwf).toBe(320_000);
  });
});

describe("matchPurchases", () => {
  it("matches by TIN, amount and date window", () => {
    const payout = tx({
      direction: "OUT",
      txDate: "2026-10-06",
      amountRwf: 944_000,
      counterparty: "KIGALI OFFICE SUPPLIES LTD",
      counterpartyTin: "102345678",
    });
    const result = matchPurchases([payout], [purchase()], OPTIONS);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]?.amountGapRwf).toBe(0);
    expect(result.matched[0]?.dayGap).toBe(1);
  });

  it("matches by supplier name when the bank statement has no TIN", () => {
    const payout = tx({
      direction: "OUT",
      txDate: "2026-10-08",
      amountRwf: 253_700,
      counterparty: "PAYMENT TO VOLCANO PACKAGING SARL",
    });
    const result = matchPurchases(
      [payout],
      [purchase({ counterparty: "Volcano Packaging SARL", counterpartyTin: "103456789", amountRwf: 253_700, vatRwf: 38_700 })],
      OPTIONS,
    );
    expect(result.matched).toHaveLength(1);
  });

  it("rejects different amounts and dates outside the window", () => {
    const wrongAmount = matchPurchases(
      [tx({ direction: "OUT", amountRwf: 500_000 })],
      [purchase()],
      OPTIONS,
    );
    expect(wrongAmount.matched).toHaveLength(0);

    const wrongDate = matchPurchases(
      [tx({ direction: "OUT", txDate: "2026-10-25", amountRwf: 944_000 })],
      [purchase()],
      OPTIONS,
    );
    expect(wrongDate.matched).toHaveLength(0);
  });

  it("does not reuse one purchase for two payouts", () => {
    const payouts = [
      tx({
        id: "p1",
        direction: "OUT",
        txDate: "2026-10-06",
        amountRwf: 944_000,
        counterparty: "KIGALI OFFICE SUPPLIES LTD",
      }),
      tx({
        id: "p2",
        direction: "OUT",
        txDate: "2026-10-06",
        amountRwf: 944_000,
        counterparty: "KIGALI OFFICE SUPPLIES LTD",
      }),
    ];
    const result = matchPurchases(payouts, [purchase()], OPTIONS);
    expect(result.matched).toHaveLength(1);
    expect(result.unmatchedPayouts).toHaveLength(1);
  });
});

describe("reconcile", () => {
  it("produces KPIs, daily risk items and unmatched VAT exposures", () => {
    const ebmSales = [
      tx({ id: "s1", source: "EBM_SALE", direction: "SALE", txDate: "2026-10-01", amountRwf: 295_000 }),
      tx({ id: "s2", source: "EBM_SALE", direction: "SALE", txDate: "2026-10-05", amountRwf: 141_600 }),
    ];
    const momo = [
      tx({ id: "m1", source: "MOMO_STATEMENT", txDate: "2026-10-01", amountRwf: 295_000 }),
      tx({ id: "m2", source: "MOMO_STATEMENT", txDate: "2026-10-05", amountRwf: 200_000 }),
    ];
    const bank = [
      tx({ id: "b1", txDate: "2026-10-06", direction: "OUT", amountRwf: 944_000, counterparty: "KIGALI OFFICE SUPPLIES LTD" }),
      tx({ id: "b2", txDate: "2026-10-03", direction: "OUT", amountRwf: 400_000, counterparty: "JEAN BOSCO HABIMANA RENT" }),
    ];
    const ebmPurchases = [purchase()];

    const result = reconcile({ ebmSales, ebmPurchases, momo, bank, options: OPTIONS });

    expect(result.totals.ebmSalesRwf).toBe(436_600);
    expect(result.totals.depositsRwf).toBe(495_000);
    expect(result.totals.uninvoicedVarianceRwf).toBe(58_400);
    expect(result.totals.dailyRiskRwf).toBe(58_400);
    expect(result.totals.matchedCount).toBe(1);
    expect(result.totals.unclaimedPurchaseCount).toBe(0);
    expect(result.totals.missingPurchaseCount).toBe(1);
    expect(result.totals.missingInputVatRwf).toBe(inputVatFromGross(400_000));
    expect(result.risks.filter((risk) => risk.matchStatus === "UNINVOICED_REVENUE_RISK")).toHaveLength(1);
    expect(result.risks.filter((risk) => risk.matchStatus === "MISSING_EBM_PURCHASE")).toHaveLength(1);
  });

  it("computes 18/118 input VAT on gross payments", () => {
    expect(inputVatFromGross(118_000)).toBe(18_000);
    expect(inputVatFromGross(400_000)).toBe(61_017);
  });
});
