-- Twin Fortune exact percentage odds and explicit no-winner outcome.
-- Combined stake per number from all players in this round:
-- ₹0 => 1.00%; ₹1-70 => 0.70%; ₹71-100 => 0.50%;
-- ₹101-300 => 0.30%; ₹301-500 => 0.20%; above ₹500 => 0.10%.
-- Any probability not assigned to a number means the round has no winner.

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
  v_winning_number text := null;
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

  -- 10,000 equally likely slots: each listed percentage is applied exactly.
  -- Rejection sampling avoids modulo bias.
  v_rejection_limit := (4294967296::bigint / 10000) * 10000;
  loop
    v_bytes := public.gen_random_bytes(4);
    v_roll := get_byte(v_bytes, 0)::bigint * 16777216
            + get_byte(v_bytes, 1)::bigint * 65536
            + get_byte(v_bytes, 2)::bigint * 256
            + get_byte(v_bytes, 3)::bigint;
    exit when v_roll < v_rejection_limit;
  end loop;
  v_roll := v_roll % 10000;

  with number_stakes as (
    select g.n, lpad(g.n::text, 2, '0') as number,
           coalesce(sum(b.stake), 0)::numeric as total_stake
    from generate_series(0, 99) as g(n)
    left join public.double_bookings b
      on b.round_id = p_round_id
     and lpad(b.number, 2, '0') = lpad(g.n::text, 2, '0')
    group by g.n
  ),
  probabilities as (
    select n, number,
      case
        when total_stake = 0 then 100 -- 1.00%
        when total_stake <= 70 then 70 -- 0.70%
        when total_stake <= 100 then 50 -- 0.50%
        when total_stake <= 300 then 30 -- 0.30%
        when total_stake <= 500 then 20 -- 0.20%
        else 10 -- 0.10%
      end::bigint as chance_slots
    from number_stakes
  ),
  intervals as (
    select number,
           sum(chance_slots) over (order by n rows between unbounded preceding and current row) as upper_slot,
           sum(chance_slots) over (order by n rows between unbounded preceding and 1 preceding) as lower_slot
    from probabilities
  )
  select number into v_winning_number
  from intervals
  where v_roll >= coalesce(lower_slot, 0) and v_roll < upper_slot
  order by number
  limit 1;

  -- A roll outside all number intervals intentionally yields NULL (no winner).
  update public.double_rounds
  set winning_number = v_winning_number, status = 'drawn', drawn_at = now()
  where id = p_round_id;
  return v_winning_number;
end;
$function$;

create or replace function public.settle_double_round(p_round_id uuid)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_round public.double_rounds%rowtype;
  v_booking record;
  v_payout bigint;
  v_total_payout bigint := 0;
begin
  select * into v_round from public.double_rounds where id = p_round_id for update;
  if not found then raise exception 'Double round not found'; end if;
  if v_round.status <> 'drawn' then raise exception 'Double round is not drawn'; end if;

  -- NULL winning_number means no winner; all pending bookings are losses.
  for v_booking in
    select b.* from public.double_bookings b
    where b.round_id = p_round_id and b.status = 'pending'
    order by b.id for update
  loop
    if v_round.winning_number is not null
       and lpad(v_booking.number, 2, '0') = lpad(v_round.winning_number, 2, '0') then
      v_payout := v_booking.stake * 80;
      update public.double_bookings set status = 'win', payout = v_payout where id = v_booking.id;
      insert into public.double_results (booking_id, round_id, user_id, result, payout)
      values (v_booking.id, p_round_id, v_booking.user_id, 'win', v_payout);
      perform public.change_wallet_balance(
        v_booking.user_id, v_payout, 'game_payout',
        'Twin Fortune win - number ' || v_booking.number || ' - stake ' || v_booking.stake
      );
      v_total_payout := v_total_payout + v_payout;
    else
      update public.double_bookings set status = 'loss', payout = 0 where id = v_booking.id;
      insert into public.double_results (booking_id, round_id, user_id, result, payout)
      values (v_booking.id, p_round_id, v_booking.user_id, 'loss', 0);
    end if;
  end loop;

  update public.double_rounds set status = 'settled', settled_at = now() where id = p_round_id;
  return v_total_payout;
end;
$function$;

revoke all on function public.draw_double_round(uuid) from public, anon, authenticated;
grant execute on function public.draw_double_round(uuid) to service_role;
