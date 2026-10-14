-- Guarantee exactly one winning number in every Twin Fortune round.
-- Stake tiers are relative weights; actual per-number probability is
-- weight / sum of weights across all 100 numbers.
create or replace function public.draw_double_round(p_round_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_catalog
as $function$
declare
  r public.double_rounds%rowtype;
  v_now timestamp;
  v_at timestamp;
  v_roll bigint;
  v_bytes bytea;
  v_limit bigint;
  v_total bigint;
  v_win text;
begin
  select * into r
  from public.double_rounds
  where id = p_round_id
  for update;

  if not found then
    raise exception 'Twin Fortune round not found';
  end if;
  if r.status <> 'open' then
    raise exception 'Twin Fortune round is already drawn or settled';
  end if;

  v_now := now() at time zone 'Asia/Kolkata';
  v_at := r.game_date::timestamp + r.round_time;
  if v_now < v_at then
    raise exception 'Draw time has not arrived yet';
  end if;

  with stakes as (
    select
      g.n,
      lpad(g.n::text, 2, '0') as number,
      coalesce(sum(b.stake), 0)::numeric as stake
    from generate_series(0, 99) as g(n)
    left join public.double_bookings b
      on b.round_id = p_round_id
     and b.status = 'pending'
     and lpad(b.number, 2, '0') = lpad(g.n::text, 2, '0')
    group by g.n
  ),
  weighted as (
    select
      n,
      number,
      case
        when stake = 0 then 100
        when stake <= 70 then 70
        when stake <= 100 then 50
        when stake <= 300 then 30
        when stake <= 500 then 20
        else 10
      end::bigint as weight
    from stakes
  )
  select sum(weight)::bigint
    into v_total
  from weighted;

  if v_total is null or v_total <= 0 then
    raise exception 'Twin Fortune has no eligible winning number';
  end if;

  -- Rejection sampling avoids modulo bias while retaining secure randomness.
  v_limit := (4294967296::bigint / v_total) * v_total;
  loop
    v_bytes := extensions.gen_random_bytes(4);
    v_roll := get_byte(v_bytes, 0)::bigint * 16777216
            + get_byte(v_bytes, 1)::bigint * 65536
            + get_byte(v_bytes, 2)::bigint * 256
            + get_byte(v_bytes, 3)::bigint;
    exit when v_roll < v_limit;
  end loop;
  v_roll := v_roll % v_total;

  with stakes as (
    select
      g.n,
      lpad(g.n::text, 2, '0') as number,
      coalesce(sum(b.stake), 0)::numeric as stake
    from generate_series(0, 99) as g(n)
    left join public.double_bookings b
      on b.round_id = p_round_id
     and b.status = 'pending'
     and lpad(b.number, 2, '0') = lpad(g.n::text, 2, '0')
    group by g.n
  ),
  weighted as (
    select
      n,
      number,
      case
        when stake = 0 then 100
        when stake <= 70 then 70
        when stake <= 100 then 50
        when stake <= 300 then 30
        when stake <= 500 then 20
        else 10
      end::bigint as weight
    from stakes
  ),
  intervals as (
    select
      number,
      sum(weight) over (order by n) as upper_slot,
      sum(weight) over (order by n) - weight as lower_slot
    from weighted
  )
  select number
    into v_win
  from intervals
  where v_roll >= lower_slot
    and v_roll < upper_slot
  order by number
  limit 1;

  if v_win is null then
    raise exception 'Twin Fortune weighted draw failed';
  end if;

  update public.double_rounds
  set winning_number = v_win,
      status = 'drawn',
      drawn_at = now()
  where id = p_round_id;

  return v_win;
end;
$function$;

revoke all on function public.draw_double_round(uuid) from public, anon, authenticated;
grant execute on function public.draw_double_round(uuid) to service_role;
