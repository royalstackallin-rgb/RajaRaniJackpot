-- Host-managed permanent deposit QR with five-minute server-enforced payment sessions.
-- Apply this migration to the SAME Supabase project used by Vercel before deploying the UI.

create table if not exists public.wallet_deposit_settings (
  id integer primary key check (id = 1),
  qr_storage_path text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
insert into public.wallet_deposit_settings(id) values (1) on conflict (id) do nothing;
alter table public.wallet_deposit_settings enable row level security;
revoke all on public.wallet_deposit_settings from anon, authenticated;
grant select on public.wallet_deposit_settings to authenticated;
drop policy if exists "Signed-in users can view deposit QR setting" on public.wallet_deposit_settings;
create policy "Signed-in users can view deposit QR setting"
  on public.wallet_deposit_settings for select to authenticated using (true);
drop policy if exists "Wallet admins update deposit QR setting" on public.wallet_deposit_settings;
create policy "Wallet admins update deposit QR setting"
  on public.wallet_deposit_settings for update to authenticated
  using (exists (select 1 from public.wallet_admins where user_id = auth.uid()))
  with check (exists (select 1 from public.wallet_admins where user_id = auth.uid()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('host-deposit-qr', 'host-deposit-qr', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "Wallet admins upload host deposit QR" on storage.objects;
create policy "Wallet admins upload host deposit QR" on storage.objects
for insert to authenticated with check (
  bucket_id = 'host-deposit-qr'
  and name = 'host/deposit-qr'
  and exists (select 1 from public.wallet_admins where user_id = auth.uid())
);
drop policy if exists "Wallet admins update host deposit QR" on storage.objects;
create policy "Wallet admins update host deposit QR" on storage.objects
for update to authenticated using (
  bucket_id = 'host-deposit-qr'
  and name = 'host/deposit-qr'
  and exists (select 1 from public.wallet_admins where user_id = auth.uid())
) with check (
  bucket_id = 'host-deposit-qr'
  and name = 'host/deposit-qr'
  and exists (select 1 from public.wallet_admins where user_id = auth.uid())
);
drop policy if exists "Signed-in users view host deposit QR" on storage.objects;
create policy "Signed-in users view host deposit QR" on storage.objects
for select to authenticated using (
  bucket_id = 'host-deposit-qr'
  and name = 'host/deposit-qr'
);

-- Reuse the existing secure assignment/submission flow, but expire each QR session after 5 minutes.
-- The assignment is not a UPI ID; it binds the requested amount and deadline to the host's saved QR.
alter table public.wallet_payment_assignments
  alter column expires_at set default (now() + interval '5 minutes');

create or replace function public.assign_manual_upi_method(p_amount_rupees integer)
returns table (assignment_id uuid, assigned_label text, assigned_upi_id text, amount_rupees integer, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.wallet_payment_assignments%rowtype;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  if p_amount_rupees is null or p_amount_rupees < 10 or p_amount_rupees > 50000 then
    raise exception 'Amount must be between 10 and 50000 rupees';
  end if;
  if not exists (select 1 from public.wallet_deposit_settings where id = 1 and qr_storage_path is not null)
     or not exists (select 1 from storage.objects where bucket_id = 'host-deposit-qr' and name = 'host/deposit-qr') then
    raise exception 'Host has not configured a deposit QR yet';
  end if;

  insert into public.wallet_payment_assignments(
    user_id, payment_method_id, assigned_label, assigned_upi_id, amount_rupees, expires_at
  ) values (
    auth.uid(), null, 'Host QR payment', 'Host QR payment', p_amount_rupees, now() + interval '5 minutes'
  ) returning * into v_assignment;

  return query select v_assignment.id, v_assignment.assigned_label, v_assignment.assigned_upi_id,
    v_assignment.amount_rupees, v_assignment.expires_at;
end;
$$;
revoke all on function public.assign_manual_upi_method(integer) from public, anon;
grant execute on function public.assign_manual_upi_method(integer) to authenticated;
