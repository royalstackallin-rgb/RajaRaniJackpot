-- Secure withdrawal reservation and review workflow.
-- No cash payouts are executed by these functions.

create or replace function public.create_withdrawal_request(
  p_amount_rupees bigint,
  p_qr_storage_path text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_request_id uuid;
  v_balance bigint;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_amount_rupees is null
     or p_amount_rupees < 200
     or p_amount_rupees > 50000 then
    raise exception 'Request must be between 200 and 50000';
  end if;

  if p_qr_storage_path is null
     or left(p_qr_storage_path, length(v_user_id::text) + 1)
        <> v_user_id::text || '/' then
    raise exception 'Invalid QR storage path';
  end if;

  if not exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'withdrawal-qr-codes'
      and o.name = p_qr_storage_path
      and o.owner_id = v_user_id::text
      and lower(coalesce(o.metadata ->> 'mimetype', '')) in (
        'image/jpeg', 'image/png', 'image/webp'
      )
  ) then
    raise exception 'QR image not found, not owned by user, or unsupported image type';
  end if;

  update public.wallets
     set balance = balance - p_amount_rupees,
         updated_at = now()
   where user_id = v_user_id
     and balance >= p_amount_rupees
  returning balance into v_balance;

  if not found then
    raise exception 'Wallet not found or insufficient balance';
  end if;

  insert into public.withdrawal_requests (
    user_id, amount_rupees, qr_storage_path
  )
  values (
    v_user_id, p_amount_rupees, p_qr_storage_path
  )
  returning id into v_request_id;

  insert into public.wallet_transactions (
    user_id, amount, balance_after, transaction_type, description
  )
  values (
    v_user_id, -p_amount_rupees, v_balance,
    'withdrawal_reserve', 'Coins reserved for withdrawal request ' || v_request_id::text
  );

  return v_request_id;
end;
$function$;

revoke all on function public.create_withdrawal_request(bigint, text)
  from public, anon;
grant execute on function public.create_withdrawal_request(bigint, text)
  to authenticated;


create or replace function public.review_withdrawal_request(
  p_request_id uuid,
  p_approve boolean,
  p_note text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_request public.withdrawal_requests%rowtype;
  v_admin_id uuid := auth.uid();
  v_balance bigint;
begin
  if v_admin_id is null or not exists (
    select 1
    from public.wallet_admins wa
    where wa.user_id = v_admin_id
  ) then
    raise exception 'Not authorized to review withdrawal requests';
  end if;

  select *
    into v_request
    from public.withdrawal_requests
   where id = p_request_id
   for update;

  if not found then
    raise exception 'Withdrawal request not found';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Request has already been reviewed';
  end if;

  if p_approve then
    update public.withdrawal_requests
       set status = 'approved_for_review',
           admin_note = left(p_note, 1000),
           reviewed_by = v_admin_id,
           reviewed_at = now(),
           updated_at = now()
     where id = p_request_id;

    return 'approved_for_review';
  end if;

  update public.wallets
     set balance = balance + v_request.amount_rupees,
         updated_at = now()
   where user_id = v_request.user_id
  returning balance into v_balance;

  if not found then
    raise exception 'Wallet not found; refund cancelled';
  end if;

  insert into public.wallet_transactions (
    user_id, amount, balance_after, transaction_type, description
  )
  values (
    v_request.user_id, v_request.amount_rupees, v_balance,
    'withdrawal_refund', 'Refund for rejected withdrawal request ' || p_request_id::text
  );

  update public.withdrawal_requests
     set status = 'rejected',
         admin_note = left(p_note, 1000),
         reviewed_by = v_admin_id,
         reviewed_at = now(),
         updated_at = now()
   where id = p_request_id;

  return 'rejected';
end;
$function$;

revoke all on function public.review_withdrawal_request(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.review_withdrawal_request(uuid, boolean, text)
  to authenticated;
