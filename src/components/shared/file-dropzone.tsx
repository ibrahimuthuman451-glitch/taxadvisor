"use client";

import * as React from "react";
import { FileSpreadsheet, UploadCloud, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function FileDropzone({
  id,
  label,
  hint,
  accept = ".xlsx,.xls,.csv",
  file,
  onFile,
  onClear,
  disabled,
  compact,
  loading,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  accept?: string;
  file: File | null;
  onFile: (file: File) => void;
  onClear?: () => void;
  disabled?: boolean;
  compact?: boolean;
  loading?: boolean;
  className?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const dragDepth = React.useRef(0);

  const handleFiles = (files: FileList | null) => {
    const next = files?.[0];
    if (next) onFile(next);
  };

  return (
    <div
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        if (!disabled) setDragging(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) {
          dragDepth.current = 0;
          setDragging(false);
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        if (disabled) return;
        handleFiles(event.dataTransfer.files);
      }}
      className={cn(
        "relative rounded-xl border-2 border-dashed transition-colors",
        compact ? "p-4" : "p-6",
        dragging ? "border-accent bg-emerald-50/60" : "border-slate-300 bg-white",
        disabled && "opacity-60",
        className,
      )}
    >
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = "";
        }}
      />

      {file ? (
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
            <FileSpreadsheet className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-navy">{file.name}</p>
            <p className="text-xs text-muted-foreground">
              {(file.size / 1024).toFixed(1)} KB ·{" "}
              {loading ? "Parsing & normalizing…" : "Ready for validation"}
            </p>
          </div>
          {onClear && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove file"
              onClick={() => {
                onClear();
                inputRef.current?.focus();
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center gap-2 text-center"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-muted-foreground">
            <UploadCloud className="h-5 w-5" />
          </span>
          <span className="text-sm font-medium text-navy">{label}</span>
          {hint && <span className="max-w-md text-xs leading-relaxed text-muted-foreground">{hint}</span>}
          <span className="text-[11px] font-semibold uppercase tracking-wide text-accent">
            Browse or drop file
          </span>
        </button>
      )}
    </div>
  );
}
