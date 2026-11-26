create function public.dashboard_summary(p_company uuid,p_days int default 7) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
  with clock as (
    select (now() at time zone 'America/Sao_Paulo')::date today
  ), today_event as (
    select a.status from appointments a cross join clock
    where a.company_id=p_company and a.kind='appointment' and a.status not in ('cancelled','no_show')
      and a.starts_at>=today::timestamp at time zone 'America/Sao_Paulo'
      and a.starts_at<(today+1)::timestamp at time zone 'America/Sao_Paulo'
  ), days as (
    select d::date from clock cross join generate_series(today-greatest(1,least(p_days,30))+1,today,interval '1 day') d
  ), attendance as (
    select (a.starts_at at time zone 'America/Sao_Paulo')::date as day,
      count(*) filter (where a.status='completed') as completed,
      count(*) filter (where a.status in ('pending','confirmed','in_progress')) as scheduled
      from appointments a cross join clock where a.company_id=p_company and a.kind='appointment'
        and a.starts_at>=(today-greatest(1,least(p_days,30))+1)::timestamp at time zone 'America/Sao_Paulo'
        and a.starts_at<(today+1)::timestamp at time zone 'America/Sao_Paulo' group by 1
  )
  select jsonb_build_object(
    'today',(select count(*) from today_event),
    'confirmed',(select count(*) from today_event where status='confirmed'),
    'pending',(select count(*) from today_event where status='pending'),
    'clients',(select count(*) from clients where company_id=p_company),
    'low',(select count(*) from products where company_id=p_company and active and quantity>0 and quantity<=minimum),
    'out',(select count(*) from products where company_id=p_company and active and quantity<=0),
    'revenue_today',(select coalesce(sum(amount_cents),0) from finance_entries cross join clock
      where company_id=p_company and kind='income' and settled_on=today),
    'revenue_month',(select coalesce(sum(amount_cents),0) from finance_entries cross join clock
      where company_id=p_company and kind='income' and settled_on between date_trunc('month',today)::date and today),
    'series',(select jsonb_agg(jsonb_build_object('day',d,'completed',coalesce(completed,0),
      'scheduled',coalesce(scheduled,0)) order by d) from days left join attendance on day=d)
  )
$$;

create function public.inventory_forecast(p_company uuid,p_products uuid[])
returns table(product_id uuid,days_remaining numeric,daily_use numeric)
language sql stable security invoker set search_path=public,pg_temp as $$
  select p.id,
    case when u.days>=3 and u.span>=7 and u.used>0 then round(greatest(p.quantity,0)/(u.used/28),1) end,
    case when u.days>=3 and u.span>=7 then round(u.used/28,3) end
  from products p left join lateral (
    select count(distinct (m.created_at at time zone 'America/Sao_Paulo')::date) days,
      max((m.created_at at time zone 'America/Sao_Paulo')::date)-min((m.created_at at time zone 'America/Sao_Paulo')::date) span,sum(-m.quantity_delta) used
    from stock_movements m where m.product_id=p.id and m.kind='consumption'
      and m.created_at>=now()-interval '28 days'
  ) u on true
  where p.company_id=p_company and p.active and p.id=any(p_products)
$$;

create function public.finance_summary(p_company uuid,p_first date,p_last date) returns jsonb
language sql stable security invoker set search_path=public,pg_temp as $$
  with clock as (select (now() at time zone 'America/Sao_Paulo')::date today),
  data as (
    select f.* from finance_entries f where f.company_id=p_company
  ), timeline as (
    select d::date as day from generate_series(p_first,least(p_last,p_first+92),interval '1 day') d
  ), totals as (
    select
      coalesce(sum(amount_cents) filter (where kind='income' and settled_on=today),0) daily,
      coalesce(sum(amount_cents) filter (where kind='income' and settled_on between date_trunc('week',today)::date and today),0) weekly,
      coalesce(sum(amount_cents) filter (where kind='income' and settled_on between date_trunc('month',today)::date and today),0) monthly,
      coalesce(sum(amount_cents) filter (where kind='income' and settled_on between p_first and p_last),0) income,
      coalesce(sum(amount_cents) filter (where kind='expense' and settled_on between p_first and p_last),0) expenses,
      coalesce(sum(amount_cents) filter (where kind='income' and settled_on is null and occurred_on between p_first and p_last),0) pending,
      coalesce(sum(amount_cents) filter (where kind='expense' and category='Produtos' and settled_on between p_first and p_last),0) products
    from data cross join clock
  ), ranking as (
    select a.service_id,max(a.title) title,sum(f.amount_cents) paid,coalesce(sum(cost.total),0) cost
    from data f join appointments a on a.id=f.appointment_id
    left join lateral (select round(sum(-m.quantity_delta*m.cost_cents)) total
      from stock_movements m where m.appointment_id=a.id) cost on true
    where f.kind='income' and f.settled_on between p_first and p_last
    group by a.service_id order by sum(f.amount_cents)-coalesce(sum(cost.total),0) desc limit 5
  ), series as (
    select t.day,coalesce(sum(f.amount_cents) filter(where f.kind='income'),0) income,
      coalesce(sum(f.amount_cents) filter(where f.kind='expense'),0) expense
    from timeline t left join data f on f.settled_on=t.day group by t.day
  )
  select to_jsonb(totals)||jsonb_build_object(
    'profit',income-expenses,
    'ranking',coalesce((select jsonb_agg(jsonb_build_object('title',title,'paid',paid,'cost',cost,'margin',paid-cost)
      order by paid-cost desc) from ranking),'[]'::jsonb),
    'series',coalesce((select jsonb_agg(to_jsonb(series) order by day) from series),'[]'::jsonb))
  from totals
$$;

grant execute on function public.dashboard_summary(uuid,int),public.inventory_forecast(uuid,uuid[]),
  public.finance_summary(uuid,date,date) to authenticated;

-- Supabase projects can include broad schema defaults. Remove them from the app RPCs explicitly.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any(array[
      'create_company','my_invitations','accept_company_invite','save_member','read_notifications',
      'staff_roster','save_client','erase_client','save_product','set_product_active','move_stock','mark_shopping',
      'save_service','set_service_active','save_appointment','change_appointment_status','appointment_materials',
      'finish_appointment','save_finance','settle_finance','delete_finance','save_company_settings',
      'dashboard_summary','inventory_forecast','finance_summary'])
  loop
    execute format('revoke execute on function %s from public,anon',f.signature);
  end loop;
end;
$$;

create view public.inventory_list with (security_invoker=true) as
select p.*,case when p.quantity<=0 then 'out' when p.quantity<=p.minimum then 'low' else 'ok' end as health
from public.products p;
revoke all on public.inventory_list from public,anon,authenticated;
grant select on public.inventory_list to authenticated;

create function public.client_total_paid(p_company uuid,p_client uuid) returns bigint
language sql stable security invoker set search_path=public,pg_temp as $$
  select coalesce(sum(f.amount_cents),0)::bigint
  from finance_entries f join appointments a on a.id=f.appointment_id
  where f.company_id=p_company and a.client_id=p_client and f.kind='income' and f.settled_on is not null
$$;
revoke execute on function public.client_total_paid(uuid,uuid) from public,anon;
grant execute on function public.client_total_paid(uuid,uuid) to authenticated;
