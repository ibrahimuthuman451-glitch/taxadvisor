import { NextResponse } from "next/server";

import {
  ANNEXURE_TYPES,
  DEFAULT_ANNEXURE_OPTIONS,
  buildEtaFileName,
  buildEtaText,
  validateRows,
  type AnnexureRow,
  type AnnexureType,
  type AnnexureValidationOptions,
} from "@/lib/annexure";
import { getAdminSupabase } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExportBody {
  annexureType?: AnnexureType;
  rows?: AnnexureRow[];
  options?: Partial<AnnexureValidationOptions>;
  clientTin?: string | null;
  periodMonth?: string | null;
  /** When provided (and Supabase is configured) rows are persisted. */
  taxPeriodId?: string | null;
}

function isAnnexureType(value: unknown): value is AnnexureType {
  return typeof value === "string" && (ANNEXURE_TYPES as readonly string[]).includes(value);
}

export async function POST(request: Request) {
  let body: ExportBody;
  try {
    body = (await request.json()) as ExportBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!isAnnexureType(body.annexureType)) {
    return NextResponse.json(
      { error: `annexureType must be one of ${ANNEXURE_TYPES.join(", ")}.` },
      { status: 400 },
    );
  }
  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return NextResponse.json({ error: "No annexure rows supplied." }, { status: 400 });
  }

  const options: AnnexureValidationOptions = {
    ...DEFAULT_ANNEXURE_OPTIONS,
    periodMonth: body.periodMonth ?? null,
    ...body.options,
  };
  const validated = validateRows(body.rows, body.annexureType, options);

  let text: string;
  try {
    text = buildEtaText(validated, body.annexureType, { blockOnErrors: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Annexure failed validation.",
        issues: error instanceof Object && "issues" in error ? error.issues : [],
      },
      { status: 422 },
    );
  }

  let persisted = false;
  const admin = getAdminSupabase();
  if (admin && body.taxPeriodId) {
    const { error: deleteError } = await admin
      .from("annexure_rows")
      .delete()
      .eq("tax_period_id", body.taxPeriodId)
      .eq("annexure_type", body.annexureType);

    if (!deleteError) {
      const { error: insertError } = await admin.from("annexure_rows").insert(
        validated.map((row, index) => ({
          tax_period_id: body.taxPeriodId,
          annexure_type: body.annexureType,
          row_number: index + 1,
          counterparty_tin: /^[0-9]{9}$/.test(row.counterpartyTin) ? row.counterpartyTin : null,
          counterparty_name: row.counterpartyName,
          invoice_no: row.invoiceNo,
          mrc_code: row.mrcCode || null,
          invoice_date: row.invoiceDate,
          taxable_amount_rwf: row.taxableAmountRwf,
          vat_amount_rwf: row.vatAmountRwf,
          validation_status: row.status,
          error_messages: row.issues,
        })),
      );
      persisted = !insertError;
      if (insertError) {
        console.error("[annexure/export] persistence failed", insertError.message);
      }
    }
  }

  const fileName = buildEtaFileName({
    clientTin: body.clientTin,
    periodMonth: body.periodMonth,
    type: body.annexureType,
  });

  return new NextResponse(text, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
      "X-Row-Count": String(validated.length),
      "X-Annexure-Persisted": String(persisted),
    },
  });
}
