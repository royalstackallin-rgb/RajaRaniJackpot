-- TARGETORSTAKE verified UPI deposits.
-- Apply to the SAME Supabase project used by the deployed app.
create table if not exists public.wallet_deposits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount_rupees integer not null check (amount_rupees between 10 and 50000),
  amount_paise bigint not null check (amount_paise = amount_rupees::bigint * 100),
  status text not null default 'pending' check (status in ('pending','credited','failed')),
  provider text not null default 'razorpay',
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

-- Only the signed Razorpay webhook's server-side function may call this.
create or replace function public.credit_verified_wallet_deposit(
  p_deposit_id uuid,
  p_payment_link_id text,
  p_amount_paid_paise bigint,
  p_payment_id text default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deposit public.wallet_deposits%rowtype;
begin
  select * into v_deposit
  from public.wallet_deposits
  where id = p_deposit_id
  for update;

  if not found then
    raise exception 'Deposit not found';
  end if;

  if v_deposit.provider_payment_link_id is distinct from p_payment_link_id then
    raise exception 'Payment link mismatch';
  end if;

  if v_deposit.amount_paise <> p_amount_paid_paise then
    raise exception 'Paid amount mismatch';
  end if;

  if v_deposit.status = 'credited' then
    return 'already_credited';
  end if;

  if v_deposit.status <> 'pending' then
    raise exception 'Deposit is not pending';
  end if;

  -- Existing wallet ledger routine performs the balance and transaction-log update.
  perform public.change_wallet_balance(
    v_deposit.user_id,
    v_deposit.amount_rupees::bigint,
    'host_add',
    'Verified Razorpay UPI deposit ' || v_deposit.id::text
  );

  update public.wallet_deposits
  set status = 'credited',
      provider_payment_id = p_payment_id,
      credited_at = now()
  where id = v_deposit.id;

  return 'credited';
end;
$$;

revoke all on function public.credit_verified_wallet_deposit(uuid,text,bigint,text) from public, anon, authenticated;
grant execute on function public.credit_verified_wallet_deposit(uuid,text,bigint,text) to service_role;
