-- Fix RLS checks for admin QR uploads and QR metadata inserts.
-- Uses a SECURITY DEFINER helper so the wallet_admins lookup is not blocked by that table's own RLS.
create or replace function public.is_wallet_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.wallet_admins where user_id = auth.uid()
  );
$$;
revoke all on function public.is_wallet_admin() from public, anon;
grant execute on function public.is_wallet_admin() to authenticated;

drop policy if exists "Admins manage host deposit QR list" on public.wallet_deposit_qrs;
create policy "Admins manage host deposit QR list"
on public.wallet_deposit_qrs
for all to authenticated
using (public.is_wallet_admin())
with check (public.is_wallet_admin());

drop policy if exists "Signed-in users can view active deposit QR entries" on public.wallet_deposit_qrs;
create policy "Signed-in users can view active deposit QR entries"
on public.wallet_deposit_qrs
for select to authenticated
using (active = true);

drop policy if exists "Wallet admins manage multiple host QR images" on storage.objects;
create policy "Wallet admins manage multiple host QR images"
on storage.objects
for all to authenticated
using (
  bucket_id = 'host-deposit-qr'
  and name like 'host/deposit-qrs/%'
  and public.is_wallet_admin()
)
with check (
  bucket_id = 'host-deposit-qr'
  and name like 'host/deposit-qrs/%'
  and public.is_wallet_admin()
);

drop policy if exists "Signed-in users view multiple host QR images" on storage.objects;
create policy "Signed-in users view multiple host QR images"
on storage.objects
for select to authenticated
using (
  bucket_id = 'host-deposit-qr'
  and name like 'host/deposit-qrs/%'
);
