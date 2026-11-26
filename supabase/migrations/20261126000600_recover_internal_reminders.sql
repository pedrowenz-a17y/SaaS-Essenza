create or replace function public.claim_reminders(p_limit int default 30) returns table(id uuid,claimed_at timestamptz)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  -- Internal delivery and its status update commit together. A job still
  -- marked sending can safely be retried after its claim expires.
  update reminder_jobs j set status=case when j.channel in ('internal','email') and j.attempts<4 and
      j.run_at>now()-interval '6 hours' then 'pending' else 'unknown' end,
    reason='claim_expired',next_attempt_at=now(),finished_at=now()
    where j.status='sending' and j.claimed_at<now()-interval '10 minutes';

  return query with due as (
    select j.id from reminder_jobs j where j.status='pending' and j.next_attempt_at<=now()
    order by j.next_attempt_at,j.id limit greatest(1,least(p_limit,50)) for update skip locked
  )
  update reminder_jobs j set status='sending',claimed_at=clock_timestamp(),attempts=j.attempts+1,finished_at=null
    from due where due.id=j.id returning j.id,j.claimed_at;
end;
$$;
