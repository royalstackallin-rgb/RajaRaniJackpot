-- Twin Fortune: use explicit probabilities, transfer unused probability to
-- zero-stake numbers, and guarantee exactly one winning number.
-- If all 100 numbers are bet, distribute the leftover probability
-- proportionally across their tier probabilities.
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
  v_total constant bigint := 1000000;
  v_bet_probability bigint;
  v_zero_count bigint;
  v_zero_remainder bigint;
  v_assigned bigint;
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
  base as (
    select
      n, number, stake,
      case
        when stake = 0 then 10000::bigint
        when stake < 50 then 5000::bigint
        when stake < 100 then 4000::bigint
        when stake < 300 then 1000::bigint
        when stake < 500 then 500::bigint
        else 100::bigint
      end as base_slots
    from stakes
  )
  select
    coalesce(sum(base_slots) filter (where stake > 0), 0)::bigint,
    count(*) filter (where stake = 0)::bigint
  into v_bet_probability, v_zero_count
  from base;

  v_zero_remainder := v_total - v_bet_probability;

  -- Draw uniformly over one million equally likely slots using secure
  -- random bytes and rejection sampling to avoid modulo bias.
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
  base as (
    select
      n, number, stake,
      case
        when stake = 0 then 10000::bigint
        when stake < 50 then 5000::bigint
        when stake < 100 then 4000::bigint
        when stake < 300 then 1000::bigint
        when stake < 500 then 500::bigint
        else 100::bigint
      end as base_slots
    from stakes
  ),
  totals as (
    select
      coalesce(sum(base_slots) filter (where stake > 0), 0)::bigint as bet_slots,
      count(*) filter (where stake = 0)::bigint as zero_count,
      coalesce(sum(base_slots), 0)::bigint as all_base_slots
    from base
  ),
  allocations as (
    select
      b.n,
      b.number,
      case
        -- Normal case: bet numbers retain exact stated probabilities;
        -- distribute all remaining probability equally across zero-stake numbers.
        when t.zero_count > 0 and b.stake = 0 then
          (v_total - t.bet_slots) / t.zero_count
          + case
              when row_number() over (partition by (b.stake = 0) order by b.n)
                   <= (v_total - t.bet_slots) % t.zero_count
              then 1 else 0
            end
        when t.zero_count > 0 then b.base_slots
        -- All numbers are bet: proportionally allocate the full 100% probability.
        else floor((b.base_slots::numeric * v_total) / nullif(t.all_base_slots, 0))::bigint
      end::bigint as slots
    from base b
    cross join totals t
  ),
  fixed as (
    select
      n,
      number,
      slots + case
        -- Integer rounding correction so intervals cover exactly 100%.
        when (select zero_count from totals) = 0
          and n = (select max(n) from allocations)
          then v_total - (select sum(slots) from allocations)
        else 0
      end as slots
    from allocations
  ),
  intervals as (
    select
      number,
      sum(slots) over (order by n) as upper_slot,
      sum(slots) over (order by n) - slots as lower_slot
    from fixed
  )
  select number
    into v_win
  from intervals
  where v_roll >= lower_slot
    and v_roll < upper_slot
  order by number
  limit 1;

  if v_win is null then
    raise exception 'Twin Fortune probability allocation failed';
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
