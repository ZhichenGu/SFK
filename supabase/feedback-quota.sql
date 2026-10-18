-- Optional global daily request cap. Run once before enabling FEEDBACK_DAILY_LIMIT.
-- Counts reservations conservatively, including failed/cancelled provider requests.
begin;
create table if not exists public.sfk_feedback_quota (
  day date primary key,
  requests integer not null check (requests > 0)
);
alter table public.sfk_feedback_quota enable row level security;
revoke all on table public.sfk_feedback_quota from public, anon, authenticated;
create or replace function public.claim_feedback_quota(p_limit integer)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100000 then
    raise exception 'Invalid feedback quota';
  end if;
  insert into public.sfk_feedback_quota(day, requests)
  values ((now() at time zone 'Asia/Shanghai')::date, 1)
  on conflict (day) do update
  set requests = public.sfk_feedback_quota.requests + 1
  where public.sfk_feedback_quota.requests < p_limit;
  return found;
end;
$$;
revoke all on function public.claim_feedback_quota(integer) from public, anon, authenticated;
grant execute on function public.claim_feedback_quota(integer) to service_role;
commit;
-- To disable without dropping data: remove FEEDBACK_DAILY_LIMIT from function Secrets.
