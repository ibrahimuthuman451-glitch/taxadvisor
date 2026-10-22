"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowRightLeft,
  CalendarClock,
  FileSpreadsheet,
  LayoutGrid,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { cn, daysUntil, declarationDeadline } from "@/lib/utils";

const NAV_ITEMS = [
  {
    href: "/",
    label: "Practice Hub",
    description: "Client pipeline & WhatsApp",
    icon: LayoutGrid,
  },
  {
    href: "/annexure",
    label: "Annexure Sanitizer",
    description: "RRA .txt generator",
    icon: FileSpreadsheet,
  },
  {
    href: "/reconciliation",
    label: "Reconciliation",
    description: "EBM vs MoMo & bank",
    icon: ArrowRightLeft,
  },
] as const;

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-700 text-white shadow-inner">
        <ShieldCheck className="h-5 w-5" />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold tracking-wide text-white">TaxOps Rwanda</span>
        <span className="block text-[11px] font-medium uppercase tracking-[0.18em] text-emerald-300/80">
          Tax operations
        </span>
      </span>
    </Link>
  );
}

function DeadlineCard() {
  const period = currentPeriod();
  const deadline = declarationDeadline(period);
  const remaining = daysUntil(deadline);
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
        <CalendarClock className="h-3.5 w-3.5" />
        {period} filing window
      </div>
      <p className="mt-1.5 text-sm font-semibold text-white">
        {remaining >= 0 ? `${remaining} days to the 15th` : "Deadline passed"}
      </p>
      <p className="text-[11px] text-slate-400">VAT · WHT · PAYE due {deadline.split("-").reverse().join("/")}</p>
    </div>
  );
}

function FirmCard() {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Workspace</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-white">Kigali Tax Partners</p>
          <p className="truncate text-[11px] text-slate-400">TIN 102 345 678 · PRACTICE</p>
        </div>
        <span className="rounded-md border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[10px] font-semibold text-gold">
          ADMIN
        </span>
      </div>
    </div>
  );
}

function NavList({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  return (
    <nav className={cn("flex flex-col gap-1", compact && "flex-row gap-1")}>
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href;
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
              compact && "flex-1 justify-center px-2 py-2",
              active
                ? "bg-white/10 text-white"
                : "text-slate-300 hover:bg-white/5 hover:text-white",
            )}
            title={compact ? item.label : undefined}
          >
            <Icon
              className={cn(
                "h-4 w-4 shrink-0",
                active ? "text-emerald-300" : "text-slate-400 group-hover:text-slate-200",
              )}
            />
            {!compact && (
              <span className="min-w-0">
                <span className="block truncate font-medium">{item.label}</span>
                <span className="block truncate text-[11px] text-slate-400">
                  {item.description}
                </span>
              </span>
            )}
            {active && !compact && (
              <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-emerald-400" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-screen w-[268px] shrink-0 flex-col justify-between bg-navy px-4 py-6 lg:flex">
      <div className="space-y-7">
        <Brand />
        <NavList />
        <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-300">
            <Sparkles className="h-3.5 w-3.5" /> E-Tax ready
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-300">
            Exports are headerless, tab-delimited and RWF-integer safe — no Excel macros required.
          </p>
        </div>
      </div>
      <div className="space-y-2">
        <DeadlineCard />
        <FirmCard />
      </div>
    </aside>
  );
}

export function MobileNav() {
  return (
    <header className="sticky top-0 z-40 bg-navy px-4 py-3 lg:hidden">
      <div className="flex items-center justify-between">
        <Brand />
        <span className="rounded-md border border-gold/40 bg-gold/10 px-2 py-0.5 text-[10px] font-semibold text-gold">
          ADMIN
        </span>
      </div>
      <div className="mt-3">
        <NavList compact />
      </div>
    </header>
  );
}
