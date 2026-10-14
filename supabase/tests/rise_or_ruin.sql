-- Rise or Ruin smoke/security assertions for Supabase SQL test harness.
begin;
select plan(8);
select has_table('public','rise_ruin_wallets','practice points table exists');
select has_table('public','rise_ruin_runs','runs table exists');
select has_function('public','rise_ruin_start',array[]::text[],'start RPC exists');
select has_function('public','rise_ruin_climb',array['uuid'],'climb RPC exists');
select has_function('public','rise_ruin_cash_out',array['uuid'],'cash out RPC exists');
select ok((select relrowsecurity from pg_class where oid='public.rise_ruin_wallets'::regclass),'wallet RLS enabled');
select ok((select relrowsecurity from pg_class where oid='public.rise_ruin_runs'::regclass),'run RLS enabled');
select ok(not has_table_privilege('anon','public.rise_ruin_wallets','select'),'anon cannot read practice wallet');
select * from finish();
rollback;
