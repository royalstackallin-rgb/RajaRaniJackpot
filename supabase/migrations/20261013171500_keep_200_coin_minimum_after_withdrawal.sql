create or replace function public.create_withdrawal_request(p_amount_rupees bigint, p_qr_storage_path text)
returns uuid
language plpgsql
security definer
set search_path to ''
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
    raise exception 'Withdrawal must be at least 200 and no more than 50000';
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
     and balance >= p_amount_rupees + 200
  returning balance into v_balance;

  if not found then
    raise exception 'Insufficient balance: withdrawal must leave at least 200 coins in your wallet';
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
    'withdrawal_reserve',
    'Coins reserved for withdrawal request ' || v_request_id::text
  );

  return v_request_id;
end;
$function$;
