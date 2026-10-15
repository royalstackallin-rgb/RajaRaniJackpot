-- Return the actual QR image path selected from the host QR manager.
-- The wallet frontend signs this path to display the QR for the payment session.
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
as $function$
declare
  v_assignment public.wallet_payment_assignments%rowtype;
  v_qr public.wallet_deposit_qrs%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Please sign in';
  end if;

  if p_amount_rupees is null or p_amount_rupees < 10 or p_amount_rupees > 50000 then
    raise exception 'Amount must be between 10 and 50000 rupees';
  end if;

  select q.*
    into v_qr
  from public.wallet_deposit_qrs q
  where q.active = true
    and exists (
      select 1
      from storage.objects o
      where o.bucket_id = 'host-deposit-qr'
        and o.name = q.storage_path
    )
  order by random()
  limit 1;

  if not found then
    raise exception 'No active host deposit QR is available. Please contact the host';
  end if;

  insert into public.wallet_payment_assignments (
    user_id, payment_method_id, assigned_label, assigned_upi_id,
    amount_rupees, expires_at
  ) values (
    auth.uid(), null, v_qr.label, 'Host QR payment',
    p_amount_rupees, now() + interval '5 minutes'
  )
  returning * into v_assignment;

  return query
    select v_assignment.id, v_qr.label, v_assignment.assigned_upi_id,
           v_assignment.amount_rupees, v_assignment.expires_at, v_qr.storage_path;
end;
$function$;

revoke all on function public.assign_manual_upi_method(integer) from public, anon;
grant execute on function public.assign_manual_upi_method(integer) to authenticated, service_role;
