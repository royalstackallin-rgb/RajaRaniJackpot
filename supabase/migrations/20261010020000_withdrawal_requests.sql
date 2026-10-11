-- Request-only withdrawal workflow.
-- No balance deductions or cash payouts are enabled.

create table if not exists public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount_rupees bigint not null check (amount_rupees between 200 and 50000),
  qr_storage_path text not null check (length(qr_storage_path) > 0),
  status text not null default 'pending'
    check (status in ('pending', 'approved_for_review', 'rejected')),
  admin_note text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists withdrawal_requests_user_created_idx
  on public.withdrawal_requests (user_id, created_at desc);

create index if not exists withdrawal_requests_status_created_idx
  on public.withdrawal_requests (status, created_at);

alter table public.withdrawal_requests enable row level security;

drop policy if exists "Users read own withdrawal requests" on public.withdrawal_requests;
create policy "Users read own withdrawal requests"
  on public.withdrawal_requests
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Wallet admins read withdrawal requests" on public.withdrawal_requests;
create policy "Wallet admins read withdrawal requests"
  on public.withdrawal_requests
  for select to authenticated
  using (
    exists (
      select 1 from public.wallet_admins wa
      where wa.user_id = auth.uid()
    )
  );

revoke all on public.withdrawal_requests from anon, authenticated;
grant select on public.withdrawal_requests to authenticated;
