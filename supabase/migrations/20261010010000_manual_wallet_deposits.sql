-- Manual UPI deposit requests and secure host approval for TARGETORSTAKE.
-- Run in the SQL Editor of the SAME Supabase project configured in Vercel.
alter table public.wallet_deposits
  alter column provider set default 'manual_upi',
  add column if not exists payment_reference text,
  add column if not exists payment_method text not null default 'UPI',
  add column if not exists proof_path text,
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text;

create table if not exists public.wallet_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.wallet_admins enable row level security;
revoke all on public.wallet_admins from anon, authenticated;
grant select on public.wallet_admins to authenticated;
drop policy if exists "Admins can read their own admin flag" on public.wallet_admins;
create policy "Admins can read their own admin flag" on public.wallet_admins
  for select to authenticated using (auth.uid() = user_id);

-- Private payment-proof bucket. Users can upload only into their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wallet-payment-proofs', 'wallet-payment-proofs', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "Users upload own wallet payment proof" on storage.objects;
create policy "Users upload own wallet payment proof" on storage.objects
for insert to authenticated with check (
  bucket_id = 'wallet-payment-proofs'
  and (storage.foldername(name))[1] = auth.uid()::text
);
drop policy if exists "Users view own wallet payment proof" on storage.objects;
create policy "Users view own wallet payment proof" on storage.objects
for select to authenticated using (
  bucket_id = 'wallet-payment-proofs'
  and (storage.foldername(name))[1] = auth.uid()::text
);
drop policy if exists "Admins view wallet payment proofs" on storage.objects;
create policy "Admins view wallet payment proofs" on storage.objects
for select to authenticated using (
  bucket_id = 'wallet-payment-proofs'
  and exists (select 1 from public.wallet_admins where user_id = auth.uid())
);

-- Players may submit pending requests only. They cannot update or approve them.
drop policy if exists "Users can submit own manual deposits" on public.wallet_deposits;
create policy "Users can submit own manual deposits" on public.wallet_deposits
  for insert to authenticated with check (
    auth.uid() = user_id
    and status = 'pending'
    and amount_rupees between 10 and 50000
    and amount_paise = amount_rupees::bigint * 100
    and provider = 'manual_upi'
  );
grant insert on public.wallet_deposits to authenticated;

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
