import type { AnnexureRow, AnnexureType, CanonicalField } from "./types";

/**
 * RRA e-Tax annexure definitions.
 *
 * ---------------------------------------------------------------------------
 * IMPORTANT — column order is configuration, not magic
 * ---------------------------------------------------------------------------
 * RRA has shipped several revisions of the e-Tax annexure templates
 * (French/English variants, with and without the MRC column). The
 * `outputColumns` array below is the single source of truth for the generated
 * headerless .txt: reorder it to match the template version your filing portal
 * currently accepts. Nothing else in the engine needs to change.
 *
 * Values are emitted in RWF integers, dates as DD/MM/YYYY, and strings are
 * sanitized so the RRA parser never sees tabs, commas, slashes or accents.
 */

export interface AnnexureFieldSpec {
  key: CanonicalField;
  /** Human label used in the grid and mapping UI. */
  label: string;
  aliases: string[];
  required: boolean;
  kind: "text" | "tin" | "date" | "amount" | "mrc" | "rate" | "currency" | "enum";
}

export interface AnnexureFormat {
  type: AnnexureType;
  label: string;
  shortLabel: string;
  description: string;
  /** Label of the tax column (VAT vs WHT). */
  taxLabel: string;
  /** Whether 18% VAT math applies to the taxable base. */
  vatApplicable: boolean;
  fields: AnnexureFieldSpec[];
  /** Ordered canonical fields written to the .txt file (headerless). */
  outputColumns: CanonicalField[];
  /** File-name prefix for the download. */
  filePrefix: string;
}

const NAME_ALIASES = [
  "name",
  "buyer name",
  "supplier name",
  "customer name",
  "client name",
  "nom",
  "nom du client",
  "nom fournisseur",
  "raison sociale",
  "denomination",
  "business name",
  "counterparty",
  "payee name",
];

const TIN_ALIASES = [
  "tin",
  "buyer tin",
  "supplier tin",
  "customer tin",
  "client tin",
  "tin number",
  "tin no",
  "nif",
  "numero tin",
  "numéro tin",
  "tax id",
  "taxpayer tin",
];

const INVOICE_ALIASES = [
  "invoice",
  "invoice no",
  "invoice number",
  "invoice no.",
  "invoice #",
  "receipt",
  "receipt no",
  "receipt number",
  "ebm receipt",
  "ebm receipt no",
  "facture",
  "n facture",
  "no facture",
  "num facture",
  "numero facture",
  "numéro facture",
  "doc no",
  "document no",
  "declaration no",
  "reference",
];

const DATE_ALIASES = [
  "date",
  "invoice date",
  "receipt date",
  "transaction date",
  "sales date",
  "purchase date",
  "date facture",
  "date de facture",
  "doc date",
  "document date",
];

const TAXABLE_ALIASES = [
  "taxable",
  "taxable amount",
  "taxable base",
  "base",
  "base amount",
  "amount",
  "amount before vat",
  "net amount",
  "subtotal",
  "excl vat",
  "montant ht",
  "montant hors taxe",
  "ht",
  "total ht",
  "customs value",
  "cif value",
  "base imposable",
  "gross amount",
];

const VAT_ALIASES = [
  "vat",
  "vat amount",
  "tax",
  "tax amount",
  "tva",
  "montant tva",
  "vat 18",
  "output vat",
  "input vat",
  "wht",
  "wht amount",
  "withholding",
  "withholding tax",
  "tax withheld",
  "amount withheld",
];

const MRC_ALIASES = [
  "mrc",
  "mrc code",
  "code mrc",
  "machine registration code",
  "machine code",
  "ebm mrc",
  "device code",
  "sdc",
  "sdc code",
];

const CURRENCY_ALIASES = ["currency", "curr", "devise", "currency code"];
const RATE_ALIASES = ["rate", "wht rate", "tax rate", "taux", "taux wht", "percentage"];
const PURCHASE_TYPE_ALIASES = [
  "purchase type",
  "type",
  "type achat",
  "import",
  "local/import",
  "origin",
];

const COMMON = {
  invoiceNo: {
    key: "invoiceNo" as const,
    label: "Invoice / Receipt No",
    aliases: INVOICE_ALIASES,
    required: true,
    kind: "text" as const,
  },
  invoiceDate: {
    key: "invoiceDate" as const,
    label: "Invoice Date",
    aliases: DATE_ALIASES,
    required: true,
    kind: "date" as const,
  },
  counterpartyTin: {
    key: "counterpartyTin" as const,
    label: "TIN",
    aliases: TIN_ALIASES,
    required: true,
    kind: "tin" as const,
  },
  counterpartyName: {
    key: "counterpartyName" as const,
    label: "Name",
    aliases: NAME_ALIASES,
    required: true,
    kind: "text" as const,
  },
  taxableAmountRwf: {
    key: "taxableAmountRwf" as const,
    label: "Taxable Amount (RWF)",
    aliases: TAXABLE_ALIASES,
    required: true,
    kind: "amount" as const,
  },
  vatAmountRwf: {
    key: "vatAmountRwf" as const,
    label: "VAT Amount (RWF)",
    aliases: VAT_ALIASES,
    required: true,
    kind: "amount" as const,
  },
  mrcCode: {
    key: "mrcCode" as const,
    label: "MRC Code",
    aliases: MRC_ALIASES,
    required: true,
    kind: "mrc" as const,
  },
  currency: {
    key: "currency" as const,
    label: "Currency",
    aliases: CURRENCY_ALIASES,
    required: false,
    kind: "currency" as const,
  },
  whtRate: {
    key: "whtRate" as const,
    label: "WHT Rate (%)",
    aliases: RATE_ALIASES,
    required: false,
    kind: "rate" as const,
  },
  purchaseType: {
    key: "purchaseType" as const,
    label: "Purchase Type",
    aliases: PURCHASE_TYPE_ALIASES,
    required: false,
    kind: "enum" as const,
  },
};

export const ANNEXURE_FORMATS: Record<AnnexureType, AnnexureFormat> = {
  SALES: {
    type: "SALES",
    label: "VAT Sales Annexure",
    shortLabel: "Sales",
    description:
      "Output VAT on EBM receipts issued to buyers. Buyer TIN is 9 digits; VAT must equal 18% of the taxable amount (±1 RWF).",
    taxLabel: "VAT Amount",
    vatApplicable: true,
    fields: [
      COMMON.invoiceNo,
      COMMON.invoiceDate,
      { ...COMMON.counterpartyTin, label: "Buyer TIN" },
      { ...COMMON.counterpartyName, label: "Buyer Name" },
      COMMON.taxableAmountRwf,
      { ...COMMON.vatAmountRwf, label: "VAT Amount (18%)" },
      COMMON.mrcCode,
    ],
    outputColumns: [
      "invoiceNo",
      "invoiceDate",
      "counterpartyTin",
      "counterpartyName",
      "taxableAmountRwf",
      "vatAmountRwf",
      "mrcCode",
    ],
    filePrefix: "VAT_SALES",
  },
  PURCHASES: {
    type: "PURCHASES",
    label: "VAT Local Purchases Annexure",
    shortLabel: "Purchases",
    description:
      "Input VAT on local EBM supplier invoices. Unconfirmed EBM purchases cannot be deducted — reconcile against bank/MoMo payouts first.",
    taxLabel: "VAT Amount",
    vatApplicable: true,
    fields: [
      COMMON.invoiceNo,
      COMMON.invoiceDate,
      { ...COMMON.counterpartyTin, label: "Supplier TIN" },
      { ...COMMON.counterpartyName, label: "Supplier Name" },
      COMMON.taxableAmountRwf,
      { ...COMMON.vatAmountRwf, label: "Input VAT Amount" },
      COMMON.mrcCode,
      COMMON.purchaseType,
    ],
    outputColumns: [
      "invoiceNo",
      "invoiceDate",
      "counterpartyTin",
      "counterpartyName",
      "taxableAmountRwf",
      "vatAmountRwf",
      "mrcCode",
    ],
    filePrefix: "VAT_PURCHASES",
  },
  IMPORTS: {
    type: "IMPORTS",
    label: "Imports (DMC Customs) Annexure",
    shortLabel: "Imports",
    description:
      "Customs declarations from DMC. Taxable base is the CIF/customs value; VAT paid at the border is claimable when the DMC receipt names the same TIN.",
    taxLabel: "Import VAT Amount",
    vatApplicable: true,
    fields: [
      { ...COMMON.invoiceNo, label: "DMC Declaration No" },
      { ...COMMON.invoiceDate, label: "Declaration Date" },
      { ...COMMON.counterpartyTin, label: "Supplier TIN" },
      { ...COMMON.counterpartyName, label: "Supplier Name" },
      { ...COMMON.taxableAmountRwf, label: "Customs Value (RWF)" },
      { ...COMMON.vatAmountRwf, label: "Import VAT Amount" },
      COMMON.currency,
    ],
    outputColumns: [
      "invoiceNo",
      "invoiceDate",
      "counterpartyTin",
      "counterpartyName",
      "taxableAmountRwf",
      "vatAmountRwf",
    ],
    filePrefix: "VAT_IMPORTS",
  },
  WHT: {
    type: "WHT",
    label: "Withholding Tax Annexure",
    shortLabel: "WHT",
    description:
      "15% on services, rent and professional fees; 3% on goods supplied by non-VAT payees. The WHT column is the amount withheld, not VAT.",
    taxLabel: "WHT Amount",
    vatApplicable: false,
    fields: [
      COMMON.invoiceNo,
      COMMON.invoiceDate,
      { ...COMMON.counterpartyTin, label: "Payee TIN" },
      { ...COMMON.counterpartyName, label: "Payee Name" },
      { ...COMMON.taxableAmountRwf, label: "Base Amount (RWF)" },
      { ...COMMON.whtRate, label: "WHT Rate (%)", required: true },
      { ...COMMON.vatAmountRwf, label: "WHT Amount (RWF)" },
    ],
    outputColumns: [
      "invoiceNo",
      "invoiceDate",
      "counterpartyTin",
      "counterpartyName",
      "taxableAmountRwf",
      "whtRate",
      "vatAmountRwf",
    ],
    filePrefix: "WHT",
  },
};

/** Canonical → wire value used in the .txt file. */
export function formatOutputValue(field: CanonicalField, row: AnnexureRow): string {
  switch (field) {
    case "invoiceNo":
      return row.invoiceNo;
    case "invoiceDate":
      return row.invoiceDate ? isoToDdMmYyyy(row.invoiceDate) : "";
    case "counterpartyTin":
      return row.counterpartyTin;
    case "counterpartyName":
      return row.counterpartyName;
    case "taxableAmountRwf":
      return row.taxableAmountRwf == null ? "" : String(Math.round(row.taxableAmountRwf));
    case "vatAmountRwf":
      return row.vatAmountRwf == null ? "" : String(Math.round(row.vatAmountRwf));
    case "mrcCode":
      return row.mrcCode;
    case "currency":
      return row.currency || "RWF";
    case "whtRate":
      return row.whtRate == null ? "" : formatRate(row.whtRate);
    case "purchaseType":
      return row.purchaseType;
    default:
      return "";
  }
}

/** 15 or 3 (never 15.00) — RRA templates parse numeric rates strictly. */
export function formatRate(rate: number): string {
  return Number.isInteger(rate)
    ? String(rate)
    : String(rate).replace(/0+$/, "").replace(/\.$/, "");
}

export function isoToDdMmYyyy(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return "";
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function expectedVatFor(
  taxableAmountRwf: number | null,
  vatRate: number,
): number | null {
  if (taxableAmountRwf == null) return null;
  return Math.round(taxableAmountRwf * vatRate);
}

