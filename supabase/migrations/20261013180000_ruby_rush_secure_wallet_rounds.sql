-- Server-authoritative Ruby Rush rounds using the existing TARGETORSTAKE wallet.
create table if not exists public.ruby_rush_rounds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stake bigint not null check (stake > 0),
  mine_count integer not null check (mine_count in (2,4,6,8,12)),
  mine_positions integer[] not null,
  revealed_positions integer[] not null default '{}',
  safe_picks integer not null default 0 check (safe_picks >= 0),
  status text not null default 'playing' check (status in ('playing','lost','cashed')),
  payout bigint not null default 0 check (payout >= 0),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check (cardinality(mine_positions) = mine_count)
);
alter table public.ruby_rush_rounds enable row level security;
revoke all on public.ruby_rush_rounds from anon, authenticated;

create or replace function public.ruby_rush_start_round(p_stake bigint, p_mine_count integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  u uuid := auth.uid();
  r public.ruby_rush_rounds%rowtype;
  b bigint;
  m integer[];
begin
  if u is null then raise exception 'Please sign in'; end if;
  if p_stake is null or p_stake < 1 then raise exception 'Stake must be at least 1'; end if;
  if p_mine_count not in (2,4,6,8,12) then raise exception 'Invalid mine count'; end if;
  select balance into b from public.wallets where user_id=u for update;
  if not found then raise exception 'Wallet not found'; end if;
  if b < p_stake then raise exception 'Insufficient wallet balance'; end if;
  select array_agg(tile order by random()) into m
  from (
    select g.tile
    from generate_series(0,24) as g(tile)
    order by random()
    limit p_mine_count
  ) q;
  insert into public.ruby_rush_rounds(user_id,stake,mine_count,mine_positions)
    values(u,p_stake,p_mine_count,m) returning * into r;
  b := public.change_wallet_balance(u,-p_stake,'game_entry','Ruby Rush stake · '||r.id::text);
  return jsonb_build_object('round_id',r.id,'balance',b,'stake',r.stake,'mine_count',r.mine_count);
end $$;

create or replace function public.ruby_rush_reveal_tile(p_round_id uuid,p_tile integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  r public.ruby_rush_rounds%rowtype;
  seen integer[];
  picks integer;
  chance numeric := 1;
  mult numeric;
  i integer;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  if p_tile is null or p_tile<0 or p_tile>24 then raise exception 'Invalid tile'; end if;
  select * into r from public.ruby_rush_rounds where id=p_round_id and user_id=auth.uid() for update;
  if not found then raise exception 'Round not found'; end if;
  if r.status<>'playing' then raise exception 'Round has ended'; end if;
  if p_tile=any(r.revealed_positions) then raise exception 'Tile already revealed'; end if;
  seen := array_append(r.revealed_positions,p_tile);
  if p_tile=any(r.mine_positions) then
    update public.ruby_rush_rounds set revealed_positions=seen,status='lost',finished_at=now() where id=r.id;
    return jsonb_build_object('mine_hit',true,'safe_picks',r.safe_picks,'status','lost','revealed_positions',to_jsonb(seen),'mine_positions',to_jsonb(r.mine_positions));
  end if;
  picks := r.safe_picks+1;
  for i in 0..(picks-1) loop chance := chance*((25-r.mine_count-i)::numeric/(25-i)::numeric); end loop;
  mult := floor((0.97/chance)*100)/100;
  update public.ruby_rush_rounds set revealed_positions=seen,safe_picks=picks where id=r.id;
  return jsonb_build_object('mine_hit',false,'safe_picks',picks,'multiplier',mult,'potential_return',floor(r.stake*mult),'status','playing','revealed_positions',to_jsonb(seen));
end $$;

create or replace function public.ruby_rush_cash_out(p_round_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $
declare
  r public.ruby_rush_rounds%rowtype;
  chance numeric := 1;
  mult numeric;
  paid bigint;
  b bigint;
  i integer;
begin
  if auth.uid() is null then raise exception 'Please sign in'; end if;
  select * into r from public.ruby_rush_rounds where id=p_round_id and user_id=auth.uid() for update;
  if not found then raise exception 'Round not found'; end if;
  if r.status<>'playing' then raise exception 'Round has already ended'; end if;
  if r.safe_picks<1 then raise exception 'Reveal a safe tile before cashing out'; end if;
  for i in 0..(r.safe_picks-1) loop chance := chance*((25-r.mine_count-i)::numeric/(25-i)::numeric); end loop;
  mult := floor((0.97/chance)*100)/100;
  paid := floor(r.stake*mult);
  update public.ruby_rush_rounds set status='cashed',payout=paid,finished_at=now() where id=r.id;
  b := public.change_wallet_balance(r.user_id,paid,'game_payout','Ruby Rush cash-out · '||r.id::text);
  return jsonb_build_object('status','cashed','payout',paid,'multiplier',mult,'balance',b);
end $$;

revoke all on function public.ruby_rush_start_round(bigint,integer) from public,anon;
revoke all on function public.ruby_rush_reveal_tile(uuid,integer) from public,anon;
revoke all on function public.ruby_rush_cash_out(uuid) from public,anon;
grant execute on function public.ruby_rush_start_round(bigint,integer) to authenticated;
grant execute on function public.ruby_rush_reveal_tile(uuid,integer) to authenticated;
grant execute on function public.ruby_rush_cash_out(uuid) to authenticated;
