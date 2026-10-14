-- Remove the automatic 100-coin signup bonus.
-- New users still receive their profile and wallet, but the wallet starts at zero.
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

  insert into public.wallets (user_id, balance)
  values (new.id, 0);

  return new;
end;
$function$;
