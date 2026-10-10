-- Multiple host-managed UPI receiving accounts and random assignment.
-- Apply only after 20261010000000_wallet_deposits.sql and 20261010010000_manual_wallet_deposits.sql.
create table if not exists public.wallet_payment_methods (
  id uuid primary key default gen_random_uuid(),
  label text not null check (length(trim(label)) between 1 and 60),
  upi_id text not null check (length(trim(upi_id)) between 3 and 255),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.wallet_payment_methods enable row level security;
revoke all on public.wallet_payment_methods from anon, authenticated;
grant select, insert, update, delete on public.wallet_payment_methods to authenticated;

drop policy if exists "Signed-in users can view active payment methods" on public.wallet_payment_methods;
create policy "Signed-in users can view active payment methods"
  on public.wallet_payment_methods for select to authenticated
  using (active = true or exists (
    select 1 from public.wallet_admins where user_id = auth.uid()
  ));

drop policy if exists "Wallet admins manage payment methods" on public.wallet_payment_methods;
create policy "Wallet admins manage payment methods"
  on public.wallet_payment_methods for all to authenticated
  using (exists (select 1 from public.wallet_admins where user_id = auth.uid()))
  with check (exists (select 1 from public.wallet_admins where user_id = auth.uid()));

alter table public.wallet_deposits
  add column if not exists assigned_payment_method_id uuid references public.wallet_payment_methods(id) on delete set null,
  add column if not exists assigned_upi_id text;

create index if not exists wallet_deposits_unique_manual_reference
  on public.wallet_deposits (lower(btrim(payment_reference)))
  where provider = 'manual_upi'
    and payment_reference is not null
    and btrim(payment_reference) <> '';

create or replace function public.review_manual_wallet_deposit(
  p_deposit_id uuid,
  p_approve boolean,
  p_note text default null
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deposit public.wallet_deposits%rowtype;
begin
  if not exists (select 1 from public.wallet_admins where user_id = auth.uid()) then
    raise exception 'Not authorized to review deposits';
  end if;

  select * into v_deposit
  from public.wallet_deposits
  where id = p_deposit_id and provider = 'manual_upi'
  for update;

  if not found then raise exception 'Deposit request not found'; end if;
  if v_deposit.status <> 'pending' then raise exception 'Request has already been reviewed'; end if;

  if p_approve then
    if nullif(trim(coalesce(v_deposit.payment_reference, '')), '') is null then
      raise exception 'Payment reference is missing';
    end if;
    perform public.change_wallet_balance(
      v_deposit.user_id,
      v_deposit.amount_rupees::bigint,
      'host_add',
      'Host-approved UPI deposit ' || v_deposit.id::text
    );
    update public.wallet_deposits
      set status = 'credited', reviewed_by = auth.uid(),
          reviewed_at = now(), credited_at = now(), review_note = p_note
      where id = p_deposit_id;
    return 'credited';
  else
    update public.wallet_deposits
      set status = 'failed', reviewed_by = auth.uid(),
          reviewed_at = now(), review_note = p_note
      where id = p_deposit_id;
    return 'rejected';
  end if;
end;
$$;
revoke all on function public.review_manual_wallet_deposit(uuid,boolean,text) from public, anon;
grant execute on function public.review_manual_wallet_deposit(uuid,boolean,text) to authenticated;
