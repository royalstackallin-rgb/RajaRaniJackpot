-- Harden manual UPI flow: server-controlled random assignment and request submission.
-- Apply after migrations 20261010000000 through 20261010012000.
create table if not exists public.wallet_payment_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  payment_method_id uuid references public.wallet_payment_methods(id) on delete set null,
  assigned_label text not null,
  assigned_upi_id text not null,
  amount_rupees integer not null check (amount_rupees between 10 and 50000),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  submitted_deposit_id uuid references public.wallet_deposits(id) on delete set null,
  submitted_at timestamptz
);
alter table public.wallet_payment_assignments enable row level security;
revoke all on public.wallet_payment_assignments from anon, authenticated;

-- Random assignment is selected and stored on the server, not by the browser.
create or replace function public.assign_manual_upi_method(p_amount_rupees integer)
returns table (assignment_id uuid, assigned_label text, assigned_upi_id text, amount_rupees integer, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_method public.wallet_payment_methods%rowtype;
  v_assignment public.wallet_payment_assignments%rowtype;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  if p_amount_rupees is null or p_amount_rupees < 10 or p_amount_rupees > 50000 then
    raise exception 'Amount must be between 10 and 50000 rupees';
  end if;
  select * into v_method from public.wallet_payment_methods
    where active = true order by random() limit 1;
  if not found then raise exception 'Deposits are temporarily unavailable'; end if;

  insert into public.wallet_payment_assignments(user_id,payment_method_id,assigned_label,assigned_upi_id,amount_rupees)
  values (auth.uid(),v_method.id,v_method.label,v_method.upi_id,p_amount_rupees)
  returning * into v_assignment;

  return query select v_assignment.id, v_assignment.assigned_label, v_assignment.assigned_upi_id,
    v_assignment.amount_rupees, v_assignment.expires_at;
end;
$$;
revoke all on function public.assign_manual_upi_method(integer) from public, anon;
grant execute on function public.assign_manual_upi_method(integer) to authenticated;

-- Submit request using the server-stored assignment. Merely opening/cancelling UPI creates no host request.
create or replace function public.submit_manual_wallet_deposit(
  p_assignment_id uuid,
  p_payment_reference text,
  p_proof_path text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.wallet_payment_assignments%rowtype;
  v_deposit_id uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  if nullif(trim(coalesce(p_payment_reference,'')), '') is null then
    raise exception 'Payment reference is required';
  end if;
  if length(trim(p_payment_reference)) > 100 then raise exception 'Payment reference is too long'; end if;
  if nullif(trim(coalesce(p_proof_path,'')), '') is null
     or split_part(p_proof_path,'/',1) <> auth.uid()::text then
    raise exception 'Invalid payment proof path';
  end if;

  select * into v_assignment from public.wallet_payment_assignments
    where id = p_assignment_id and user_id = auth.uid() for update;
  if not found then raise exception 'Payment assignment not found'; end if;
  if v_assignment.submitted_at is not null then raise exception 'This assignment has already been submitted'; end if;
  if v_assignment.expires_at < now() then raise exception 'Payment assignment expired. Start again.'; end if;
  if not exists (select 1 from storage.objects where bucket_id = 'wallet-payment-proofs' and name = p_proof_path) then
    raise exception 'Payment screenshot was not uploaded';
  end if;

  insert into public.wallet_deposits(
    user_id,amount_rupees,amount_paise,status,provider,payment_method,payment_reference,proof_path,
    assigned_payment_method_id,assigned_upi_id
  ) values (
    auth.uid(),v_assignment.amount_rupees,v_assignment.amount_rupees::bigint * 100,'pending','manual_upi','UPI',
    trim(p_payment_reference),p_proof_path,v_assignment.payment_method_id,v_assignment.assigned_upi_id
  ) returning id into v_deposit_id;

  update public.wallet_payment_assignments set submitted_deposit_id = v_deposit_id, submitted_at = now()
    where id = v_assignment.id;
  return v_deposit_id;
end;
$$;
revoke all on function public.submit_manual_wallet_deposit(uuid,text,text) from public, anon;
grant execute on function public.submit_manual_wallet_deposit(uuid,text,text) to authenticated;

-- All manual requests must be created through the checked RPC, never direct client inserts.
drop policy if exists "Users can submit own manual deposits" on public.wallet_deposits;
revoke insert on public.wallet_deposits from anon, authenticated;

-- Existing index enforces reference uniqueness. The first migration sequence starts from an empty deposits table.
