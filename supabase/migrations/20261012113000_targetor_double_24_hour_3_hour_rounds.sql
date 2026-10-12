ALTER TABLE public.double_rounds DROP CONSTRAINT double_rounds_round_time_check;
ALTER TABLE public.double_rounds ADD CONSTRAINT double_rounds_round_time_check CHECK (round_time = ANY (ARRAY[TIME '00:00', TIME '03:00', TIME '06:00', TIME '09:00', TIME '12:00', TIME '15:00', TIME '18:00', TIME '21:00']));

CREATE OR REPLACE FUNCTION public.create_double_daily_rounds(p_game_date date DEFAULT ((now() AT TIME ZONE 'Asia/Kolkata'::text))::date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_time time;
  v_created integer := 0;
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_now timestamp := now() AT TIME ZONE 'Asia/Kolkata';
BEGIN
  FOREACH v_time IN ARRAY ARRAY[
    TIME '00:00', TIME '03:00', TIME '06:00', TIME '09:00',
    TIME '12:00', TIME '15:00', TIME '18:00', TIME '21:00'
  ]
  LOOP
    -- Do not create overdue rounds for elapsed slots on the current day.
    IF p_game_date > v_today OR (p_game_date = v_today AND p_game_date::timestamp + v_time > v_now) THEN
      INSERT INTO public.double_rounds (round_code, game_date, round_time, status)
      VALUES (
        'DOUBLE-' || to_char(p_game_date, 'YYYY-MM-DD') || '-' || to_char(v_time, 'HH24MI'),
        p_game_date, v_time, 'open'
      )
      ON CONFLICT (game_date, round_time) DO NOTHING;
      IF FOUND THEN v_created := v_created + 1; END IF;
    END IF;
  END LOOP;
  RETURN v_created;
END;
$function$;

SELECT public.create_double_daily_rounds((now() AT TIME ZONE 'Asia/Kolkata')::date);
SELECT public.create_double_daily_rounds((now() AT TIME ZONE 'Asia/Kolkata')::date + 1);
