"use client";

import * as React from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  Building2,
  CheckCircle2,
  FileWarning,
  Landmark,
  PlayCircle,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";

import { UnsupportedExpenseTracker } from "./expense-tracker";
import { FileDropzone } from "@/components/shared/file-dropzone";
import { KpiCard } from "@/components/shared/kpi-card";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type ReconciliationResult } from "@/lib/reconciliation/types";
import { cn, formatIsoDate, formatRwf } from "@/lib/utils";

type FileKey = "ebmSales" | "ebmPurchases" | "momo" | "bank";
type FileMap = Record<FileKey, File | null>;

interface FileSummary {
  fileName: string;
  count: number;
  warnings: string[];
  issues: Array<{ rowNumber: number; message: string }>;
}

interface MatchResponse {
  result?: ReconciliationResult;
  files?: Record<string, FileSummary>;
  warnings?: string[];
  persisted?: boolean;
  persistedCount?: number;
  error?: string;
}

const SAMPLE_FILES: Record<FileKey, { path: string; name: string }> = {
  ebmSales: { path: "/samples/ebm-sales-sample.csv", name: "EBM_v21_Sales_Export.csv" },
  ebmPurchases: {
    path: "/samples/ebm-purchases-sample.csv",
    name: "EBM_v21_Confirmed_Purchases.csv",
  },
  momo: { path: "/samples/momo-statement-sample.csv", name: "MTN_MoMo_Merchant_Statement.csv" },
  bank: { path: "/samples/bank-statement-sample.csv", name: "BK_Current_Account_Statement.csv" },
};

const EMPTY_FILES: FileMap = { ebmSales: null, ebmPurchases: null, momo: null, bank: null };

const STATUS_META: Record<
  string,
  { label: string; variant: "risk" | "warning" | "valid" | "muted" }
> = {
  UNINVOICED_REVENUE_RISK: { label: "Un-invoiced revenue", variant: "risk" },
  MISSING_EBM_PURCHASE: { label: "Missing EBM purchase", variant: "risk" },
  UNCLAIMED_INPUT_VAT: { label: "Unclaimed input VAT", variant: "warning" },
  MATCHED: { label: "Matched", variant: "valid" },
  UNMATCHED: { label: "Unmatched", variant: "muted" },
};

const DAY_STATUS_LABEL = {
  BALANCED: "Balanced",
  DEPOSITS_EXCEED_SALES: "Deposits > sales",
  SALES_EXCEED_DEPOSITS: "Sales > deposits",
} as const;

function ComparisonTable({
  rows,
  mode,
}: {
  rows: ReconciliationResult["daily"] | ReconciliationResult["weekly"];
  mode: "DAILY" | "WEEKLY";
}) {
  return (
    <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
      <Table>
        <TableHeader className="bg-slate-50/80">
          <TableRow>
            <TableHead>{mode === "DAILY" ? "Date" : "Week"}</TableHead>
            <TableHead className="text-right">EBM sales</TableHead>
            <TableHead className="text-right">Deposits</TableHead>
            <TableHead className="text-right">Variance</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const label =
              "date" in row
                ? formatIsoDate(row.date)
                : `${formatIsoDate(row.weekStart)} – ${formatIsoDate(row.weekEnd)}`;
            const risky = row.status === "DEPOSITS_EXCEED_SALES";
            return (
              <TableRow key={label} className={risky ? "bg-risk-soft/30" : undefined}>
                <TableCell className="text-xs tabular-nums">{label}</TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {formatRwf(row.ebmSalesRwf)}
                </TableCell>
                <TableCell className="text-right text-xs tabular-nums">
                  {formatRwf(row.depositsRwf)}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right text-xs font-semibold tabular-nums",
                    row.varianceRwf > 0 ? "text-risk" : "text-emerald-700",
                  )}
                >
                  {row.varianceRwf === 0 ? "—" : formatRwf(row.varianceRwf)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      row.status === "BALANCED"
                        ? "valid"
                        : row.status === "DEPOSITS_EXCEED_SALES"
                          ? "risk"
                          : "warning"
                    }
                  >
                    {DAY_STATUS_LABEL[row.status]}
                  </Badge>
                </TableCell>
                <TableCell className="text-[11px] text-muted-foreground">
                  {risky
                    ? "Issue missing EBM receipts"
                    : row.status === "SALES_EXCEED_DEPOSITS"
                      ? "Check receipted deposits / settlement timing"
                      : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export function ReconciliationWorkbench() {
  const [files, setFiles] = React.useState<FileMap>(EMPTY_FILES);
  const [periodMonth, setPeriodMonth] = React.useState(new Date().toISOString().slice(0, 7));
  const [dateOrder, setDateOrder] = React.useState<"DMY" | "MDY">("DMY");
  const [dateWindowDays, setDateWindowDays] = React.useState(7);
  const [amountTolerancePct, setAmountTolerancePct] = React.useState(1);
  const [amountToleranceRwf, setAmountToleranceRwf] = React.useState(500);
  const [varianceTolerance, setVarianceTolerance] = React.useState(0);
  const [response, setResponse] = React.useState<MatchResponse | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [view, setView] = React.useState<"DAILY" | "WEEKLY">("DAILY");
  const [tab, setTab] = React.useState<"RISKS" | "MATCHES" | "TIMELINE" | "EXPENSES">("RISKS");

  const result = response?.result ?? null;
  const totals = result?.totals;

  const setFile = (key: FileKey) => (file: File | null) =>
    setFiles((current) => ({ ...current, [key]: file }));

  const runReconciliation = async (override?: Partial<FileMap>) => {
    const active: FileMap = { ...files, ...override };
    if (!active.ebmSales && !active.ebmPurchases && !active.momo && !active.bank) {
      setError("Upload at least one EBM, MoMo or bank statement file.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      if (active.ebmSales) body.set("ebmSales", active.ebmSales);
      if (active.ebmPurchases) body.set("ebmPurchases", active.ebmPurchases);
      if (active.momo) body.set("momoStatement", active.momo);
      if (active.bank) body.set("bankStatement", active.bank);
      body.set("periodMonth", periodMonth);
      body.set("dateOrder", dateOrder);
      body.set(
        "options",
        JSON.stringify({
          dateWindowDays,
          amountTolerancePct: amountTolerancePct / 100,
          amountToleranceRwf,
          revenueVarianceToleranceRwf: varianceTolerance,
        }),
      );

      const http = await fetch("/api/reconciliation/match", { method: "POST", body });
      const payload = (await http.json()) as MatchResponse;
      if (!http.ok) {
        setError(payload.error ?? "Reconciliation failed.");
        setResponse(null);
        return;
      }
      setResponse(payload);
      setTab("RISKS");
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Reconciliation failed.");
      setResponse(null);
    } finally {
      setBusy(false);
    }
  };

  const loadDemo = async () => {
    setBusy(true);
    setError(null);
    try {
      const loaded: FileMap = { ...EMPTY_FILES };
      await Promise.all(
        (Object.keys(SAMPLE_FILES) as FileKey[]).map(async (key) => {
          const sample = SAMPLE_FILES[key];
          const http = await fetch(sample.path);
          if (!http.ok) throw new Error(`Could not load ${sample.name}.`);
          const blob = await http.blob();
          loaded[key] = new File([blob], sample.name, { type: "text/csv" });
        }),
      );
      setFiles(loaded);
      await runReconciliation(loaded);
    } catch (demoError) {
      setError(demoError instanceof Error ? demoError.message : "Could not load the demo set.");
      setBusy(false);
    }
  };



  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        eyebrow="Module 2 · Audit protection"
        title="EBM ↔ MoMo ↔ Bank reconciliation"
        description="Prove that every franc deposited was invoiced and every supplier payment has a confirmed EBM purchase — before you declare VAT on the 15th or CIT on 31 March."
        actions={
          <>
            <Button variant="outline" onClick={() => void loadDemo()} disabled={busy}>
              <Sparkles className="h-4 w-4" /> Load demo set
            </Button>
            <Button variant="accent" onClick={() => void runReconciliation()} disabled={busy}>
              {busy ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <PlayCircle className="h-4 w-4" />
              )}
              Run 3-way match
            </Button>
          </>
        }
      />

      <div className="grid items-stretch gap-3 lg:grid-cols-[1fr_auto_1fr]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Building2 className="h-4 w-4 text-accent" /> EBM v2.1 records
              <Badge variant="muted" className="ml-auto">Left side</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <FileDropzone
              id="ebm-sales"
              compact
              file={files.ebmSales}
              disabled={busy}
              label="EBM Sales CSV"
              hint="Back Office sales export"
              onFile={(file) => setFile("ebmSales")(file)}
              onClear={() => setFile("ebmSales")(null)}
            />
            <FileDropzone
              id="ebm-purchases"
              compact
              file={files.ebmPurchases}
              disabled={busy}
              label="EBM Confirmed Purchases"
              hint="Confirmed supplier invoices"
              onFile={(file) => setFile("ebmPurchases")(file)}
              onClear={() => setFile("ebmPurchases")(null)}
            />
          </CardContent>
        </Card>

        <div className="hidden items-center justify-center lg:flex">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border bg-white shadow-sm">
            <ArrowLeftRight className="h-4 w-4 text-accent" />
          </span>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Wallet className="h-4 w-4 text-accent" /> Money movements
              <Badge variant="muted" className="ml-auto">Right side</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <FileDropzone
              id="momo-statement"
              compact
              file={files.momo}
              disabled={busy}
              label="MTN MoMo / Airtel CSV"
              hint="Merchant collections & payouts"
              onFile={(file) => setFile("momo")(file)}
              onClear={() => setFile("momo")(null)}
            />
            <FileDropzone
              id="bank-statement"
              compact
              file={files.bank}
              disabled={busy}
              label="Bank statement CSV"
              hint="BK · I&M · Equity · BPR"
              onFile={(file) => setFile("bank")(file)}
              onClear={() => setFile("bank")(null)}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-3">
        <CardContent className="grid gap-3 pt-5 sm:grid-cols-2 lg:grid-cols-6">
          <div className="space-y-1">
            <Label htmlFor="recon-period">Tax period</Label>
            <Input
              id="recon-period"
              type="month"
              value={periodMonth}
              onChange={(event) => setPeriodMonth(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="recon-window">Date window (days)</Label>
            <Input
              id="recon-window"
              type="number"
              min={0}
              max={45}
              value={dateWindowDays}
              onChange={(event) => setDateWindowDays(Number(event.target.value) || 0)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="recon-pct">Amount tolerance (%)</Label>
            <Input
              id="recon-pct"
              type="number"
              min={0}
              max={20}
              step={0.5}
              value={amountTolerancePct}
              onChange={(event) => setAmountTolerancePct(Number(event.target.value) || 0)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="recon-rwf">Amount floor (RWF)</Label>
            <Input
              id="recon-rwf"
              type="number"
              min={0}
              value={amountToleranceRwf}
              onChange={(event) => setAmountToleranceRwf(Number(event.target.value) || 0)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="recon-variance">Variance threshold</Label>
            <Input
              id="recon-variance"
              type="number"
              min={0}
              value={varianceTolerance}
              onChange={(event) => setVarianceTolerance(Number(event.target.value) || 0)}
            />
          </div>
          <div className="space-y-1">
            <Label>Ambiguous dates</Label>

            <Select
              value={dateOrder}
              onValueChange={(value) => setDateOrder(value as "DMY" | "MDY")}
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
        </CardContent>
      </Card>
      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-risk-soft px-4 py-3 text-sm text-rose-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="flex-1 text-xs">{error}</p>
          <button type="button" className="text-xs underline" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}
      {result && totals ? (
        <>
          {result.warnings.length > 0 && (
            <ul className="mt-4 space-y-1 rounded-lg border border-amber-200 bg-warning-soft/70 p-3 text-[11px] text-amber-900">
              {result.warnings.map((warning) => (
                <li key={warning} className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {warning}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <KpiCard
              label="Total EBM sales"
              value={formatRwf(totals.ebmSalesRwf)}
              hint={`${totals.ebmSalesCount} EBM receipt(s)`}
              icon={TrendingUp}
            />
            <KpiCard
              label="MoMo + bank inflows"
              value={formatRwf(totals.depositsRwf)}
              hint={`${totals.depositCount} deposits · MoMo ${result.sources.momo} / bank ${result.sources.bank}`}
              icon={Smartphone}
              tone="valid"
            />
            <KpiCard
              label="Un-invoiced variance"
              value={formatRwf(totals.uninvoicedVarianceRwf)}
              hint={`Day-level risk ${formatRwf(totals.dailyRiskRwf)} · deposits − EBM sales`}
              icon={ShieldAlert}
              tone={totals.uninvoicedVarianceRwf > 0 ? "risk" : "valid"}
            />
            <KpiCard
              label="Unclaimed input VAT"
              value={formatRwf(totals.unclaimedInputVatRwf)}
              hint={`${totals.unclaimedPurchaseCount} EBM purchase(s) without a payout match`}
              icon={FileWarning}
              tone={totals.unclaimedInputVatRwf > 0 ? "warning" : "valid"}
            />
            <KpiCard
              label="Missing EBM purchases"
              value={formatRwf(totals.missingPurchasePaymentRwf)}
              hint={`${totals.missingPurchaseCount} payout(s) · est. VAT ${formatRwf(totals.missingInputVatRwf)}`}
              icon={AlertTriangle}
              tone={totals.missingPurchaseCount > 0 ? "risk" : "valid"}
            />
            <KpiCard
              label="Payout match rate"
              value={`${totals.matchRatePct}%`}
              hint={`${totals.matchedCount}/${totals.payoutCount} payments matched`}
              icon={CheckCircle2}
              tone={totals.matchRatePct >= 90 ? "valid" : "gold"}
            />
          </div>

          <div className="mt-5">
            <Tabs value={tab} onValueChange={(value) => setTab(value as typeof tab)}>
              <TabsList className="h-auto flex-wrap">
                <TabsTrigger value="RISKS">
                  Risk register
                  <Badge variant="risk" className="ml-1.5 px-1.5 py-0 text-[10px]">
                    {result.risks.filter((risk) => risk.matchStatus !== "UNCLAIMED_INPUT_VAT").length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="MATCHES">
                  Matched purchases
                  <Badge variant="valid" className="ml-1.5 px-1.5 py-0 text-[10px]">
                    {result.matchedPurchases.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="TIMELINE">
                  Daily / weekly
                  <Badge variant="muted" className="ml-1.5 px-1.5 py-0 text-[10px]">
                    {result.daily.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="EXPENSES">Unsupported expenses</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {tab === "RISKS" && (
            <div className="mt-3 overflow-hidden rounded-xl border bg-white shadow-sm">
              <Table>
                <TableHeader className="bg-slate-50/80">
                  <TableRow>
                    <TableHead>Risk</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Counterparty</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead className="text-right">Amount (RWF)</TableHead>
                    <TableHead>Why it matters</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.risks.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-10 text-center text-xs text-muted-foreground"
                      >
                        No audit risks detected for {periodMonth}. Deposits reconcile to EBM sales
                        and every payout has a confirmed purchase.
                      </TableCell>
                    </TableRow>
                  ) : (
                    result.risks
                      .slice()
                      .sort((a, b) => {
                        const order = {
                          UNINVOICED_REVENUE_RISK: 0,
                          MISSING_EBM_PURCHASE: 1,
                          UNCLAIMED_INPUT_VAT: 2,
                        };
                        return order[a.matchStatus] - order[b.matchStatus];
                      })
                      .map((risk) => {
                        const meta = STATUS_META[risk.matchStatus] ?? STATUS_META.UNMATCHED;
                        return (
                          <TableRow key={`${risk.matchStatus}-${risk.referenceNo}-${risk.txDate}`}>
                            <TableCell className="align-top">
                              <Badge variant={meta?.variant ?? "muted"}>{meta?.label}</Badge>
                            </TableCell>
                            <TableCell className="align-top text-xs tabular-nums">
                              {formatIsoDate(risk.txDate)}
                            </TableCell>
                            <TableCell className="align-top text-xs">
                              <span className="font-medium text-navy">
                                {risk.counterparty || "—"}
                              </span>
                              {risk.counterpartyTin && (
                                <span className="block font-mono text-[10px] text-muted-foreground">
                                  TIN {risk.counterpartyTin}
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="align-top font-mono text-[11px]">
                              {risk.referenceNo}
                            </TableCell>
                            <TableCell className="align-top text-right text-xs font-semibold tabular-nums text-navy">
                              {formatRwf(risk.amountRwf)}
                            </TableCell>
                            <TableCell className="max-w-[360px] align-top text-[11px] leading-relaxed text-muted-foreground">
                              {risk.notes}
                            </TableCell>
                          </TableRow>
                        );
                      })
                  )}
                </TableBody>
              </Table>
            </div>
          )}



          {tab === "MATCHES" && (
            <div className="mt-3 space-y-4">
              <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
                <Table>
                  <TableHeader className="bg-slate-50/80">
                    <TableRow>
                      <TableHead>Payout</TableHead>
                      <TableHead>EBM invoice</TableHead>
                      <TableHead className="text-right">Payout (RWF)</TableHead>
                      <TableHead className="text-right">Invoice (RWF)</TableHead>
                      <TableHead className="text-right">Gap</TableHead>
                      <TableHead className="text-right">Days</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.matchedPurchases.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={7}
                          className="py-10 text-center text-xs text-muted-foreground"
                        >
                          No supplier payments could be matched to confirmed EBM purchases.
                        </TableCell>
                      </TableRow>
                    ) : (
                      result.matchedPurchases.map((pair) => (
                        <TableRow key={`${pair.payout.id}-${pair.purchase.id}`}>
                          <TableCell className="text-xs">
                            <span className="font-medium text-navy">
                              {pair.payout.counterparty}
                            </span>
                            <span className="block text-[11px] text-muted-foreground">
                              {formatIsoDate(pair.payout.txDate)} · {pair.payout.referenceNo}
                            </span>
                          </TableCell>
                          <TableCell className="text-xs">
                            <span className="font-medium text-navy">
                              {pair.purchase.counterparty}
                            </span>
                            <span className="block font-mono text-[11px] text-muted-foreground">
                              {pair.purchase.referenceNo} · {formatIsoDate(pair.purchase.txDate)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {formatRwf(pair.payout.amountRwf)}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {formatRwf(pair.purchase.amountRwf)}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right text-xs tabular-nums",
                              pair.amountGapRwf > 0 ? "text-warning" : "text-emerald-700",
                            )}
                          >
                            {pair.amountGapRwf === 0 ? "exact" : formatRwf(pair.amountGapRwf)}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {pair.dayGap}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge variant={pair.score >= 80 ? "valid" : "warning"}>
                              {pair.score}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="rounded-xl border border-amber-200 bg-warning-soft/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-navy">
                    Confirmed EBM purchases without a payout
                  </h3>
                  <span className="text-xs text-amber-900">
                    Claimable input VAT{" "}
                    <span className="font-semibold tabular-nums">
                      {formatRwf(totals.unclaimedInputVatRwf)}
                    </span>
                  </span>
                </div>
                {result.unclaimedPurchases.length === 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Every confirmed purchase has a matching payment.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Supplier</TableHead>
                        <TableHead>Invoice</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Gross (RWF)</TableHead>
                        <TableHead className="text-right">Input VAT</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.unclaimedPurchases.map((purchase) => (
                        <TableRow key={purchase.id}>
                          <TableCell className="text-xs font-medium text-navy">
                            {purchase.counterparty}
                          </TableCell>
                          <TableCell className="font-mono text-[11px]">
                            {purchase.referenceNo}
                          </TableCell>
                          <TableCell className="text-xs tabular-nums">
                            {formatIsoDate(purchase.txDate)}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums">
                            {formatRwf(purchase.amountRwf)}
                          </TableCell>
                          <TableCell className="text-right text-xs font-semibold tabular-nums text-amber-900">
                            {formatRwf(purchase.vatRwf)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          )}


          {tab === "TIMELINE" && (
            <div className="mt-3">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  MoMo Pay + bank POS deposits aggregated by{" "}
                  {view === "DAILY" ? "day" : "ISO week (Monday–Sunday)"} and compared with EBM
                  sales.
                </p>
                <Tabs value={view} onValueChange={(value) => setView(value as "DAILY" | "WEEKLY")}>
                  <TabsList>
                    <TabsTrigger value="DAILY">Daily</TabsTrigger>
                    <TabsTrigger value="WEEKLY">Weekly</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
              <ComparisonTable
                rows={view === "DAILY" ? result.daily : result.weekly}
                mode={view}
              />
            </div>
          )}

          {tab === "EXPENSES" && (
            <div className="mt-3">
              <UnsupportedExpenseTracker />
            </div>
          )}
        </>
      ) : (
        <Card className="mt-5">
          <CardContent className="grid gap-4 pt-6 md:grid-cols-3">
            <div className="space-y-1">
              <ShieldAlert className="h-5 w-5 text-risk" />
              <p className="text-sm font-semibold text-navy">Un-invoiced revenue</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                MoMo Pay + bank POS deposits must not exceed EBM receipts. Every excess franc becomes
                an audit-risk row with the exact RWF gap before the 15th.
              </p>
            </div>
            <div className="space-y-1">
              <Landmark className="h-5 w-5 text-warning" />
              <p className="text-sm font-semibold text-navy">Missing input VAT</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Supplier payouts are matched to confirmed EBM purchases by TIN, name, amount and date
                window. Unmatched invoices expose claimable VAT you would otherwise leave behind.
              </p>
            </div>
            <div className="space-y-1">
              <ArrowRight className="h-5 w-5 text-accent" />
              <p className="text-sm font-semibold text-navy">Ready to reconcile</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Drop at least one EBM and one money statement, or load the demo set. Matching runs
                server-side; with Supabase configured the audit trail persists to
                reconciliation_items.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

