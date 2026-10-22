"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, CircleAlert, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ANNEXURE_FORMATS } from "@/lib/annexure/annexure-config";
import type {
  AnnexureType,
  AnnexureValidationOptions,
  CanonicalField,
  ValidatedAnnexureRow,
} from "@/lib/annexure/types";
import { cn, formatIsoDate } from "@/lib/utils";

export type EditableField =
  | "invoiceNo"
  | "invoiceDate"
  | "counterpartyTin"
  | "counterpartyName"
  | "taxableAmountRwf"
  | "vatAmountRwf"
  | "mrcCode"
  | "whtRate"
  | "currency";

const NUMERIC_FIELDS: EditableField[] = ["taxableAmountRwf", "vatAmountRwf", "whtRate"];

function displayValue(value: string | number | null, field: EditableField): string {
  if (value === null || value === undefined) return "";
  if (field === "invoiceDate") return formatIsoDate(String(value));
  return String(value);
}

function EditableCell({
  value,
  field,
  onCommit,
  align = "left",
  mono = false,
  placeholder,
  invalid,
  warning,
  ariaLabel,
}: {
  value: string | number | null;
  field: EditableField;
  onCommit: (next: string) => void;
  align?: "left" | "right";
  mono?: boolean;
  placeholder?: string;
  invalid?: boolean;
  warning?: boolean;
  ariaLabel: string;
}) {
  const [draft, setDraft] = React.useState(displayValue(value, field));

  React.useEffect(() => {
    setDraft(displayValue(value, field));
  }, [value, field]);

  const commit = () => {
    if (draft !== displayValue(value, field)) onCommit(draft);
  };

  return (
    <input
      aria-label={ariaLabel}
      value={draft}
      inputMode={NUMERIC_FIELDS.includes(field) ? "numeric" : "text"}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(displayValue(value, field));
          event.currentTarget.blur();
        }
      }}
      className={cn(
        "cell-input",
        mono && "font-mono text-[12.5px]",
        align === "right" && "text-right tabular-nums",
        invalid && "cell-input-error",
        !invalid && warning && "cell-input-warning",
      )}
    />
  );
}

function StatusBadge({ status }: { status: ValidatedAnnexureRow["status"] }) {
  if (status === "VALID") {
    return (
      <Badge variant="valid">
        <CheckCircle2 className="h-3 w-3" /> Valid
      </Badge>
    );
  }
  if (status === "WARNING") {
    return (
      <Badge variant="warning">
        <AlertTriangle className="h-3 w-3" /> Warning
      </Badge>
    );
  }
  return (
    <Badge variant="risk">
      <CircleAlert className="h-3 w-3" /> Error
    </Badge>
  );
}

export function EditableAnnexureGrid({
  rows,
  type,
  options,
  onUpdate,
  onDelete,
  onAddRow,
}: {
  rows: ValidatedAnnexureRow[];
  type: AnnexureType;
  options: AnnexureValidationOptions;
  onUpdate: (id: string, field: EditableField, raw: string) => void;
  onDelete: (id: string) => void;
  onAddRow: () => void;
}) {
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const format = ANNEXURE_FORMATS[type];
  const showMrc = format.fields.some((field) => field.key === "mrcCode");
  const showRate = type === "WHT";
  const showCurrency = type === "IMPORTS";
  const columnCount = 10 + (showRate ? 1 : 0) + (showMrc ? 1 : 0) + (showCurrency ? 1 : 0);

  const fieldIssue = (row: ValidatedAnnexureRow, field: CanonicalField) =>
    row.issues.find((entry) => entry.field === field);
  const invalid = (row: ValidatedAnnexureRow, field: CanonicalField) =>
    fieldIssue(row, field)?.severity === "ERROR";
  const warn = (row: ValidatedAnnexureRow, field: CanonicalField) =>
    fieldIssue(row, field)?.severity === "WARNING";

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border bg-white px-6 py-12 text-center">
        <p className="text-sm font-medium text-navy">No rows yet</p>
        <p className="max-w-md text-xs text-muted-foreground">
          Upload an export, then edit any cell inline. Invalid TINs, dates, MRC codes and 18% VAT
          gaps are flagged as you type — nothing is uploaded to RRA.
        </p>
        <Button variant="outline" size="sm" onClick={onAddRow}>
          <Plus className="h-4 w-4" /> Add a row manually
        </Button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
      <Table>
        <TableHeader className="bg-slate-50/80">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-10 pl-4">#</TableHead>
            <TableHead className="w-[104px]">State</TableHead>
            <TableHead className="min-w-[150px]">Invoice No</TableHead>
            <TableHead className="min-w-[118px]">Date</TableHead>
            <TableHead className="min-w-[124px]">TIN</TableHead>
            <TableHead className="min-w-[200px]">Name</TableHead>
            <TableHead className="min-w-[130px] text-right">Taxable (RWF)</TableHead>
            <TableHead className="min-w-[120px] text-right">{format.taxLabel}</TableHead>
            {showRate && <TableHead className="w-[86px] text-right">Rate %</TableHead>}
            {showMrc && <TableHead className="min-w-[170px]">MRC</TableHead>}
            {showCurrency && <TableHead className="w-[90px]">Cur.</TableHead>}
            <TableHead className="min-w-[190px]">Issues</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>


          {rows.map((row) => {
            const expanded = expandedId === row.id;
            const rowTint =
              row.status === "ERROR"
                ? "bg-risk-soft/30 hover:bg-risk-soft/50"
                : row.status === "WARNING"
                  ? "bg-warning-soft/30 hover:bg-warning-soft/50"
                  : "hover:bg-emerald-50/30";
            return (
              <React.Fragment key={row.id}>
                <TableRow className={cn("group align-top", rowTint)}>
                  <TableCell className="pl-4 pt-3 text-xs tabular-nums text-muted-foreground">
                    {row.rowNumber}
                  </TableCell>
                  <TableCell className="pt-2">
                    <StatusBadge status={row.status} />
                  </TableCell>
                  <TableCell className="py-1">
                    <EditableCell
                      ariaLabel={`Invoice number, row ${row.rowNumber}`}
                      value={row.invoiceNo}
                      field="invoiceNo"
                      mono
                      placeholder="SDC.../0001"
                      invalid={invalid(row, "invoiceNo")}
                      warning={warn(row, "invoiceNo")}
                      onCommit={(next) => onUpdate(row.id, "invoiceNo", next)}
                    />
                  </TableCell>
                  <TableCell className="py-1">
                    <EditableCell
                      ariaLabel={`Invoice date, row ${row.rowNumber}`}
                      value={row.invoiceDate}
                      field="invoiceDate"
                      placeholder="DD/MM/YYYY"
                      invalid={invalid(row, "invoiceDate")}
                      warning={warn(row, "invoiceDate")}
                      onCommit={(next) => onUpdate(row.id, "invoiceDate", next)}
                    />
                  </TableCell>
                  <TableCell className="py-1">
                    <EditableCell
                      ariaLabel={`TIN, row ${row.rowNumber}`}
                      value={row.counterpartyTin}
                      field="counterpartyTin"
                      mono
                      placeholder="102345678"
                      invalid={invalid(row, "counterpartyTin")}
                      warning={warn(row, "counterpartyTin")}
                      onCommit={(next) => onUpdate(row.id, "counterpartyTin", next)}
                    />
                  </TableCell>
                  <TableCell className="py-1">
                    <EditableCell
                      ariaLabel={`Name, row ${row.rowNumber}`}
                      value={row.counterpartyName}
                      field="counterpartyName"
                      invalid={invalid(row, "counterpartyName")}
                      warning={warn(row, "counterpartyName")}
                      onCommit={(next) => onUpdate(row.id, "counterpartyName", next)}
                    />
                  </TableCell>
                  <TableCell className="py-1">
                    <EditableCell
                      ariaLabel={`Taxable amount, row ${row.rowNumber}`}
                      value={row.taxableAmountRwf}
                      field="taxableAmountRwf"
                      align="right"
                      placeholder="0"
                      invalid={invalid(row, "taxableAmountRwf")}
                      warning={warn(row, "taxableAmountRwf")}
                      onCommit={(next) => onUpdate(row.id, "taxableAmountRwf", next)}
                    />
                  </TableCell>
                  <TableCell className="py-1">
                    <EditableCell
                      ariaLabel={`${format.taxLabel}, row ${row.rowNumber}`}
                      value={row.vatAmountRwf}
                      field="vatAmountRwf"
                      align="right"
                      placeholder="0"
                      invalid={invalid(row, "vatAmountRwf")}
                      warning={warn(row, "vatAmountRwf")}
                      onCommit={(next) => onUpdate(row.id, "vatAmountRwf", next)}
                    />
                  </TableCell>
                  {showRate && (
                    <TableCell className="py-1">
                      <EditableCell
                        ariaLabel={`WHT rate, row ${row.rowNumber}`}
                        value={row.whtRate}
                        field="whtRate"
                        align="right"
                        placeholder="15"
                        invalid={invalid(row, "whtRate")}
                        warning={warn(row, "whtRate")}
                        onCommit={(next) => onUpdate(row.id, "whtRate", next)}
                      />
                    </TableCell>
                  )}
                  {showMrc && (
                    <TableCell className="py-1">
                      <EditableCell
                        ariaLabel={`MRC code, row ${row.rowNumber}`}
                        value={row.mrcCode}
                        field="mrcCode"
                        mono
                        placeholder="SDC0010000123/0001"
                        invalid={invalid(row, "mrcCode")}
                        warning={warn(row, "mrcCode")}
                        onCommit={(next) => onUpdate(row.id, "mrcCode", next)}
                      />
                    </TableCell>
                  )}
                  {showCurrency && (
                    <TableCell className="py-1">
                      <EditableCell
                        ariaLabel={`Currency, row ${row.rowNumber}`}
                        value={row.currency}
                        field="currency"
                        placeholder="RWF"
                        invalid={invalid(row, "currency")}
                        warning={warn(row, "currency")}
                        onCommit={(next) => onUpdate(row.id, "currency", next)}
                      />
                    </TableCell>
                  )}
                  <TableCell className="pt-3">
                    {row.issues.length === 0 ? (
                      <span className="text-xs text-emerald-700">RRA-ready</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : row.id)}
                        className="text-left text-xs font-medium text-navy underline decoration-dotted underline-offset-2 hover:text-accent"
                      >
                        {row.issues.length} issue{row.issues.length === 1 ? "" : "s"} —{" "}
                        {expanded ? "hide" : "review"}
                      </button>
                    )}
                    {!expanded && row.issues.length > 0 && (
                      <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                        {row.issues[0]?.message}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="pt-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-slate-400 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      aria-label={`Delete row ${row.rowNumber}`}
                      onClick={() => onDelete(row.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
                {expanded && (
                  <TableRow className={cn("border-b-0 hover:bg-transparent", rowTint)}>
                    <TableCell colSpan={columnCount} className="px-6 pb-4 pt-0">
                      <ul className="space-y-1.5 rounded-lg border bg-white p-3">
                        {row.issues.map((entry, index) => (
                          <li
                            key={`${entry.code}-${index}`}
                            className="flex items-start gap-2 text-xs"
                          >
                            {entry.severity === "ERROR" ? (
                              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-risk" />
                            ) : (
                              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                            )}
                            <span>
                              <span className="font-mono text-[10.5px] font-semibold uppercase text-muted-foreground">
                                {entry.code}
                              </span>{" "}
                              <span className="text-navy">{entry.message}</span>
                              {entry.autoFixable && (
                                <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-800">
                                  auto-fixable
                                </span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-slate-50/70 px-4 py-2.5">
        <p className="text-[11px] text-muted-foreground">
          Edits stay local until you export. Dates normalize to{" "}
          <span className="font-mono">DD/MM/YYYY</span> · period{" "}
          <span className="font-mono">{options.periodMonth ?? "any"}</span>
        </p>
        <Button variant="ghost" size="sm" onClick={onAddRow}>
          <Plus className="h-4 w-4" /> Add row
        </Button>
      </div>
    </div>
  );
}

