-- Twin Fortune: wager-tier weights based on all players' combined stakes per number.
-- Tier weights are normalized across all 100 numbers to select the result.
-- <=70 => 7; 71-100 => 5; 101-300 => 3; 301-500 => 2; >500 => 1.

create or replace function public.draw_double_round(p_round_id uuid)
returns text
language plpgsql
security definer
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

  with number_stakes as (
    select lpad(g.n::text, 2, '0') as number,
           coalesce(sum(b.stake), 0)::numeric as total_stake
    from generate_series(0, 99) as g(n)
    left join public.double_bookings b
      on b.round_id = p_round_id
     and lpad(b.number, 2, '0') = lpad(g.n::text, 2, '0')
    group by g.n
  ),
  weighted as (
    select number,
      case when total_stake <= 70 then 7
           when total_stake <= 100 then 5
           when total_stake <= 300 then 3
           when total_stake <= 500 then 2
           else 1 end::bigint as weight
    from number_stakes
  )
  select sum(weight)::bigint into v_total_weight from weighted;

  if v_total_weight is null or v_total_weight <= 0 then
    raise exception 'Could not calculate Twin Fortune weights';
  end if;

  -- Secure server-side randomness with rejection sampling to avoid modulo bias.
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

  with number_stakes as (
    select lpad(g.n::text, 2, '0') as number,
           coalesce(sum(b.stake), 0)::numeric as total_stake
    from generate_series(0, 99) as g(n)
    left join public.double_bookings b
      on b.round_id = p_round_id
     and lpad(b.number, 2, '0') = lpad(g.n::text, 2, '0')
    group by g.n
  ),
  weighted as (
    select number,
      case when total_stake <= 70 then 7
           when total_stake <= 100 then 5
           when total_stake <= 300 then 3
           when total_stake <= 500 then 2
           else 1 end::bigint as weight
    from number_stakes
  ),
  cumulative as (
    select number,
           sum(weight) over (order by number rows between unbounded preceding and current row) as cumulative_weight
    from weighted
  )
  select number into v_winning_number
  from cumulative
  where v_roll < cumulative_weight
  order by number
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
