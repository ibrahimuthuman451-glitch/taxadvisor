import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

const TONES = {
  navy: "border-slate-200 bg-white",
  valid: "border-emerald-200 bg-valid-soft/60",
  warning: "border-amber-200 bg-warning-soft/70",
  risk: "border-rose-200 bg-risk-soft/70",
  gold: "border-amber-200/70 bg-gold-soft/70",
} as const;

const ICON_TONES = {
  navy: "bg-navy/5 text-navy",
  valid: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-700",
  risk: "bg-rose-100 text-rose-700",
  gold: "bg-amber-100 text-amber-800",
} as const;

export function KpiCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "navy",
  valueClassName,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: LucideIcon;
  tone?: keyof typeof TONES;
  valueClassName?: string;
}) {
  return (
    <div className={cn("rounded-xl border p-4 shadow-sm", TONES[tone])}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        {Icon && (
          <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg", ICON_TONES[tone])}>
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <p className={cn("mt-2 text-xl font-semibold tracking-tight tabular-nums text-navy", valueClassName)}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}
