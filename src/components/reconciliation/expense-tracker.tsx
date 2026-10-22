"use client";

import * as React from "react";
import { AlertTriangle, Download, Plus, ReceiptText, Trash2 } from "lucide-react";

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
import {
  EXPENSE_CATEGORIES,
  buildUnsupportedExpense,
  summarizeExpenses,
  type ExpenseCategory,
  type UnsupportedExpense,
} from "@/lib/reconciliation/expenses";
import { formatIsoDate, formatRwf } from "@/lib/utils";

const STORAGE_KEY = "taxops.unsupported_expenses.v1";

interface DraftExpense {
  expenseDate: string;
  category: ExpenseCategory;
  vendorName: string;
  amountRwf: string;
  description: string;
}

const EMPTY_DRAFT: DraftExpense = {
  expenseDate: new Date().toISOString().slice(0, 10),
  category: "RENT_INDIVIDUAL",
  vendorName: "",
  amountRwf: "",
  description: "",
};

export function UnsupportedExpenseTracker() {
  const [expenses, setExpenses] = React.useState<UnsupportedExpense[]>([]);
  const [draft, setDraft] = React.useState<DraftExpense>(EMPTY_DRAFT);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setExpenses(JSON.parse(stored) as UnsupportedExpense[]);
    } catch {
      // ignore corrupt storage
    }
  }, []);

  const persist = (next: UnsupportedExpense[]) => {
    setExpenses(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // storage may be disabled — keep in-memory
    }
  };

  const addExpense = () => {
    const amount = Number(draft.amountRwf.replace(/[^\d.]/g, ""));
    if (!draft.vendorName.trim()) {
      setError("Vendor name is required so the expense survives an audit.");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a positive RWF amount.");
      return;
    }
    setError(null);
    const next = buildUnsupportedExpense({
      id: `exp-${Date.now()}`,
      expenseDate: draft.expenseDate,
      category: draft.category,
      vendorName: draft.vendorName.trim(),
      amountRwf: amount,
      description: draft.description.trim(),
    });
    persist([next, ...expenses]);
    setDraft({ ...EMPTY_DRAFT, category: draft.category, expenseDate: draft.expenseDate });
  };

  const remove = (id: string) => persist(expenses.filter((expense) => expense.id !== id));

  const exportCsv = () => {
    const header =
      "expense_date,category,vendor_name,description,amount_rwf,wht_rate,wht_amount_rwf,wht_required";
    const lines = expenses.map((expense) =>
      [
        expense.expenseDate,
        expense.category,
        `"${expense.vendorName.replace(/"/g, '""')}"`,
        `"${expense.description.replace(/"/g, '""')}"`,
        expense.amountRwf,
        expense.whtRate,
        expense.whtAmountRwf,
        expense.whtRequired ? "YES" : "NO",
      ].join(","),
    );
    const blob = new Blob([[header, ...lines].join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `unsupported_expenses_${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const summary = summarizeExpenses(expenses);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0 pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-sm">
            <ReceiptText className="h-4 w-4 text-accent" /> Unsupported expense tracker
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Non-EBM costs (individual rent, casual labour, local transport) with a 15% / 3% WHT
            flag so they are not disallowed during a CIT audit.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={expenses.length === 0}>
          <Download className="h-4 w-4" /> CSV
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2 rounded-lg border bg-slate-50/60 p-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="space-y-1">
            <Label htmlFor="expense-date">Date</Label>
            <Input
              id="expense-date"
              type="date"
              value={draft.expenseDate}
              onChange={(event) => setDraft({ ...draft, expenseDate: event.target.value })}
            />
          </div>
          <div className="space-y-1 lg:col-span-2">
            <Label>Category</Label>
            <Select
              value={draft.category}
              onValueChange={(value) => setDraft({ ...draft, category: value as ExpenseCategory })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPENSE_CATEGORIES.map((category) => (
                  <SelectItem key={category.value} value={category.value}>
                    {category.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="expense-vendor">Vendor</Label>
            <Input
              id="expense-vendor"
              value={draft.vendorName}
              placeholder="e.g. Jean Bosco Habimana"
              onChange={(event) => setDraft({ ...draft, vendorName: event.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="expense-amount">Amount (RWF)</Label>
            <Input
              id="expense-amount"
              inputMode="numeric"
              value={draft.amountRwf}
              placeholder="400000"
              onChange={(event) => setDraft({ ...draft, amountRwf: event.target.value })}
            />
          </div>
          <div className="flex items-end">
            <Button variant="accent" size="sm" className="w-full" onClick={addExpense}>
              <Plus className="h-4 w-4" /> Log
            </Button>
          </div>
          <div className="space-y-1 sm:col-span-2 lg:col-span-6">
            <Label htmlFor="expense-note">Description / justification</Label>
            <Input
              id="expense-note"
              value={draft.description}
              placeholder="Why is this deductible? e.g. monthly rent — landlord has no EBM device"
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
          </div>
        </div>

        {error && <p className="text-xs font-medium text-risk">{error}</p>}

        <div className="flex flex-wrap gap-3 text-xs">
          <span className="rounded-lg border bg-white px-3 py-1.5">
            Logged <span className="font-semibold tabular-nums">{formatRwf(summary.totalRwf)}</span>
          </span>
          <span className="rounded-lg border border-amber-200 bg-warning-soft px-3 py-1.5 text-amber-900">
            WHT due <span className="font-semibold tabular-nums">{formatRwf(summary.whtDueRwf)}</span>
          </span>
          <span className="rounded-lg border bg-white px-3 py-1.5">
            WHT-sensitive items{" "}
            <span className="font-semibold tabular-nums">{summary.whtSensitiveCount}</span>
          </span>
        </div>


        {expenses.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
            No non-EBM expenses logged for this period. Add rent, casual labour or transport above.
          </p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">WHT</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenses.map((expense) => (
                  <TableRow key={expense.id}>
                    <TableCell className="text-xs tabular-nums">
                      {formatIsoDate(expense.expenseDate)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {EXPENSE_CATEGORIES.find((entry) => entry.value === expense.category)?.label}
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className="font-medium text-navy">{expense.vendorName}</span>
                      {expense.description && (
                        <span className="block text-[11px] text-muted-foreground">
                          {expense.description}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {formatRwf(expense.amountRwf)}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {expense.whtRequired ? (
                        <>
                          {formatRwf(expense.whtAmountRwf)}
                          <span className="block text-[10px] text-muted-foreground">
                            {expense.whtRate}%
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {expense.whtRequired ? (
                        <Badge variant="warning">
                          <AlertTriangle className="h-3 w-3" /> WHT certificate needed
                        </Badge>
                      ) : (
                        <Badge variant="muted">Document only</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-slate-400 hover:text-destructive"
                        aria-label="Remove expense"
                        onClick={() => remove(expense.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

