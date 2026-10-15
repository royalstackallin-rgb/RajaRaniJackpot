-- Restore the intended authenticated permissions for profile reads/creation/updates.
-- RLS still restricts each user to their own row; no wallet/coin privileges are granted.
grant select, insert, update on table public.profiles to authenticated;

drop policy if exists "Users can create their own profile" on public.profiles;
create policy "Users can create their own profile"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

-- The auth.users trigger creates profiles and wallets as the database owner.
-- Do not grant client roles direct wallet insert/update permissions.
