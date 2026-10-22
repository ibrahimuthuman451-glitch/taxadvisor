"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Eye,
  FileSpreadsheet,
  Info,
  ListChecks,
  RefreshCw,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";

import { EditableAnnexureGrid, type EditableField } from "./editable-grid";
import { MappingDialog } from "./mapping-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { FileDropzone } from "@/components/shared/file-dropzone";
import { KpiCard } from "@/components/shared/kpi-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ANNEXURE_FORMATS,
  ANNEXURE_TYPES,
  DEFAULT_ANNEXURE_OPTIONS,
  AnnexureExportError,
  autoFixRows,
  buildEtaFileName,
  buildEtaText,
  computeTotals,
  etaLineCount,
  validateRows,
  type AnnexureParseResult,
  type AnnexureRow,
  type AnnexureType,
  type AnnexureValidationOptions,
  type AutoFixMode,
  type ColumnMapping,
} from "@/lib/annexure";
import { applyCellEdit, createEmptyRow } from "@/lib/annexure/edits";
import { isValidTin } from "@/lib/annexure/normalize";
import { cn, formatNumber, formatRwf } from "@/lib/utils";

const SAMPLE_FILES: Record<AnnexureType, { path: string; name: string }> = {
  SALES: { path: "/samples/ebm-sales-sample.csv", name: "EBM_v21_Sales_Export.csv" },
  PURCHASES: {
    path: "/samples/ebm-purchases-sample.csv",
    name: "EBM_v21_Confirmed_Purchases.csv",
  },
  IMPORTS: { path: "/samples/dmc-imports-sample.csv", name: "DMC_Customs_Declarations.csv" },
  WHT: { path: "/samples/wht-sample.csv", name: "WHT_Annexure_Export.csv" },
};

type RowFilter = "ALL" | "ERROR" | "WARNING";

export function AnnexureWorkbench() {
  const [type, setType] = React.useState<AnnexureType>("SALES");
  const [file, setFile] = React.useState<File | null>(null);
  const [result, setResult] = React.useState<AnnexureParseResult | null>(null);
  const [rows, setRows] = React.useState<AnnexureRow[]>([]);
  const [options, setOptions] = React.useState<AnnexureValidationOptions>({
    ...DEFAULT_ANNEXURE_OPTIONS,
    periodMonth: new Date().toISOString().slice(0, 7),
  });
  const [clientTin, setClientTin] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [mappingOpen, setMappingOpen] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [filter, setFilter] = React.useState<RowFilter>("ALL");

  const format = ANNEXURE_FORMATS[type];

  const validated = React.useMemo(() => validateRows(rows, type, options), [rows, type, options]);
  const totals = React.useMemo(
    () => computeTotals(validated, type, options),
    [validated, type, options],
  );
  const blockingRows = React.useMemo(
    () => validated.filter((row) => row.status === "ERROR"),
    [validated],
  );
  const visibleRows = React.useMemo(
    () =>
      validated.filter((row) =>
        filter === "ALL"
          ? true
          : filter === "ERROR"
            ? row.status === "ERROR"
            : row.status !== "VALID",
      ),
    [validated, filter],
  );
  const previewText = React.useMemo(() => {
    try {
      return validated.length === 0
        ? ""
        : buildEtaText(validated, type, { blockOnErrors: false });
    } catch {
      return "";
    }
  }, [validated, type]);


  const parseFile = React.useCallback(
    async (
      nextFile: File,
      overrides: {
        mapping?: ColumnMapping | null;
        type?: AnnexureType;
        dateOrder?: "DMY" | "MDY";
      } = {},
    ) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const body = new FormData();
        body.set("file", nextFile);
        body.set("annexureType", overrides.type ?? type);
        body.set("dateOrder", overrides.dateOrder ?? options.dateOrder);
        if (overrides.mapping) body.set("mapping", JSON.stringify(overrides.mapping));

        const response = await fetch("/api/annexure/parse", { method: "POST", body });
        const payload = (await response.json()) as AnnexureParseResult & { error?: string };
        if (!response.ok) {
          setFile(nextFile);
          setResult(null);
          setRows([]);
          setError(payload.error ?? "Unable to parse this file.");
          return;
        }
        setFile(nextFile);
        setResult(payload);
        setRows(payload.rows);
        setNotice(
          `Parsed ${payload.rows.length} row(s) from ${payload.fileName}${
            payload.skippedRows > 0 ? ` · ${payload.skippedRows} empty/total row(s) skipped` : ""
          }.`,
        );
      } catch (parseError) {
        setError(parseError instanceof Error ? parseError.message : "Unexpected parsing error.");
      } finally {
        setBusy(false);
      }
    },
    [type, options.dateOrder],
  );

  const changeType = (next: AnnexureType) => {
    if (next === type) return;
    setType(next);
    setFilter("ALL");
    setNotice(null);
    setError(null);
    if (file) {
      void parseFile(file, { type: next });
    } else {
      setResult(null);
      setRows([]);
    }
  };

  const loadSample = async () => {
    setBusy(true);
    setError(null);
    try {
      const sample = SAMPLE_FILES[type];
      const response = await fetch(sample.path);
      if (!response.ok) throw new Error("Sample file is unavailable.");
      const blob = await response.blob();
      const sampleFile = new File([blob], sample.name, { type: "text/csv" });
      await parseFile(sampleFile, { dateOrder: "DMY" });
    } catch (sampleError) {
      setError(sampleError instanceof Error ? sampleError.message : "Could not load the sample.");
      setBusy(false);
    }
  };

  const updateRow = (id: string, field: EditableField, raw: string) => {
    setRows((current) =>
      current.map((row) =>
        row.id === id ? applyCellEdit(row, field, raw, options.dateOrder) : row,
      ),
    );
  };

  const deleteRow = (id: string) => {
    setRows((current) => current.filter((row) => row.id !== id));
  };

  const addRow = () => {
    setRows((current) => {
      const nextIndex = current.reduce((max, row) => Math.max(max, row.rowNumber), 0) + 1;
      return [...current, createEmptyRow(nextIndex)];
    });
  };

  const runAutoFix = (mode: AutoFixMode) => {
    const fixed = autoFixRows(rows, type, options, mode);
    setRows(fixed.rows);
    setNotice(
      fixed.fixedCount === 0
        ? "No changes were needed — every row already satisfies the 18% rule."
        : `Auto-fix updated ${fixed.fixedCount} row(s): ${fixed.changes
            .slice(0, 3)
            .map((change) => `row ${change.rowNumber} ${change.from || "blank"} → ${change.to}`)
            .join(", ")}${fixed.changes.length > 3 ? ` +${fixed.changes.length - 3} more` : ""}.`,
    );
  };

  const removeErrorRows = () => {
    const invalidIds = new Set(blockingRows.map((row) => row.id));
    setRows((current) => current.filter((row) => !invalidIds.has(row.id)));
    setNotice(`Removed ${invalidIds.size} invalid row(s) from this session.`);
  };

  const downloadTxt = () => {
    try {
      const text = buildEtaText(validated, type, { blockOnErrors: true });
      const fileName = buildEtaFileName({
        clientTin: isValidTin(clientTin) ? clientTin : null,
        periodMonth: options.periodMonth,
        type,
      });
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNotice(`Downloaded ${fileName} · ${etaLineCount(text)} headerless tab-delimited lines.`);
    } catch (exportError) {
      if (exportError instanceof AnnexureExportError) {
        setError(exportError.message);
        setFilter("ERROR");
      } else {
        setError(exportError instanceof Error ? exportError.message : "Export failed.");
      }
    }
  };

  const copyTxt = async () => {
    try {
      await navigator.clipboard.writeText(previewText);
      setNotice("Copied the tab-delimited annexure to the clipboard.");
    } catch {
      setError("Clipboard access was blocked by the browser.");
    }
  };



  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        eyebrow="Module 1 · RRA pre-declaration"
        title="Annexure Sanitizer & .txt Generator"
        description={
          <>
            Turn EBM v2.1, QuickBooks, Tally or Xero exports into a clean, headerless, tab-delimited
            file for <span className="font-mono text-xs">etax.rra.gov.rw</span> — no Excel macros, no
            regional date crashes. TINs, dates, MRCs and 18% VAT are validated on every keystroke.
          </>
        }
        actions={
          <>
            <Input
              aria-label="Client TIN for file name"
              value={clientTin}
              onChange={(event) =>
                setClientTin(event.target.value.replace(/[^\d]/g, "").slice(0, 9))
              }
              placeholder="Client TIN (9 digits)"
              className={cn(
                "h-9 w-[180px] font-mono text-xs",
                clientTin && !isValidTin(clientTin) && "border-warning",
              )}
            />
            <Button
              variant="outline"
              onClick={() => setPreviewOpen(true)}
              disabled={validated.length === 0}
            >
              <Eye className="h-4 w-4" /> Preview
            </Button>
            <Button
              variant="accent"
              onClick={downloadTxt}
              disabled={validated.length === 0 || totals.errorCount > 0}
              title={
                totals.errorCount > 0
                  ? `Fix ${totals.errorCount} blocking error(s) before exporting`
                  : "Download headerless tab-delimited .txt"
              }
            >
              <Download className="h-4 w-4" /> Download RRA E-Tax .txt
            </Button>
          </>
        }
      />

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs value={type} onValueChange={(value) => changeType(value as AnnexureType)}>
          <TabsList className="h-auto flex-wrap gap-1 p-1">
            {ANNEXURE_TYPES.map((option) => (
              <TabsTrigger key={option} value={option} className="gap-1.5 px-3 py-1.5">
                {ANNEXURE_FORMATS[option].shortLabel}
                <span className="hidden text-[10px] font-normal text-muted-foreground sm:inline">
                  {option === "SALES"
                    ? "VAT out"
                    : option === "PURCHASES"
                      ? "VAT in"
                      : option === "IMPORTS"
                        ? "DMC"
                        : "15% / 3%"}
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
          {format.description}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileSpreadsheet className="h-4 w-4 text-accent" /> 1. Ingest client export
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <FileDropzone
              id="annexure-file"
              file={file}
              loading={busy}
              disabled={busy}
              label={`Drop the ${format.shortLabel.toLowerCase()} .xlsx or .csv export`}
              hint="EBM v2.1 Back Office, QuickBooks, Tally, Xero or a custom template. Title rows, BOMs and Windows-1252 encodings are handled automatically."
              accept=".xlsx,.xls,.csv,.txt"
              onFile={(next) => void parseFile(next)}
              onClear={() => {
                setFile(null);
                setResult(null);
                setRows([]);
                setError(null);
                setNotice(null);
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadSample()}
                disabled={busy}
              >
                {busy ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Load sample {format.shortLabel.toLowerCase()} export
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMappingOpen(true)}
                disabled={!result || result.headers.length === 0 || busy}
              >
                <ListChecks className="h-4 w-4" /> Map columns
                {result ? ` (${result.headers.length})` : ""}
              </Button>
              {file && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFile(null);
                    setResult(null);
                    setRows([]);
                  }}
                >
                  <Trash2 className="h-4 w-4" /> Reset
                </Button>
              )}
            </div>
            {result && result.warnings.length > 0 && (
              <ul className="space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
                {result.warnings.map((warning) => (
                  <li key={warning} className="flex items-start gap-1.5">
                    <Info className="mt-0.5 h-3 w-3 shrink-0" /> {warning}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>


        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <ClipboardCheck className="h-4 w-4 text-accent" /> 2. Period & validation rules
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="period-month">Tax period</Label>
              <Input
                id="period-month"
                type="month"
                value={options.periodMonth ?? ""}
                onChange={(event) =>
                  setOptions((current) => ({
                    ...current,
                    periodMonth: event.target.value || null,
                  }))
                }
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="tolerance">VAT tolerance (RWF)</Label>
                <Input
                  id="tolerance"
                  type="number"
                  min={0}
                  max={1000}
                  value={options.toleranceRwf}
                  onChange={(event) =>
                    setOptions((current) => ({
                      ...current,
                      toleranceRwf: Math.max(0, Number(event.target.value) || 0),
                    }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Ambiguous dates</Label>
                <Select
                  value={options.dateOrder}
                  onValueChange={(value) =>
                    setOptions((current) => ({ ...current, dateOrder: value as "DMY" | "MDY" }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DMY">DD/MM/YYYY (Rwanda)</SelectItem>
                    <SelectItem value="MDY">MM/DD/YYYY (US export)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2 rounded-lg border bg-slate-50/60 p-3">
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-emerald-600"
                  checked={options.vatRegistered}
                  onChange={(event) =>
                    setOptions((current) => ({ ...current, vatRegistered: event.target.checked }))
                  }
                />
                <span>
                  <span className="font-medium text-navy">VAT-registered client</span>
                  <span className="block text-[11px] text-muted-foreground">
                    Enforce 18% VAT math (disable for LUMP_SUM / FLAT regimes).
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-emerald-600"
                  checked={options.requireMrc}
                  onChange={(event) =>
                    setOptions((current) => ({ ...current, requireMrc: event.target.checked }))
                  }
                />
                <span>
                  <span className="font-medium text-navy">Require MRC codes</span>
                  <span className="block text-[11px] text-muted-foreground">
                    Machine Registration Code must match SDC0010000123/0001.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-emerald-600"
                  checked={options.requireRwf}
                  onChange={(event) =>
                    setOptions((current) => ({ ...current, requireRwf: event.target.checked }))
                  }
                />
                <span>
                  <span className="font-medium text-navy">RWF-only declaration</span>
                  <span className="block text-[11px] text-muted-foreground">
                    Block foreign-currency lines instead of silently rounding them.
                  </span>
                </span>
              </label>
            </div>
            <div className="rounded-lg border border-emerald-200 bg-valid-soft/60 p-3 text-[11px] leading-relaxed text-emerald-900">
              <p className="font-semibold">Output contract</p>
              <p className="mt-1">
                {format.outputColumns.join(" → ")} · headerless · tab-delimited · CRLF ·{" "}
                {options.vatRegistered && format.vatApplicable
                  ? "18% VAT checked"
                  : "VAT math off"}
                .
              </p>
            </div>
          </CardContent>
        </Card>
      </div>


      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard
          label="Rows ingested"
          value={formatNumber(totals.rowCount)}
          hint={`${result?.headers.length ?? 0} source columns mapped`}
          icon={FileSpreadsheet}
        />
        <KpiCard
          label="RRA-ready rows"
          value={formatNumber(totals.validCount)}
          hint="Pass every hard rule"
          icon={CheckCircle2}
          tone="valid"
        />
        <KpiCard
          label="Warnings"
          value={formatNumber(totals.warningCount)}
          hint="Rounding, duplicates, period"
          icon={AlertTriangle}
          tone="warning"
        />
        <KpiCard
          label="Blocking errors"
          value={formatNumber(totals.errorCount)}
          hint="TIN, date, MRC, VAT mismatch"
          icon={AlertTriangle}
          tone="risk"
        />
        <KpiCard
          label="Net taxable"
          value={formatRwf(totals.totalTaxableRwf)}
          hint="Whole RWF across all rows"
        />
        <KpiCard
          label={format.taxLabel}
          value={formatRwf(totals.totalVatRwf)}
          hint={
            format.vatApplicable
              ? `18% expectation ${formatRwf(totals.expectedVatRwf)} · gap ${formatRwf(totals.varianceRwf)}`
              : "15% services / 3% goods"
          }
          tone={totals.varianceRwf === 0 ? "valid" : "gold"}
        />
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-risk-soft px-4 py-3 text-sm text-rose-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p className="font-medium">Export blocked</p>
            <p className="text-xs leading-relaxed">{error}</p>
          </div>
          <button type="button" className="text-xs underline" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}
      {notice && !error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-200 bg-valid-soft px-4 py-3 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="flex-1 text-xs leading-relaxed">{notice}</p>
          <button type="button" className="text-xs underline" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}


      <div className="mt-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <Tabs value={filter} onValueChange={(value) => setFilter(value as RowFilter)}>
          <TabsList>
            <TabsTrigger value="ALL">All rows</TabsTrigger>
            <TabsTrigger value="WARNING">
              Needs review
              <Badge variant="warning" className="ml-1.5 px-1.5 py-0 text-[10px]">
                {totals.warningCount + totals.errorCount}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="ERROR">
              Errors
              <Badge variant="risk" className="ml-1.5 px-1.5 py-0 text-[10px]">
                {totals.errorCount}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => runAutoFix("rounding")}
            disabled={rows.length === 0}
            title="Align VAT/WHT gaps inside the ±tolerance band only"
          >
            <Wand2 className="h-4 w-4" /> Fix ±1 rounding
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => runAutoFix("recalculate")}
            disabled={rows.length === 0}
            title="Recompute the VAT/WHT column from the taxable base for every row"
          >
            <RefreshCw className="h-4 w-4" /> Recalculate 18% VAT
          </Button>
          {totals.errorCount > 0 && (
            <Button variant="ghost" size="sm" onClick={removeErrorRows} className="text-risk">
              <Trash2 className="h-4 w-4" /> Remove {totals.errorCount} invalid
            </Button>
          )}
          <Button
            variant="accent"
            size="sm"
            onClick={() => setPreviewOpen(true)}
            disabled={validated.length === 0}
          >
            <Eye className="h-4 w-4" /> Preview .txt
          </Button>
        </div>
      </div>

      <div className="mt-3">
        <EditableAnnexureGrid
          rows={visibleRows}
          type={type}
          options={options}
          onUpdate={updateRow}
          onDelete={deleteRow}
          onAddRow={addRow}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-white px-4 py-3 text-xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span>
            Taxable{" "}
            <span className="font-semibold text-navy tabular-nums">
              {formatRwf(totals.totalTaxableRwf)}
            </span>
          </span>
          <span>
            {format.taxLabel}{" "}
            <span className="font-semibold text-navy tabular-nums">
              {formatRwf(totals.totalVatRwf)}
            </span>
          </span>
          <span>
            Lines to file{" "}
            <span className="font-semibold text-navy tabular-nums">
              {formatNumber(totals.rowCount)}
            </span>
          </span>
        </div>
        <span className="flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5" /> Excel is never required — output is plain UTF-8
          tab-delimited text.
        </span>
      </div>


      <MappingDialog
        open={mappingOpen}
        onOpenChange={setMappingOpen}
        headers={result?.headers ?? []}
        mapping={result?.mapping ?? {}}
        type={type}
        busy={busy}
        onApply={(mapping) => {
          setMappingOpen(false);
          if (file) void parseFile(file, { mapping, type });
        }}
      />

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>RRA E-Tax .txt preview</DialogTitle>
            <DialogDescription>
              Exactly what gets uploaded: no header row, tab-delimited, {etaLineCount(previewText)}{" "}
              line(s). Tabs are shown as <span className="font-mono">⇥</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[46vh] overflow-auto rounded-lg border bg-navy p-3 scrollbar-thin">
            <pre className="whitespace-pre font-mono text-[11px] leading-relaxed text-emerald-100">
              {previewText.replace(/\t/g, " ⇥ ").replace(/\r\n/g, "\n") || "No rows to preview yet."}
            </pre>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
            <p className="font-semibold text-navy">Column order</p>
            <ol className="mt-1 list-decimal pl-4">
              {format.outputColumns.map((column) => (
                <li key={column}>{column}</li>
              ))}
            </ol>
            <p className="mt-2">
              Blocking errors: <span className="font-semibold">{totals.errorCount}</span> · warnings:{" "}
              <span className="font-semibold">{totals.warningCount}</span>. Export is disabled while
              blocking errors remain.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={copyTxt} disabled={!previewText}>
              <ClipboardCheck className="h-4 w-4" /> Copy
            </Button>
            <Button variant="accent" onClick={downloadTxt} disabled={totals.errorCount > 0}>
              <Download className="h-4 w-4" /> Download .txt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

