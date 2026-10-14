-- Rise or Ruin: isolated practice points and server-authoritative runs.
-- Supabase commonly installs pgcrypto in the extensions schema; qualify its function below.
create table if not exists public.rise_ruin_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 100 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rise_ruin_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stake integer not null default 100 check (stake = 100),
  step integer not null default 0 check (step >= 0 and step <= 10),
  status text not null default 'rising' check (status in ('rising','ruined','cashed_out')),
  payout integer not null default 0 check (payout >= 0),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists rise_ruin_runs_user_created_idx on public.rise_ruin_runs(user_id, created_at desc);

alter table public.rise_ruin_wallets enable row level security;
alter table public.rise_ruin_runs enable row level security;
revoke all on public.rise_ruin_wallets from anon, authenticated;
revoke all on public.rise_ruin_runs from anon, authenticated;
grant select on public.rise_ruin_wallets, public.rise_ruin_runs to authenticated;
drop policy if exists "Players read own Rise or Ruin points" on public.rise_ruin_wallets;
drop policy if exists "Players read own Rise or Ruin runs" on public.rise_ruin_runs;
create policy "Players read own Rise or Ruin points" on public.rise_ruin_wallets for select to authenticated using ((select auth.uid()) = user_id);
create policy "Players read own Rise or Ruin runs" on public.rise_ruin_runs for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.rise_ruin_start()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_balance integer;
  v_run public.rise_ruin_runs%rowtype;
begin
  if v_user is null then raise exception 'Please sign in'; end if;
  insert into public.rise_ruin_wallets(user_id, balance) values (v_user, 100) on conflict (user_id) do nothing;
  select balance into v_balance from public.rise_ruin_wallets where user_id = v_user for update;
  if exists (select 1 from public.rise_ruin_runs where user_id=v_user and status='rising') then raise exception 'Finish your current Rise or Ruin run first'; end if;
  if v_balance < 100 then
    update public.rise_ruin_wallets set balance=100, updated_at=pg_catalog.now() where user_id=v_user returning balance into v_balance;
  end if;
  update public.rise_ruin_wallets set balance=balance-100, updated_at=pg_catalog.now() where user_id=v_user returning balance into v_balance;
  insert into public.rise_ruin_runs(user_id, stake) values (v_user,100) returning * into v_run;
  return pg_catalog.jsonb_build_object('run_id',v_run.id,'step',v_run.step,'status',v_run.status,'stake',v_run.stake,'balance',v_balance,'multiplier',1.00);
end;
$$;

create or replace function public.rise_ruin_climb(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_run public.rise_ruin_runs%rowtype;
  v_byte integer;
  v_step integer;
  v_multiplier numeric;
  v_balance integer;
begin
  if v_user is null then raise exception 'Please sign in'; end if;
  select * into v_run from public.rise_ruin_runs where id=p_run_id and user_id=v_user for update;
  if not found then raise exception 'Run not found'; end if;
  if v_run.status <> 'rising' then raise exception 'This run has already ended'; end if;
  if v_run.step >= 10 then raise exception 'Maximum tower height reached; cash out now'; end if;
  -- Rejection sampling gives an unbiased 80% safe / 20% crash result.
  loop
    v_byte := pg_catalog.get_byte(extensions.gen_random_bytes(1),0);
    exit when v_byte < 240;
  end loop;
  if v_byte >= 192 then
    update public.rise_ruin_runs set status='ruined', finished_at=pg_catalog.now() where id=v_run.id;
    select balance into v_balance from public.rise_ruin_wallets where user_id=v_user;
    return pg_catalog.jsonb_build_object('safe',false,'status','ruined','step',v_run.step,'balance',v_balance,'multiplier',round(power(1.2::numeric,v_run.step),2),'payout',0);
  end if;
  v_step := v_run.step + 1;
  v_multiplier := round(power(1.2::numeric,v_step),2);
  update public.rise_ruin_runs set step=v_step where id=v_run.id;
  select balance into v_balance from public.rise_ruin_wallets where user_id=v_user;
  return pg_catalog.jsonb_build_object('safe',true,'status','rising','step',v_step,'balance',v_balance,'multiplier',v_multiplier,'potential_payout',floor(100*v_multiplier)::integer);
end;
$$;

create or replace function public.rise_ruin_cash_out(p_run_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_run public.rise_ruin_runs%rowtype;
  v_payout integer;
  v_balance integer;
begin
  if v_user is null then raise exception 'Please sign in'; end if;
  select * into v_run from public.rise_ruin_runs where id=p_run_id and user_id=v_user for update;
  if not found then raise exception 'Run not found'; end if;
  if v_run.status <> 'rising' then raise exception 'This run has already ended'; end if;
  if v_run.step < 1 then raise exception 'Climb at least one step before cashing out'; end if;
  v_payout := floor(v_run.stake * power(1.2::numeric,v_run.step))::integer;
  update public.rise_ruin_runs set status='cashed_out', payout=v_payout, finished_at=pg_catalog.now() where id=v_run.id;
  update public.rise_ruin_wallets set balance=balance+v_payout, updated_at=pg_catalog.now() where user_id=v_user returning balance into v_balance;
  return pg_catalog.jsonb_build_object('status','cashed_out','step',v_run.step,'payout',v_payout,'balance',v_balance,'multiplier',round(power(1.2::numeric,v_run.step),2));
end;
$$;

revoke all on function public.rise_ruin_start() from public, anon;
revoke all on function public.rise_ruin_climb(uuid) from public, anon;
revoke all on function public.rise_ruin_cash_out(uuid) from public, anon;
grant execute on function public.rise_ruin_start() to authenticated;
grant execute on function public.rise_ruin_climb(uuid) to authenticated;
grant execute on function public.rise_ruin_cash_out(uuid) to authenticated;
