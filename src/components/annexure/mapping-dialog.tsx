"use client";

import * as React from "react";
import { AlertTriangle, Columns3 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ANNEXURE_FORMATS } from "@/lib/annexure/annexure-config";
import type { AnnexureType, CanonicalField, ColumnMapping } from "@/lib/annexure/types";

const IGNORE = "__ignore__";

export function MappingDialog({
  open,
  onOpenChange,
  headers,
  mapping,
  type,
  busy,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  headers: string[];
  mapping: ColumnMapping;
  type: AnnexureType;
  busy?: boolean;
  onApply: (mapping: ColumnMapping) => void;
}) {
  const [draft, setDraft] = React.useState<ColumnMapping>(mapping);

  React.useEffect(() => {
    if (open) setDraft(mapping);
  }, [open, mapping]);

  const format = ANNEXURE_FORMATS[type];
  const assigned = new Set(Object.values(draft).filter(Boolean) as CanonicalField[]);
  const missing = format.fields.filter((field) => field.required && !assigned.has(field.key));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Columns3 className="h-4 w-4 text-accent" /> Map source columns
          </DialogTitle>
          <DialogDescription>
            Detected headers from your file. Point each column at an RRA annexure field; unmatched
            columns are ignored. Re-parsing keeps your raw values intact.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[52vh] space-y-1.5 overflow-y-auto pr-1 scrollbar-thin">
          {headers.map((header) => {
            const value = draft[header] ?? null;
            return (
              <div
                key={header}
                className="flex items-center gap-3 rounded-lg border bg-slate-50/50 px-3 py-2"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-navy" title={header}>
                  {header}
                </span>
                <Select
                  value={value ?? IGNORE}
                  onValueChange={(next) =>
                    setDraft((current) => ({
                      ...current,
                      [header]: next === IGNORE ? null : (next as CanonicalField),
                    }))
                  }
                >
                  <SelectTrigger className="h-8 w-[240px] bg-white text-xs">
                    <SelectValue placeholder="Ignore column" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={IGNORE}>Ignore column</SelectItem>
                    {format.fields.map((field) => (
                      <SelectItem key={field.key} value={field.key}>
                        {field.label}
                        {field.required ? " *" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>

        {missing.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-warning-soft p-3 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Required field{missing.length === 1 ? "" : "s"} unmapped:{" "}
              <span className="font-semibold">{missing.map((field) => field.label).join(", ")}</span>
              . Rows will fail validation until these columns are mapped.
            </span>
          </div>
        )}

        <DialogFooter>
          <Badge variant="muted">{headers.length} columns</Badge>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="accent" onClick={() => onApply(draft)} disabled={busy}>
            {busy ? "Re-parsing…" : "Apply mapping"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
