import { NextResponse } from "next/server";

import { ANNEXURE_TYPES, type AnnexureType, type ColumnMapping } from "@/lib/annexure";
import { parseAnnexureFile } from "@/lib/annexure/parse-workbook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB is far beyond a monthly annexure

function isAnnexureType(value: unknown): value is AnnexureType {
  return typeof value === "string" && (ANNEXURE_TYPES as readonly string[]).includes(value);
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    const type = form.get("annexureType");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }
    if (!isAnnexureType(type)) {
      return NextResponse.json(
        { error: `annexureType must be one of ${ANNEXURE_TYPES.join(", ")}.` },
        { status: 400 },
      );
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "File exceeds 12 MB. Split the annexure by month or tax type." },
        { status: 413 },
      );
    }

    let mapping: ColumnMapping | null = null;
    const mappingRaw = form.get("mapping");
    if (typeof mappingRaw === "string" && mappingRaw.trim() !== "") {
      mapping = JSON.parse(mappingRaw) as ColumnMapping;
    }

    const dateOrderRaw = form.get("dateOrder");
    const dateOrder = dateOrderRaw === "MDY" ? "MDY" : "DMY";

    const result = parseAnnexureFile({
      buffer: await file.arrayBuffer(),
      fileName: file.name,
      annexureType: type,
      mapping,
      dateOrder,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to parse the uploaded file.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
