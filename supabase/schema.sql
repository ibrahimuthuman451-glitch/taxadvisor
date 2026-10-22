-- ============================================================================
-- TaxOps Rwanda — Supabase / PostgreSQL schema
-- ----------------------------------------------------------------------------
-- Multi-tenant (Accounting Firm) workspace for RRA pre-declaration pipelines.
-- Run this file in the Supabase SQL editor (or `supabase db push`).
--
-- Tenant isolation strategy
--   firms ─1:N─ users (auth.users.id)
--         ─1:N─ clients ─1:N─ tax_periods ─1:N─ annexure_rows
--                                        ─1:N─ reconciliation_items
--                                        ─1:N─ unsupported_expenses
-- Every tenant table carries a resolvable `firm_id` (directly or via parent)
-- and is protected by RLS using public.current_firm_id().
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enumerated domains
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.firm_subscription_tier as enum ('STARTER', 'PRACTICE', 'ENTERPRISE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.user_role as enum ('admin', 'accountant');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tax_regime as enum ('REAL', 'LUMP_SUM', 'FLAT');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tax_type as enum ('VAT', 'PAYE', 'WHT', 'CIT');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.tax_period_status as enum (
    'WAITING_DOCS',   -- 1. Waiting for client docs
    'RECONCILING',    -- 2. Reconciling (EBM vs MoMo/Bank)
    'ANNEXURE_READY', -- 3. Annexure validated, .txt ready
    'DECLARED',       -- 4. Declared on E-Tax (RRA Doc ID captured)
    'PAID'            -- 5. Paid & archived
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.annexure_type as enum ('SALES', 'PURCHASES', 'IMPORTS', 'WHT');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.validation_status as enum ('VALID', 'WARNING', 'ERROR');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.reconciliation_source as enum (
    'EBM_SALE', 'EBM_PURCHASE', 'MOMO_STATEMENT', 'BANK_STATEMENT'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.match_status as enum (
    'MATCHED',
    'UNINVOICED_REVENUE_RISK',
    'MISSING_EBM_PURCHASE',
    'UNCLAIMED_INPUT_VAT',
    'UNMATCHED'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.message_channel as enum ('WHATSAPP', 'SMS');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.message_status as enum ('QUEUED', 'SENT', 'FAILED', 'DRY_RUN');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.expense_category as enum (
    'RENT_INDIVIDUAL', 'CASUAL_LABOUR', 'TRANSPORT', 'UTILITIES',
    'PROFESSIONAL_FEES', 'MARKETING', 'OTHER'
  );
exception when duplicate_object then null; end $$;



-- ---------------------------------------------------------------------------
-- 1. firms
-- ---------------------------------------------------------------------------
create table if not exists public.firms (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  tin               varchar(9) not null,
  subscription_tier public.firm_subscription_tier not null default 'PRACTICE',
  created_at        timestamptz not null default now(),
  constraint firms_tin_numeric check (tin ~ '^[0-9]{9}$')
);
create unique index if not exists firms_tin_key on public.firms (tin);

-- ---------------------------------------------------------------------------
-- 2. users  (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id         uuid primary key references auth.users (id) on delete cascade,
  firm_id    uuid not null references public.firms (id) on delete cascade,
  full_name  text not null,
  email      text not null,
  role       public.user_role not null default 'accountant',
  created_at timestamptz not null default now()
);
create index if not exists users_firm_id_idx on public.users (firm_id);

-- ---------------------------------------------------------------------------
-- 3. clients
-- ---------------------------------------------------------------------------
create table if not exists public.clients (
  id             uuid primary key default gen_random_uuid(),
  firm_id        uuid not null references public.firms (id) on delete cascade,
  business_name  text not null,
  tin            varchar(9) not null,
  tax_regime     public.tax_regime not null default 'REAL',
  vat_registered boolean not null default true,
  whatsapp_phone text,             -- E.164, e.g. +250788123456
  contact_name   text,
  email          text,
  archived       boolean not null default false,
  created_at     timestamptz not null default now(),
  constraint clients_tin_numeric check (tin ~ '^[0-9]{9}$'),
  constraint clients_firm_tin_key unique (firm_id, tin)
);
create index if not exists clients_firm_id_idx on public.clients (firm_id);
create index if not exists clients_tin_idx on public.clients (tin);

-- ---------------------------------------------------------------------------
-- 4. tax_periods  (one row per client / month / tax type — the Kanban card)
-- ---------------------------------------------------------------------------
create table if not exists public.tax_periods (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients (id) on delete cascade,
  period_month     varchar(7) not null,          -- 'YYYY-MM'
  tax_type         public.tax_type not null default 'VAT',
  status           public.tax_period_status not null default 'WAITING_DOCS',
  rra_doc_id       text,
  tax_due_rwf      bigint,
  due_date         date,                          -- 15th for VAT/WHT/PAYE, 31 Mar for CIT
  declared_at      timestamptz,
  paid_at          timestamptz,
  stage_updated_at timestamptz not null default now(),
  notes            text,
  created_at       timestamptz not null default now(),
  constraint tax_periods_month_format check (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  constraint tax_periods_client_month_type_key unique (client_id, period_month, tax_type)
);
create index if not exists tax_periods_client_idx on public.tax_periods (client_id);
create index if not exists tax_periods_month_status_idx on public.tax_periods (period_month, status);

-- ---------------------------------------------------------------------------
-- 5. annexure_rows  (sanitized rows ready for the RRA .txt generator)
-- ---------------------------------------------------------------------------
create table if not exists public.annexure_rows (
  id                 uuid primary key default gen_random_uuid(),
  tax_period_id      uuid not null references public.tax_periods (id) on delete cascade,
  annexure_type      public.annexure_type not null,
  row_number         integer not null,
  counterparty_tin   varchar(9),
  counterparty_name  text,
  invoice_no         text,
  mrc_code           text,
  invoice_date       date,
  taxable_amount_rwf bigint,
  vat_amount_rwf     bigint,
  validation_status  public.validation_status not null default 'VALID',
  error_messages     jsonb not null default '[]'::jsonb,
  source_file        text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint annexure_rows_row_number_positive check (row_number > 0),
  constraint annexure_rows_period_row_key unique (tax_period_id, annexure_type, row_number)
);
create index if not exists annexure_rows_period_idx on public.annexure_rows (tax_period_id, annexure_type);
create index if not exists annexure_rows_status_idx on public.annexure_rows (validation_status);

-- ---------------------------------------------------------------------------
-- 6. reconciliation_items
-- ---------------------------------------------------------------------------
create table if not exists public.reconciliation_items (
  id              uuid primary key default gen_random_uuid(),
  tax_period_id   uuid not null references public.tax_periods (id) on delete cascade,
  source          public.reconciliation_source not null,
  tx_date         date not null,
  reference_no    text,
  description     text,
  amount_rwf      numeric(16, 2) not null,
  counterparty    text,
  counterparty_tin varchar(9),
  match_status    public.match_status not null default 'UNMATCHED',
  matched_item_id uuid references public.reconciliation_items (id) on delete set null,
  notes           text,
  created_at      timestamptz not null default now()
);
create index if not exists reconciliation_items_period_idx on public.reconciliation_items (tax_period_id, match_status);
create index if not exists reconciliation_items_date_idx on public.reconciliation_items (tx_date);


-- ---------------------------------------------------------------------------
-- Module 2 support: non-EBM / unsupported expenses + WHT flag
-- ---------------------------------------------------------------------------
create table if not exists public.unsupported_expenses (
  id             uuid primary key default gen_random_uuid(),
  tax_period_id  uuid not null references public.tax_periods (id) on delete cascade,
  expense_date   date not null,
  category       public.expense_category not null default 'OTHER',
  vendor_name    text not null,
  vendor_tin     varchar(9),
  description    text,
  amount_rwf     numeric(16, 2) not null,
  wht_required   boolean generated always as (category in ('RENT_INDIVIDUAL', 'CASUAL_LABOUR', 'PROFESSIONAL_FEES')) stored,
  wht_rate       numeric(5, 2) not null default 15.00,       -- 15% services/rent, 3% goods
  wht_amount_rwf bigint generated always as (round(amount_rwf * wht_rate / 100.0)) stored,
  created_at     timestamptz not null default now()
);
create index if not exists unsupported_expenses_period_idx on public.unsupported_expenses (tax_period_id);

-- ---------------------------------------------------------------------------
-- Module 3 support: magic-link dropzone, WhatsApp/SMS outbox, RRA receipts
-- ---------------------------------------------------------------------------
create table if not exists public.client_upload_tokens (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references public.clients (id) on delete cascade,
  token       text not null unique default encode(gen_random_bytes(24), 'hex'),
  purpose     text not null default 'MONTHLY_DOCS',
  expires_at  timestamptz not null default (now() + interval '14 days'),
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists client_upload_tokens_client_idx on public.client_upload_tokens (client_id);

create table if not exists public.client_documents (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients (id) on delete cascade,
  upload_token_id uuid references public.client_upload_tokens (id) on delete set null,
  original_name   text not null,
  mime_type       text,
  byte_size       integer,
  storage_path    text,
  document_kind   text not null default 'UNKNOWN', -- MOMO_CSV | BANK_CSV | EBM_CSV | OTHER
  uploaded_at     timestamptz not null default now()
);
create index if not exists client_documents_client_idx on public.client_documents (client_id, uploaded_at desc);

create table if not exists public.rra_receipts (
  id             uuid primary key default gen_random_uuid(),
  tax_period_id  uuid not null references public.tax_periods (id) on delete cascade,
  rra_doc_id     text not null,
  total_tax_rwf  bigint,
  receipt_date   date,
  storage_path   text,
  raw_text       text,
  parsed_at      timestamptz not null default now()
);
create index if not exists rra_receipts_period_idx on public.rra_receipts (tax_period_id);

create table if not exists public.message_outbox (
  id                  uuid primary key default gen_random_uuid(),
  firm_id             uuid not null references public.firms (id) on delete cascade,
  client_id           uuid references public.clients (id) on delete set null,
  tax_period_id       uuid references public.tax_periods (id) on delete set null,
  channel             public.message_channel not null default 'WHATSAPP',
  template_key        text not null,   -- DOCS_REMINDER | RRA_PAYMENT_PUSH | CUSTOM
  language            text not null default 'en' check (language in ('en', 'rw')),
  to_phone            text not null,
  body                text not null,
  status              public.message_status not null default 'QUEUED',
  provider_message_id text,
  error_detail        text,
  sent_at             timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists message_outbox_firm_idx on public.message_outbox (firm_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Tenant resolution helper (SECURITY DEFINER avoids users-RLS recursion)
-- ---------------------------------------------------------------------------
create or replace function public.current_firm_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select firm_id from public.users where id = auth.uid();
$$;
revoke all on function public.current_firm_id() from public;
grant execute on function public.current_firm_id() to authenticated;


create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.users where id = auth.uid();
$$;
revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated;

-- ---------------------------------------------------------------------------
-- updated_at / stage timestamp triggers
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists annexure_rows_touch on public.annexure_rows;
create trigger annexure_rows_touch
  before update on public.annexure_rows
  for each row execute function public.touch_updated_at();

create or replace function public.touch_stage_updated_at()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    new.stage_updated_at = now();
    if new.status = 'DECLARED' and new.declared_at is null then
      new.declared_at = now();
    end if;
    if new.status = 'PAID' and new.paid_at is null then
      new.paid_at = now();
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists tax_periods_stage_touch on public.tax_periods;
create trigger tax_periods_stage_touch
  before update on public.tax_periods
  for each row execute function public.touch_stage_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.firms                enable row level security;
alter table public.users                enable row level security;
alter table public.clients              enable row level security;
alter table public.tax_periods          enable row level security;
alter table public.annexure_rows        enable row level security;
alter table public.reconciliation_items enable row level security;
alter table public.unsupported_expenses enable row level security;
alter table public.client_upload_tokens enable row level security;
alter table public.client_documents     enable row level security;
alter table public.rra_receipts         enable row level security;
alter table public.message_outbox       enable row level security;

-- firms: members read their own firm; admins update it
drop policy if exists firms_select on public.firms;
create policy firms_select on public.firms
  for select to authenticated
  using (id = public.current_firm_id());

drop policy if exists firms_update on public.firms;
create policy firms_update on public.firms
  for update to authenticated
  using (id = public.current_firm_id() and public.current_user_role() = 'admin')
  with check (id = public.current_firm_id());

-- users: read colleagues in same firm; only admins manage members
drop policy if exists users_select on public.users;
create policy users_select on public.users
  for select to authenticated
  using (firm_id = public.current_firm_id() or id = auth.uid());

drop policy if exists users_insert on public.users;
create policy users_insert on public.users
  for insert to authenticated
  with check (firm_id = public.current_firm_id() and public.current_user_role() = 'admin');

drop policy if exists users_update on public.users;
create policy users_update on public.users
  for update to authenticated
  using (firm_id = public.current_firm_id() and public.current_user_role() = 'admin')
  with check (firm_id = public.current_firm_id());

-- clients: firm-scoped CRUD
drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients
  for select to authenticated
  using (firm_id = public.current_firm_id());

drop policy if exists clients_insert on public.clients;
create policy clients_insert on public.clients
  for insert to authenticated
  with check (firm_id = public.current_firm_id());

drop policy if exists clients_update on public.clients;
create policy clients_update on public.clients
  for update to authenticated
  using (firm_id = public.current_firm_id())
  with check (firm_id = public.current_firm_id());

drop policy if exists clients_delete on public.clients;
create policy clients_delete on public.clients
  for delete to authenticated
  using (firm_id = public.current_firm_id() and public.current_user_role() = 'admin');


-- tax_periods: via parent client
drop policy if exists tax_periods_select on public.tax_periods;
create policy tax_periods_select on public.tax_periods
  for select to authenticated
  using (exists (
    select 1 from public.clients c
    where c.id = tax_periods.client_id and c.firm_id = public.current_firm_id()
  ));

drop policy if exists tax_periods_insert on public.tax_periods;
create policy tax_periods_insert on public.tax_periods
  for insert to authenticated
  with check (exists (
    select 1 from public.clients c
    where c.id = tax_periods.client_id and c.firm_id = public.current_firm_id()
  ));

drop policy if exists tax_periods_update on public.tax_periods;
create policy tax_periods_update on public.tax_periods
  for update to authenticated
  using (exists (
    select 1 from public.clients c
    where c.id = tax_periods.client_id and c.firm_id = public.current_firm_id()
  ))
  with check (exists (
    select 1 from public.clients c
    where c.id = tax_periods.client_id and c.firm_id = public.current_firm_id()
  ));

drop policy if exists tax_periods_delete on public.tax_periods;
create policy tax_periods_delete on public.tax_periods
  for delete to authenticated
  using (
    public.current_user_role() = 'admin'
    and exists (
      select 1 from public.clients c
      where c.id = tax_periods.client_id and c.firm_id = public.current_firm_id()
    )
  );

-- Annexure rows: any firm member may read/write rows of their firm's periods
drop policy if exists annexure_rows_all on public.annexure_rows;
create policy annexure_rows_all on public.annexure_rows
  for all to authenticated
  using (exists (
    select 1 from public.tax_periods tp
    join public.clients c on c.id = tp.client_id
    where tp.id = annexure_rows.tax_period_id and c.firm_id = public.current_firm_id()
  ))
  with check (exists (
    select 1 from public.tax_periods tp
    join public.clients c on c.id = tp.client_id
    where tp.id = annexure_rows.tax_period_id and c.firm_id = public.current_firm_id()
  ));

drop policy if exists reconciliation_items_all on public.reconciliation_items;
create policy reconciliation_items_all on public.reconciliation_items
  for all to authenticated
  using (exists (
    select 1 from public.tax_periods tp
    join public.clients c on c.id = tp.client_id
    where tp.id = reconciliation_items.tax_period_id and c.firm_id = public.current_firm_id()
  ))
  with check (exists (
    select 1 from public.tax_periods tp
    join public.clients c on c.id = tp.client_id
    where tp.id = reconciliation_items.tax_period_id and c.firm_id = public.current_firm_id()
  ));

drop policy if exists unsupported_expenses_all on public.unsupported_expenses;
create policy unsupported_expenses_all on public.unsupported_expenses
  for all to authenticated
  using (exists (
    select 1 from public.tax_periods tp
    join public.clients c on c.id = tp.client_id
    where tp.id = unsupported_expenses.tax_period_id and c.firm_id = public.current_firm_id()
  ))
  with check (exists (
    select 1 from public.tax_periods tp
    join public.clients c on c.id = tp.client_id
    where tp.id = unsupported_expenses.tax_period_id and c.firm_id = public.current_firm_id()
  ));

drop policy if exists rra_receipts_all on public.rra_receipts;
create policy rra_receipts_all on public.rra_receipts
  for all to authenticated
  using (exists (
    select 1 from public.tax_periods tp
    join public.clients c on c.id = tp.client_id
    where tp.id = rra_receipts.tax_period_id and c.firm_id = public.current_firm_id()
  ))
  with check (exists (
    select 1 from public.tax_periods tp
    join public.clients c on c.id = tp.client_id
    where tp.id = rra_receipts.tax_period_id and c.firm_id = public.current_firm_id()
  ));

drop policy if exists client_upload_tokens_all on public.client_upload_tokens;
create policy client_upload_tokens_all on public.client_upload_tokens
  for all to authenticated
  using (exists (
    select 1 from public.clients c
    where c.id = client_upload_tokens.client_id and c.firm_id = public.current_firm_id()
  ))
  with check (exists (
    select 1 from public.clients c
    where c.id = client_upload_tokens.client_id and c.firm_id = public.current_firm_id()
  ));

drop policy if exists client_documents_all on public.client_documents;
create policy client_documents_all on public.client_documents
  for all to authenticated
  using (exists (
    select 1 from public.clients c
    where c.id = client_documents.client_id and c.firm_id = public.current_firm_id()
  ))
  with check (exists (
    select 1 from public.clients c
    where c.id = client_documents.client_id and c.firm_id = public.current_firm_id()
  ));

drop policy if exists message_outbox_all on public.message_outbox;
create policy message_outbox_all on public.message_outbox
  for all to authenticated
  using (firm_id = public.current_firm_id())
  with check (firm_id = public.current_firm_id());


-- ---------------------------------------------------------------------------
-- Reporting views used by the Advisor Hub
-- ---------------------------------------------------------------------------
create or replace view public.v_pipeline_board
with (security_invoker = true) as
select
  tp.id                as tax_period_id,
  tp.client_id,
  c.firm_id,
  c.business_name,
  c.tin,
  c.vat_registered,
  tp.period_month,
  tp.tax_type,
  tp.status,
  tp.rra_doc_id,
  tp.tax_due_rwf,
  coalesce(
    tp.due_date,
    (date_trunc('month', to_date(tp.period_month, 'YYYY-MM')) + interval '1 month 14 days')::date
  ) as effective_due_date,
  tp.stage_updated_at,
  coalesce(ar.error_rows, 0)   as annexure_error_rows,
  coalesce(ar.warning_rows, 0) as annexure_warning_rows,
  coalesce(ri.risk_items, 0)   as reconciliation_risk_items
from public.tax_periods tp
join public.clients c on c.id = tp.client_id
left join lateral (
  select
    count(*) filter (where validation_status = 'ERROR')   as error_rows,
    count(*) filter (where validation_status = 'WARNING') as warning_rows
  from public.annexure_rows r where r.tax_period_id = tp.id
) ar on true
left join lateral (
  select count(*) as risk_items
  from public.reconciliation_items r
  where r.tax_period_id = tp.id
    and r.match_status in ('UNINVOICED_REVENUE_RISK', 'MISSING_EBM_PURCHASE')
) ri on true;

grant select on public.v_pipeline_board to authenticated;

-- ---------------------------------------------------------------------------
-- Seed demo firm (development convenience — remove in production)
-- ---------------------------------------------------------------------------
insert into public.firms (id, name, tin, subscription_tier)
values ('11111111-1111-4111-8111-111111111111', 'Kigali Tax Partners Ltd', '102345678', 'PRACTICE')
on conflict (id) do nothing;

