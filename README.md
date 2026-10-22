# TaxOps Rwanda

A multi-tenant B2B workspace for **Certified Tax Advisors, accounting firms and bookkeepers in Kigali** who prepare RRA declarations every month. It is an **intelligent pre-declaration data pipeline** — not an RRA CIS/VSDC-certified invoicing system. Everything works from exported CSV/Excel/PDF files, so no RRA integration is required.

| Module | What it does |
| --- | --- |
| **1. Annexure Sanitizer** | Ingests EBM v2.1 / QuickBooks / Tally / Xero exports, applies strict TIN, date, MRC and 18% VAT rules, lets accountants correct rows inline, and exports a **headerless tab-delimited `.txt`** for `etax.rra.gov.rw` (no Excel macros). |
| **2. 3-way reconciliation** | Cross-checks EBM sales/purchases against MTN MoMo Pay, Airtel Money and bank statements to surface **un-invoiced revenue**, **missing input VAT** and **unsupported expenses** before filing. |
| **3. Advisor hub** | Firm → staff → SME clients (indexed by 9-digit TIN), a 5-stage monthly Kanban pipeline, WhatsApp/SMS document reminders with magic-link dropzones, and RRA Doc ID payment pushes. |

Design system: Deep Navy `#0F172A`, Emerald for validated/reconciled, Amber for rounding warnings, Crimson for RRA audit risk / invalid TINs, Gold for billing accents.

---

## Quick start

```bash
npm install
cp .env.example .env.local   # optional for the annexure/reconciliation demo
npm run dev                  # http://localhost:3000
npm test                     # engine tests (Vitest)
npm run typecheck
npm run build
```

The app runs fully in **local demo mode** without Supabase or WhatsApp credentials: file parsing, validation, reconciliation and message rendering all work; only persistence/dispatch are skipped.

### Supabase setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL editor (or `supabase db push`).
3. Run `supabase/seed.sql` for a demo firm, 8 SME clients and a current-month pipeline.
4. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.
5. Create auth users and map them to `public.users` (`id` = `auth.users.id`, `firm_id`, `role`). RLS resolves the tenant through `public.current_firm_id()`.

### WhatsApp / SMS

Set `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_ACCESS_TOKEN` to dispatch real WhatsApp Cloud API messages. Without them, `/api/whatsapp/send` runs in **dry-run** mode and returns the rendered payload while still queueing it in `message_outbox`. SMS uses the generic `SMS_GATEWAY_URL` bridge.

---

## Folder structure

```
.
├── supabase/
│   ├── schema.sql                  # tables, enums, indexes, RLS, pipeline view, seed firm
│   └── seed.sql                    # demo firm + 8 clients + current-month cards
├── public/samples/                 # messy demo exports for all four annexures
├── src/
│   ├── app/
│   │   ├── layout.tsx              # shell (sidebar, deadline, firm card)
│   │   ├── globals.css             # design tokens / state colors
│   │   ├── page.tsx                # Module 3 — Practice Hub Kanban
│   │   ├── annexure/page.tsx       # Module 1
│   │   ├── reconciliation/page.tsx # Module 2
│   │   └── api/
│   │       ├── annexure/parse/     # XLSX/CSV → mapped, normalized rows
│   │       ├── annexure/export/    # validate + headerless .txt (+ optional persist)
│   │       ├── reconciliation/match/  # 3-way matching engine
│   │       ├── whatsapp/send/      # Cloud API dispatch / dry-run
│   │       └── rra/receipt/        # PDF → RRA Doc ID + tax due
│   ├── components/
│   │   ├── ui/                     # shadcn/ui primitives
│   │   ├── shared/                 # PageHeader, KpiCard, FileDropzone
│   │   ├── annexure/               # workbench, editable grid, mapping dialog
│   │   ├── reconciliation/         # dual dropzone, KPI cards, match tables
│   │   └── dashboard/              # Kanban board, WhatsApp composer
│   └── lib/
│       ├── annexure/               # types, config, normalize, mapping, validate, export, parse
│       ├── reconciliation/         # statement parser + matching algorithms
│       ├── whatsapp/               # EN/Kinyarwanda templates + Cloud API client
│       ├── rra/                    # RRA acknowledgement PDF extractor
│       ├── supabase/               # browser/server/admin clients
│       └── utils.ts                # RWF/date formatting, cn()
└── vitest.config.ts
```

---

## Module 1 — rules implemented

| Rule | Behaviour |
| --- | --- |
| **TIN** | Strips spaces, hyphens, dots and NBSP. Must be exactly **9 numeric digits**, otherwise `ERROR / TIN_INVALID`. Letters are preserved (not silently dropped) so bad TINs fail loudly. |
| **Dates** | Accepts ISO, `DD/MM/YYYY`, `MM/DD/YYYY`, `DD-MM-YYYY`, `YYYYMMDD`, Excel serials (1900 system), month names (EN/FR). Ambiguity is resolved by the `dateOrder` setting (default DMY). Emits `DD/MM/YYYY` only. Dates outside the selected `YYYY-MM` period are warnings. |
| **Strings** | Names/descriptions are NFD-normalized (accents removed), tabs/newlines/quotes/commas/slashes/control chars stripped and whitespace collapsed. Invoice numbers keep `/` because EBM receipts use `SDC…/0001`. |
| **MRC** | Required and must match `SDC` + 6–15 digits, optionally `/0001`. |
| **RWF integers** | Every amount is rounded to whole RWF on ingest, on inline edit and on export. |
| **18% VAT** | `round(taxable × 0.18)` compared to the declared VAT with configurable `±1 RWF` tolerance: exact = valid, gap ≤ tolerance = amber warning, gap > tolerance = crimson error. Non-VAT-registered clients skip the check; WHT uses 15% / 3%. |
| **Duplicates / period / currency** | Duplicate invoice numbers, invoices outside the period, and non-RWF lines are flagged. |
| **Auto-fix** | `Fix ±1 rounding` aligns gaps inside the tolerance band; `Recalculate 18% VAT` recomputes the tax column from taxable for every row (change summary shown in the notice bar). |
| **Export guard** | The `.txt` is blocked while any `ERROR` row remains; the dialog lists the exact rows and offers "Remove N invalid". |

### Output format

The `.txt` is **headerless**, **tab-delimited**, **CRLF**, UTF-8, with a trailing newline and **no trailing tab**. Column order is configuration, not magic — edit `outputColumns` in `src/lib/annexure/annexure-config.ts` if RRA publishes a revised template. Defaults:

| Annexure | Columns |
| --- | --- |
| Sales | invoiceNo → invoiceDate → buyerTIN → buyerName → taxable → VAT → MRC |
| Purchases | invoiceNo → invoiceDate → supplierTIN → supplierName → taxable → VAT → MRC |
| Imports | declarationNo → date → supplierTIN → supplierName → customsValue → importVAT |
| WHT | invoiceNo → date → payeeTIN → payeeName → base → rate → withheld |

> **Compliance note:** TaxOps Rwanda is a data-preparation tool. It never transmits to RRA. The accountant reviews the generated file and uploads it to e-Tax. Validate the column order against the current RRA template before your first production filing.

---

## Module 2 — reconciliation logic

- **Un-invoiced revenue:** daily and weekly MoMo + bank POS inflows are compared with EBM sales. When `deposits > EBM sales`, each gap becomes `UNINVOICED_REVENUE_RISK` with the exact RWF variance and a "high audit risk" KPI.
- **Missing input VAT:** outgoing B2B payments are matched to EBM confirmed purchases by TIN (exact) or normalized counterparty name, amount within ±1% / ±500 RWF, and a ±7-day date window. Unmatched payouts become `MISSING_EBM_PURCHASE`; unmatched confirmed purchases become `UNCLAIMED_INPUT_VAT` with an estimated claim of `round(amount × 18/118)`.
- **Unsupported expenses:** non-EBM expenses (individual landlord rent, casual labour, local transport, utilities) are logged with a generated `wht_required` flag and 15%/3% withholding amount so they are not disallowed at CIT audit.

## Module 3 — advisor hub

- Kanban stages: `WAITING_DOCS → RECONCILING → ANNEXURE_READY → DECLARED → PAID`, with drag-and-drop and table view, deadline countdown, and per-client TIN.
- Reminder scheduler templates for the **5th, 10th and 13th**, in English and Kinyarwanda, including a signed magic-link dropzone (`client_upload_tokens`).
- RRA receipt PDF → extracts **Doc ID** and **total tax payable** → generates the bilingual payment push (USSD `*182*3*…#`) with the PDF attached.
- All sends are written to `message_outbox` for audit.

---

## Security

- RLS is enabled on every tenant table. `firm_id` is resolved server-side via `security definer` helpers; child tables inherit tenancy through `tax_periods → clients`.
- The service-role key is used only in server routes (annexure persistence) and never shipped to the browser.
- Magic-link tokens are 192-bit random, single-purpose and expire after 14 days.
- Uploaded files are parsed in memory; only normalized rows are persisted.

## Scripts

`npm run dev` · `npm run build` · `npm start` · `npm test` · `npm run test:watch` · `npm run typecheck`

