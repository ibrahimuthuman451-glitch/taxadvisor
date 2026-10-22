import { NextResponse } from "next/server";

import { parseEbmFile } from "@/lib/reconciliation/parse-ebm";
import { parseStatementFile } from "@/lib/reconciliation/parse-statements";
import {
  DEFAULT_RECONCILIATION_OPTIONS,
  reconcile,
  type ReconciliationOptions,
  type StatementTransaction,
} from "@/lib/reconciliation";
import { getAdminSupabase } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 12 * 1024 * 1024;

interface FileSummary {
  fileName: string;
  count: number;
  warnings: string[];
  issues: Array<{ rowNumber: number; message: string }>;
}

async function readFile(
  form: FormData,
  key: string,
): Promise<{ fileName: string; buffer: ArrayBuffer } | null> {
  const value = form.get(key);
  if (!(value instanceof File) || value.size === 0) return null;
  if (value.size > MAX_BYTES) throw new Error(`${key} exceeds 12 MB.`);
  return { fileName: value.name, buffer: await value.arrayBuffer() };
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const dateOrder = form.get("dateOrder") === "MDY" ? "MDY" : "DMY";

    const [ebmSalesFile, ebmPurchasesFile, momoFile, bankFile] = await Promise.all([
      readFile(form, "ebmSales"),
      readFile(form, "ebmPurchases"),
      readFile(form, "momoStatement"),
      readFile(form, "bankStatement"),
    ]);

    const provided = [ebmSalesFile, ebmPurchasesFile, momoFile, bankFile].filter(Boolean);
    if (provided.length === 0) {
      return NextResponse.json(
        { error: "Upload at least one EBM, MoMo or bank statement file." },
        { status: 400 },
      );
    }

    const files: Record<string, FileSummary> = {};
    const warnings: string[] = [];
    let ebmSales: StatementTransaction[] = [];
    let ebmPurchases: StatementTransaction[] = [];
    let momo: StatementTransaction[] = [];
    let bank: StatementTransaction[] = [];

    if (ebmSalesFile) {
      const parsed = parseEbmFile({
        buffer: ebmSalesFile.buffer,
        fileName: ebmSalesFile.fileName,
        kind: "SALES",
      });
      ebmSales = parsed.transactions;
      files.ebmSales = {
        fileName: ebmSalesFile.fileName,
        count: parsed.transactions.length,
        warnings: parsed.warnings,
        issues: parsed.issues,
      };
      warnings.push(...parsed.warnings.map((warning) => `EBM sales: ${warning}`));
    }
    if (ebmPurchasesFile) {
      const parsed = parseEbmFile({
        buffer: ebmPurchasesFile.buffer,
        fileName: ebmPurchasesFile.fileName,
        kind: "PURCHASES",
      });
      ebmPurchases = parsed.transactions;
      files.ebmPurchases = {
        fileName: ebmPurchasesFile.fileName,
        count: parsed.transactions.length,
        warnings: parsed.warnings,
        issues: parsed.issues,
      };
      warnings.push(...parsed.warnings.map((warning) => `EBM purchases: ${warning}`));
    }
    if (momoFile) {
      const parsed = parseStatementFile({
        buffer: momoFile.buffer,
        fileName: momoFile.fileName,
        source: "MOMO_STATEMENT",
        dateOrder,
      });
      momo = parsed.transactions;
      files.momo = {
        fileName: momoFile.fileName,
        count: parsed.transactions.length,
        warnings: parsed.warnings,
        issues: parsed.issues,
      };
      warnings.push(...parsed.warnings.map((warning) => `MoMo: ${warning}`));
    }
    if (bankFile) {
      const parsed = parseStatementFile({
        buffer: bankFile.buffer,
        fileName: bankFile.fileName,
        source: "BANK_STATEMENT",
        dateOrder,
      });
      bank = parsed.transactions;
      files.bank = {
        fileName: bankFile.fileName,
        count: parsed.transactions.length,
        warnings: parsed.warnings,
        issues: parsed.issues,
      };
      warnings.push(...parsed.warnings.map((warning) => `Bank: ${warning}`));
    }

    let options: ReconciliationOptions = { ...DEFAULT_RECONCILIATION_OPTIONS };
    const optionsRaw = form.get("options");
    if (typeof optionsRaw === "string" && optionsRaw.trim() !== "") {
      options = { ...options, ...(JSON.parse(optionsRaw) as Partial<ReconciliationOptions>) };
    }
    const periodMonth = form.get("periodMonth");
    if (typeof periodMonth === "string" && /^\d{4}-\d{2}$/.test(periodMonth)) {
      options.periodMonth = periodMonth;
    }

    const result = reconcile({ ebmSales, ebmPurchases, momo, bank, options });

    let persisted = false;
    let persistedCount = 0;
    const admin = getAdminSupabase();
    const taxPeriodId = form.get("taxPeriodId");
    if (admin && typeof taxPeriodId === "string" && taxPeriodId.length > 0) {
      await admin.from("reconciliation_items").delete().eq("tax_period_id", taxPeriodId);

      const records = [
        ...result.matchedPurchases.flatMap((pair) => [
          {
            tax_period_id: taxPeriodId,
            source: pair.payout.source,
            tx_date: pair.payout.txDate,
            reference_no: pair.payout.referenceNo,
            description: pair.payout.description,
            amount_rwf: pair.payout.amountRwf,
            counterparty: pair.payout.counterparty,
            counterparty_tin: pair.payout.counterpartyTin,
            match_status: "MATCHED" as const,
            notes: `Matched to EBM invoice ${pair.purchase.referenceNo} (score ${pair.score}, gap ${pair.amountGapRwf} RWF).`,
          },
          {
            tax_period_id: taxPeriodId,
            source: "EBM_PURCHASE" as const,
            tx_date: pair.purchase.txDate,
            reference_no: pair.purchase.referenceNo,
            description: pair.purchase.description,
            amount_rwf: pair.purchase.amountRwf,
            counterparty: pair.purchase.counterparty,
            counterparty_tin: pair.purchase.counterpartyTin,
            match_status: "MATCHED" as const,
            notes: `Matched to payout ${pair.payout.referenceNo}.`,
          },
        ]),
        ...result.risks.map((risk) => ({
          tax_period_id: taxPeriodId,
          source: risk.source,
          tx_date: risk.txDate,
          reference_no: risk.referenceNo,
          description: risk.description,
          amount_rwf: risk.amountRwf,
          counterparty: risk.counterparty,
          counterparty_tin: risk.counterpartyTin,
          match_status: risk.matchStatus,
          notes: risk.notes,
        })),
      ];


      if (records.length > 0) {
        const { error } = await admin.from("reconciliation_items").insert(records);
        if (error) {
          warnings.push(`Reconciliation could not be persisted: ${error.message}`);
        } else {
          persisted = true;
          persistedCount = records.length;
          await admin
            .from("tax_periods")
            .update({ status: "RECONCILING" })
            .eq("id", taxPeriodId)
            .eq("status", "WAITING_DOCS");
        }
      }
    }

    return NextResponse.json({
      result,
      files,
      warnings,
      persisted,
      persistedCount,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Reconciliation failed." },
      { status: 422 },
    );
  }
}

