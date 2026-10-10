-- Allow authenticated designated admins to review all manual deposit requests.
drop policy if exists "Admins can review manual wallet deposits" on public.wallet_deposits;
create policy "Admins can review manual wallet deposits" on public.wallet_deposits
  for select to authenticated
  using (exists (select 1 from public.wallet_admins where user_id = auth.uid()));
