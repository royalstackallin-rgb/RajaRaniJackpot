-- StakeClassic: keep the Classic lobby and hourly rounds available 24/7.
-- All timestamps are interpreted in Asia/Kolkata. Existing completed rounds and
-- already-assigned draw methods are preserved; only missing future rounds/methods are added.

CREATE OR REPLACE FUNCTION public.create_daily_rounds(p_game_date date DEFAULT CURRENT_DATE)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_hour integer;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_now time := (now() AT TIME ZONE 'Asia/Kolkata')::time;
BEGIN
  FOR v_hour IN 0..23 LOOP
    -- Do not backfill today's already-past hours as open rounds. That would
    -- cause the minute cron to draw a stack of missed rounds immediately.
    IF p_game_date > v_today OR make_time(v_hour, 0, 0) > v_now THEN
      INSERT INTO public.game_rounds (round_code, game_date, round_time, status)
      VALUES (
        to_char(p_game_date, 'YYYY-MM-DD') || '-' || lpad(v_hour::text, 2, '0') || '00',
        p_game_date,
        make_time(v_hour, 0, 0),
        'open'
      )
      ON CONFLICT (game_date, round_time) DO NOTHING;
    END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION private.ensure_classic_round_methods(p_game_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_existing integer;
  v_round_count integer;
  v_existing_random integer;
  v_needed_random integer;
BEGIN
  IF p_game_date <= v_today THEN
    RAISE EXCEPTION 'Classic draw methods may only be assigned in advance';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('classic-round-methods-' || p_game_date::text));
  PERFORM public.create_daily_rounds(p_game_date);

  SELECT count(*) INTO v_round_count
  FROM public.game_rounds
  WHERE game_date = p_game_date;

  IF v_round_count <> 24 THEN
    RAISE EXCEPTION 'Expected 24 Classic rounds for %, found %', p_game_date, v_round_count;
  END IF;

  SELECT count(*), count(*) FILTER (WHERE draw_method = 'random')
  INTO v_existing, v_existing_random
  FROM private.classic_round_methods
  WHERE game_date = p_game_date;

  IF v_existing > 24 THEN
    RAISE EXCEPTION 'Unexpected number of Classic draw methods for %: %', p_game_date, v_existing;
  END IF;

  IF v_existing = 24 THEN
    RETURN;
  END IF;

  -- Keep any methods already assigned. Fill only the new/missing rounds so a
  -- schedule change never reshuffles a round that has already been assigned.
  v_needed_random := greatest(0, 10 - v_existing_random);

  WITH missing AS (
    SELECT r.id, r.game_date,
           row_number() OVER (ORDER BY gen_random_uuid()) AS rn
    FROM public.game_rounds r
    LEFT JOIN private.classic_round_methods m ON m.round_id = r.id
    WHERE r.game_date = p_game_date
      AND m.round_id IS NULL
  )
  INSERT INTO private.classic_round_methods (round_id, game_date, draw_method)
  SELECT id, game_date,
         CASE WHEN rn <= v_needed_random THEN 'random' ELSE 'weighted' END
  FROM missing;
END;
$function$;
