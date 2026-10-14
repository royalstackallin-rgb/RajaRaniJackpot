-- Support multiple host deposit QR codes. One active QR is assigned to each five-minute deposit session.
create table if not exists public.wallet_deposit_qrs (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  storage_path text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);
alter table public.wallet_deposit_qrs enable row level security;
revoke all on public.wallet_deposit_qrs from anon, authenticated;
grant select, insert, update, delete on public.wallet_deposit_qrs to authenticated;

drop policy if exists "Admins manage host deposit QR list" on public.wallet_deposit_qrs;
create policy "Admins manage host deposit QR list" on public.wallet_deposit_qrs
for all to authenticated
using (exists (select 1 from public.wallet_admins where user_id = auth.uid()))
with check (exists (select 1 from public.wallet_admins where user_id = auth.uid()));

drop policy if exists "Signed-in users can view active deposit QR entries" on public.wallet_deposit_qrs;
create policy "Signed-in users can view active deposit QR entries" on public.wallet_deposit_qrs
for select to authenticated using (active = true);

drop policy if exists "Wallet admins manage multiple host QR images" on storage.objects;
create policy "Wallet admins manage multiple host QR images" on storage.objects
for all to authenticated
using (
  bucket_id = 'host-deposit-qr'
  and name like 'host/deposit-qrs/%'
  and exists (select 1 from public.wallet_admins where user_id = auth.uid())
)
with check (
  bucket_id = 'host-deposit-qr'
  and name like 'host/deposit-qrs/%'
  and exists (select 1 from public.wallet_admins where user_id = auth.uid())
);

drop policy if exists "Signed-in users view multiple host QR images" on storage.objects;
create policy "Signed-in users view multiple host QR images" on storage.objects
for select to authenticated using (
  bucket_id = 'host-deposit-qr' and name like 'host/deposit-qrs/%'
);

drop function if exists public.assign_manual_upi_method(integer);
create function public.assign_manual_upi_method(p_amount_rupees integer)
returns table (
  assignment_id uuid,
  assigned_label text,
  assigned_upi_id text,
  amount_rupees integer,
  expires_at timestamptz,
  qr_storage_path text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.wallet_payment_assignments%rowtype;
  v_qr public.wallet_deposit_qrs%rowtype;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  if p_amount_rupees is null or p_amount_rupees < 10 or p_amount_rupees > 50000 then
    raise exception 'Amount must be between 10 and 50000 rupees';
  end if;

  select q.* into v_qr
  from public.wallet_deposit_qrs q
  where q.active = true
  order by random()
  limit 1;

  if v_qr.id is null then
    raise exception 'Host has not configured any active deposit QR yet';
  end if;

  insert into public.wallet_payment_assignments(
    user_id, payment_method_id, assigned_label, assigned_upi_id, amount_rupees, expires_at
  ) values (
    auth.uid(), null, v_qr.label, v_qr.storage_path, p_amount_rupees, now() + interval '5 minutes'
  ) returning * into v_assignment;

  return query select v_assignment.id, v_assignment.assigned_label, v_assignment.assigned_upi_id,
    v_assignment.amount_rupees, v_assignment.expires_at, v_qr.storage_path;
end;
$$;
revoke all on function public.assign_manual_upi_method(integer) from public, anon;
grant execute on function public.assign_manual_upi_method(integer) to authenticated;
