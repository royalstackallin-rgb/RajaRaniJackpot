-- Twin Fortune: fixed, publicly disclosed weighted odds.
-- Weights depend only on a number's final digit, never on player bookings or stakes.
-- Per-number odds range from 0.80% to 1.20%; all 100 probabilities sum to 100%.

create table if not exists public.double_number_odds (
  number text primary key check (number ~ '^[0-9]{2}$'),
  ending_digit smallint not null check (ending_digit between 0 and 9),
  weight integer not null check (weight between 80 and 120),
  probability_percent numeric(6,4) generated always as (weight::numeric / 100) stored
);

insert into public.double_number_odds (number, ending_digit, weight)
select
  lpad(n::text, 2, '0'),
  mod(n, 10)::smallint,
  case mod(n, 10)
    when 0 then 80 when 1 then 85 when 2 then 90 when 3 then 95
    when 4 then 100 when 5 then 100 when 6 then 105 when 7 then 110
    when 8 then 115 when 9 then 120
  end
from generate_series(0, 99) as n
on conflict (number) do update
set ending_digit = excluded.ending_digit, weight = excluded.weight;

alter table public.double_number_odds enable row level security;
drop policy if exists "Anyone can read published Twin Fortune odds" on public.double_number_odds;
create policy "Anyone can read published Twin Fortune odds"
  on public.double_number_odds for select to anon, authenticated using (true);
revoke all on public.double_number_odds from anon, authenticated;
grant select on public.double_number_odds to anon, authenticated;

create or replace function public.draw_double_round(p_round_id uuid)
returns text language plpgsql security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_round public.double_rounds%rowtype;
  v_now timestamp;
  v_round_at timestamp;
  v_winning_number text;
  v_total_weight bigint;
  v_roll bigint;
  v_bytes bytea;
  v_rejection_limit bigint;
begin
  select * into v_round from public.double_rounds where id = p_round_id for update;
  if not found then raise exception 'Twin Fortune round not found'; end if;
  if v_round.status <> 'open' then raise exception 'Twin Fortune round is already drawn or settled'; end if;

  v_now := now() at time zone 'Asia/Kolkata';
  v_round_at := v_round.game_date::timestamp + v_round.round_time;
  if v_now < v_round_at then raise exception 'Draw time has not arrived yet'; end if;

  select sum(weight)::bigint into v_total_weight from public.double_number_odds;
  if v_total_weight is distinct from 10000
     or (select count(*) from public.double_number_odds) <> 100 then
    raise exception 'Published Twin Fortune odds are incomplete or invalid';
  end if;

  v_rejection_limit := (4294967296::bigint / v_total_weight) * v_total_weight;
  loop
    v_bytes := public.gen_random_bytes(4);
    v_roll := get_byte(v_bytes, 0)::bigint * 16777216
            + get_byte(v_bytes, 1)::bigint * 65536
            + get_byte(v_bytes, 2)::bigint * 256
            + get_byte(v_bytes, 3)::bigint;
    exit when v_roll < v_rejection_limit;
  end loop;
  v_roll := v_roll % v_total_weight;

  select weighted.number into v_winning_number
  from (
    select number, sum(weight) over (order by number rows between unbounded preceding and current row) as cumulative_weight
    from public.double_number_odds
  ) as weighted
  where v_roll < weighted.cumulative_weight
  order by weighted.number
  limit 1;

  if v_winning_number is null then raise exception 'Could not select a Twin Fortune winning number'; end if;

  update public.double_rounds
  set winning_number = v_winning_number, status = 'drawn', drawn_at = now()
  where id = p_round_id;
  return v_winning_number;
end;
$function$;

revoke all on function public.draw_double_round(uuid) from public, anon, authenticated;
grant execute on function public.draw_double_round(uuid) to service_role;
