-- ============================================================================
-- TaxOps Rwanda — development seed
-- Populates the demo firm with a realistic Kigali SME book and one month of
-- pipeline cards. Safe to re-run (upserts on natural keys).
-- ============================================================================

insert into public.firms (id, name, tin, subscription_tier)
values ('11111111-1111-4111-8111-111111111111', 'Kigali Tax Partners Ltd', '102345678', 'PRACTICE')
on conflict (id) do update set name = excluded.name;

insert into public.clients (id, firm_id, business_name, tin, tax_regime, vat_registered, whatsapp_phone, contact_name)
values
  ('22222222-2222-4222-8222-222222220001', '11111111-1111-4111-8111-111111111111', 'Nyamirambo Fresh Foods Ltd', '102345678', 'REAL', true, '+250788111001', 'Aline Uwase'),
  ('22222222-2222-4222-8222-222222220002', '11111111-1111-4111-8111-111111111111', 'Gasabo Hardware Supplies', '103456789', 'REAL', true, '+250788111002', 'Eric Mugisha'),
  ('22222222-2222-4222-8222-222222220003', '11111111-1111-4111-8111-111111111111', 'Kicukiro Beauty Studio', '104567890', 'LUMP_SUM', false, '+250788111003', 'Diane Ingabire'),
  ('22222222-2222-4222-8222-222222220004', '11111111-1111-4111-8111-111111111111', 'Remera Auto Garage', '105678901', 'REAL', true, '+250788111004', 'Patrick Nkurunziza'),
  ('22222222-2222-4222-8222-222222220005', '11111111-1111-4111-8111-111111111111', 'Huye Coffee Traders', '106789012', 'REAL', true, '+250788111005', 'Claudine Mukamana'),
  ('22222222-2222-4222-8222-222222220006', '11111111-1111-4111-8111-111111111111', 'Musanze Guest House', '107890123', 'FLAT', false, '+250788111006', 'Jean Bosco Habimana'),
  ('22222222-2222-4222-8222-222222220007', '11111111-1111-4111-8111-111111111111', 'Gikondo Logistics Ltd', '108901234', 'REAL', true, '+250788111007', 'Sandrine Uwera'),
  ('22222222-2222-4222-8222-222222220008', '11111111-1111-4111-8111-111111111111', 'Nyarugenge Pharmacy', '109012345', 'REAL', true, '+250788111008', 'Emmanuel Rukundo')
on conflict (firm_id, tin) do nothing;

-- Current-month VAT pipeline. Period is derived from now() so the seed is
-- portable across psql and the Supabase SQL editor.
with period as (
  select to_char(now(), 'YYYY-MM') as m
),
due as (
  select (date_trunc('month', now()) + interval '1 month 14 days')::date as d
)
insert into public.tax_periods (client_id, period_month, tax_type, status, rra_doc_id, tax_due_rwf, due_date)
select v.client_id, p.m, v.tax_type::public.tax_type, v.status::public.tax_period_status,
       v.rra_doc_id, v.tax_due_rwf, d.d
from (
  values
    ('22222222-2222-4222-8222-222222220001'::uuid, 'VAT', 'RECONCILING',    null,                 null::bigint),
    ('22222222-2222-4222-8222-222222220002'::uuid, 'VAT', 'ANNEXURE_READY', null,                 1842300::bigint),
    ('22222222-2222-4222-8222-222222220003'::uuid, 'VAT', 'WAITING_DOCS',   null,                 null::bigint),
    ('22222222-2222-4222-8222-222222220004'::uuid, 'VAT', 'DECLARED',       'RRA-2026-0041782',   967450::bigint),
    ('22222222-2222-4222-8222-222222220005'::uuid, 'VAT', 'PAID',           'RRA-2026-0041090',   2210800::bigint),
    ('22222222-2222-4222-8222-222222220006'::uuid, 'WHT', 'WAITING_DOCS',   null,                 null::bigint),
    ('22222222-2222-4222-8222-222222220007'::uuid, 'VAT', 'RECONCILING',    null,                 null::bigint),
    ('22222222-2222-4222-8222-222222220008'::uuid, 'VAT', 'ANNEXURE_READY', null,                 431900::bigint)
) as v(client_id, tax_type, status, rra_doc_id, tax_due_rwf)
cross join period p
cross join due d
on conflict (client_id, period_month, tax_type) do nothing;

