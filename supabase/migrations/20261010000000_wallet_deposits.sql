-- TARGETORSTAKE manual UPI deposits (no payment-provider webhook).
-- Apply to the SAME Supabase project used by the deployed app.
create table if not exists public.wallet_deposits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount_rupees integer not null check (amount_rupees between 10 and 50000),
  amount_paise bigint not null check (amount_paise = amount_rupees::bigint * 100),
  status text not null default 'pending' check (status in ('pending','credited','failed')),
  provider text not null default 'manual_upi',
  provider_payment_link_id text unique,
  provider_payment_id text,
  created_at timestamptz not null default now(),
  credited_at timestamptz
);

create index if not exists wallet_deposits_user_created_idx
  on public.wallet_deposits(user_id, created_at desc);

alter table public.wallet_deposits enable row level security;
drop policy if exists "Users can read their own wallet deposits" on public.wallet_deposits;
create policy "Users can read their own wallet deposits"
  on public.wallet_deposits for select to authenticated
  using (auth.uid() = user_id);

revoke all on public.wallet_deposits from anon, authenticated;
grant select on public.wallet_deposits to authenticated;
grant all on public.wallet_deposits to service_role;
