/**
 * Unsupported (non-EBM) expense tracking with Rwanda withholding-tax logic.
 *
 * 15% WHT applies to services, rent paid to individuals and professional fees.
 * 3% applies to goods supplied by non-VAT-registered payees.
 */
export type ExpenseCategory =
  | "RENT_INDIVIDUAL"
  | "CASUAL_LABOUR"
  | "TRANSPORT"
  | "UTILITIES"
  | "PROFESSIONAL_FEES"
  | "MARKETING"
  | "OTHER";

export interface ExpenseCategorySpec {
  value: ExpenseCategory;
  label: string;
  description: string;
  /** Default WHT rate percentage; 0 when no withholding is normally due. */
  whtRate: number;
  /** True when the expense is typically disallowed without a WHT certificate. */
  whtSensitive: boolean;
}

export const EXPENSE_CATEGORIES: ExpenseCategorySpec[] = [
  {
    value: "RENT_INDIVIDUAL",
    label: "Rent — individual landlord",
    description: "Commercial rent paid to a person without an EBM receipt. 15% WHT due.",
    whtRate: 15,
    whtSensitive: true,
  },
  {
    value: "CASUAL_LABOUR",
    label: "Casual labour",
    description: "Daily/seasonal workers outside payroll. 15% WHT due.",
    whtRate: 15,
    whtSensitive: true,
  },
  {
    value: "PROFESSIONAL_FEES",
    label: "Professional fees",
    description: "Consultants, lawyers, auditors, agents. 15% WHT due.",
    whtRate: 15,
    whtSensitive: true,
  },
  {
    value: "TRANSPORT",
    label: "Local transport",
    description: "Moto/taxi and local haulage without EBM invoices. Review WHT status.",
    whtRate: 15,
    whtSensitive: false,
  },
  {
    value: "UTILITIES",
    label: "Utilities",
    description: "Water, internet, waste collection. Withholding depends on supplier status.",
    whtRate: 0,
    whtSensitive: false,
  },
  {
    value: "MARKETING",
    label: "Marketing & small purchases",
    description: "Promotions, printing and small goods from non-EBM suppliers. 3% on goods.",
    whtRate: 3,
    whtSensitive: false,
  },
  {
    value: "OTHER",
    label: "Other non-EBM expense",
    description: "Anything else without an EBM invoice. Document why it is deductible.",
    whtRate: 0,
    whtSensitive: false,
  },
];

export interface UnsupportedExpense {
  id: string;
  expenseDate: string;
  category: ExpenseCategory;
  vendorName: string;
  vendorTin: string | null;
  description: string;
  amountRwf: number;
  whtRate: number;
  whtAmountRwf: number;
  whtRequired: boolean;
}

export function expenseCategorySpec(category: ExpenseCategory): ExpenseCategorySpec {
  return EXPENSE_CATEGORIES.find((entry) => entry.value === category) ?? EXPENSE_CATEGORIES[6]!;
}

export function buildUnsupportedExpense(params: {
  id: string;
  expenseDate: string;
  category: ExpenseCategory;
  vendorName: string;
  vendorTin?: string | null;
  description?: string;
  amountRwf: number;
  whtRateOverride?: number | null;
}): UnsupportedExpense {
  const spec = expenseCategorySpec(params.category);
  const rate = params.whtRateOverride ?? spec.whtRate;
  const whtAmountRwf = rate > 0 ? Math.round((params.amountRwf * rate) / 100) : 0;
  return {
    id: params.id,
    expenseDate: params.expenseDate,
    category: params.category,
    vendorName: params.vendorName,
    vendorTin: params.vendorTin ?? null,
    description: params.description ?? "",
    amountRwf: Math.round(params.amountRwf),
    whtRate: rate,
    whtAmountRwf,
    whtRequired: rate > 0,
  };
}

export function summarizeExpenses(expenses: UnsupportedExpense[]): {
  totalRwf: number;
  whtDueRwf: number;
  whtSensitiveCount: number;
  deductibleRwf: number;
} {
  return expenses.reduce(
    (acc, expense) => {
      acc.totalRwf += expense.amountRwf;
      acc.whtDueRwf += expense.whtAmountRwf;
      acc.deductibleRwf += expense.amountRwf;
      if (expense.whtRequired) acc.whtSensitiveCount += 1;
      return acc;
    },
    { totalRwf: 0, whtDueRwf: 0, whtSensitiveCount: 0, deductibleRwf: 0 },
  );
}
