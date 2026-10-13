create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_player_id text;
  v_username text;
begin
  v_player_id := 'RJ' || upper(substr(replace(new.id::text, '-', ''), 1, 8));
  v_username := coalesce(
    nullif(new.raw_user_meta_data->>'username', ''),
    v_player_id
  );

  insert into public.profiles (id, player_id, username)
  values (new.id, v_player_id, v_username);

  -- Grant the welcome coins once, during account creation.
  insert into public.wallets (user_id, balance)
  values (new.id, 100);

  insert into public.wallet_transactions (
    user_id, amount, balance_after, transaction_type, description
  )
  values (
    new.id, 100, 100, 'signup_bonus',
    'Welcome bonus: 100 coins credited on signup'
  );

  return new;
end;
$function$;
