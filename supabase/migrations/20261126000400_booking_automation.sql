create function public.booking_catalog(p_slug text) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'name',c.name,'logo_path',c.logo_path,'description',c.description,'address',c.address,
    'auto_confirm',c.auto_confirm,'timezone',c.timezone,'cancel_hours',c.cancel_hours,
    'allow_customer_cancel',c.allow_customer_cancel,
    'services',coalesce((
      select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'category',s.category,'description',s.description,
        'price_cents',s.price_cents,'duration_minutes',s.duration_minutes,'color',s.color,
        'professionals',(
          select jsonb_agg(jsonb_build_object('id',m.id,'name',m.name) order by m.name)
          from members m join service_professionals sp on sp.member_id=m.id
          where sp.service_id=s.id and m.active and m.bookable
        )) order by s.name)
      from services s
      where s.company_id=c.id and s.active and exists(select 1 from service_professionals sp
        join members m on m.id=sp.member_id where sp.service_id=s.id and m.active and m.bookable)
    ),'[]'::jsonb)
  ) from companies c where slug=p_slug and booking_enabled
$$;

create function public.booking_slots(p_slug text,p_service uuid,p_professional uuid,p_day date)
returns table(starts_at timestamptz)
language sql stable security definer set search_path=public,pg_temp as $$
  with available as (
    select c.id,c.timezone,s.duration_minutes,c.working_hours->(extract(isodow from p_day)::int::text) as hours
      from companies c join services s on s.company_id=c.id and s.id=p_service and s.active
      join service_professionals sp on sp.service_id=s.id and sp.member_id=p_professional
      join members m on m.id=sp.member_id and m.active and m.bookable
      where c.slug=p_slug and c.booking_enabled and
        p_day between (now() at time zone c.timezone)::date and (now() at time zone c.timezone)::date+90
  )
  select slot from available a
    cross join lateral generate_series(
      (p_day+(a.hours->>'open')::time) at time zone a.timezone,
      ((p_day+(a.hours->>'close')::time) at time zone a.timezone)-make_interval(mins=>a.duration_minutes),
      interval '15 minutes'
    ) slot
  where slot>=now()+interval '15 minutes' and not exists(
    select 1 from appointments e where e.company_id=a.id and e.professional_id=p_professional
      and e.status in ('pending','confirmed','in_progress','completed')
      and tstzrange(e.starts_at,e.ends_at,'[)') && tstzrange(slot,slot+make_interval(mins=>a.duration_minutes),'[)')
  ) order by slot
$$;

create function public.book_online(p_slug text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  company companies%rowtype;
  service services%rowtype;
  event appointments%rowtype;
  professional uuid := (p_data->>'professional_id')::uuid;
  start_time timestamptz := (p_data->>'starts_at')::timestamptz;
  end_time timestamptz;
  local_start timestamp;
  contact text := p_data->>'phone';
  contact_email text := nullif(lower(btrim(p_data->>'email')),'');
  whatsapp_opt_in boolean := coalesce((p_data->>'whatsapp_opt_in')::boolean,false);
  email_opt_in boolean := coalesce((p_data->>'email_opt_in')::boolean,false);
  client_key uuid;
begin
  select * into company from companies where slug=p_slug and booking_enabled for share;
  if not found then raise exception using errcode='22023',message='Agendamento online indisponível.'; end if;
  select * into service from services where company_id=company.id and id=(p_data->>'service_id')::uuid and active for share;
  if not found then raise exception using errcode='22023',message='Escolha um serviço disponível.'; end if;

  perform private.assert_assignment(company.id,service.id,professional);
  local_start := start_time at time zone company.timezone;
  end_time := start_time+make_interval(mins=>service.duration_minutes);
  perform private.assert_working_time(company,start_time,end_time);
  if start_time < now()+interval '15 minutes' or local_start::date>(now() at time zone company.timezone)::date+90
    or mod(extract(epoch from (local_start::time -
      (company.working_hours->(extract(isodow from local_start)::int::text)->>'open')::time)),900)<>0 then
    raise exception using errcode='22023',message='Escolha um horário disponível na lista.';
  end if;

  if contact_email is not null and contact_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode='22023',message='Informe um e-mail válido.';
  end if;
  if contact_email is not null then
    -- Lock only matching contact data; public submissions never overwrite an existing record.
    perform pg_advisory_xact_lock(hashtextextended(company.id::text||contact||contact_email,0));
    select id into client_key from clients where company_id=company.id and phone=contact and email=contact_email
      order by created_at,id limit 1 for key share;
  end if;
  if client_key is null then
    insert into clients(company_id,name,phone,whatsapp,email,whatsapp_consented_at,email_consented_at,consent_source)
    values(company.id,btrim(p_data->>'name'),contact,case when whatsapp_opt_in then contact end,contact_email,
      case when whatsapp_opt_in then now() end,case when email_opt_in and contact_email is not null then now() end,
      case when whatsapp_opt_in or (email_opt_in and contact_email is not null) then 'online' end)
    returning id into client_key;
  end if;

  insert into appointments(company_id,professional_id,client_id,service_id,title,color,status,
    starts_at,ends_at,price_cents,source)
  values(company.id,professional,client_key,service.id,service.name,service.color,
    (case when company.auto_confirm then 'confirmed' else 'pending' end)::appointment_status,
    start_time,end_time,service.price_cents,'online') returning * into event;
  return jsonb_build_object('id',event.id,'status',event.status,'schedule_version',event.schedule_version,
    'starts_at',event.starts_at,'ends_at',event.ends_at);
exception when exclusion_violation then
  raise exception using errcode='23P01',message='Este horário acabou de ser ocupado. Escolha outro.';
end;
$$;

create function public.booking_details(p_id uuid,p_version int) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('status',a.status,'title',a.title,'starts_at',a.starts_at,'name',c.name,
    'slug',c.slug,'needs_reschedule',a.needs_reschedule,'professional',m.name,
    'attendance_confirmed',a.attendance_confirmed_at is not null,
    'can_cancel',c.allow_customer_cancel and a.starts_at>=now()+make_interval(hours=>c.cancel_hours),
    'can_manage',a.starts_at>now() and a.status in ('pending','confirmed')
      and (a.attendance_confirmed_at is null or a.needs_reschedule)
      and (a.source<>'online' or c.auto_confirm or a.status='confirmed'),
    'can_request_change',a.starts_at>now() and a.status in ('pending','confirmed'),
    'cancel_hours',c.cancel_hours)
  from appointments a join companies c on c.id=a.company_id join members m on m.id=a.professional_id
  where a.id=p_id and a.schedule_version=p_version and a.kind='appointment' and a.client_id is not null
$$;

create function public.apply_booking_action(p_id uuid,p_version int,p_action text) returns text
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  event appointments%rowtype;
  company companies%rowtype;
begin
  select c.* into company from companies c join appointments a on a.company_id=c.id where a.id=p_id for share of c;
  select * into event from appointments where id=p_id and schedule_version=p_version
    and kind='appointment' and client_id is not null for update;
  if not found then raise exception using errcode='22023',message='Este link perdeu a validade.'; end if;
  if event.status='cancelled' and p_action='cancel' then return 'cancelled'; end if;
  if event.starts_at<=now() or event.status not in ('pending','confirmed') then
    raise exception using errcode='22023',message='Este atendimento não pode mais ser alterado pelo link.';
  end if;
  case p_action
    when 'confirm' then
      if event.source='online' and not company.auto_confirm and event.status='pending' then
        raise exception using errcode='22023',message='A empresa ainda precisa aprovar este horário.';
      end if;
      update appointments set status='confirmed',needs_reschedule=false,
        attendance_confirmed_at=coalesce(attendance_confirmed_at,now())
        where id=p_id and (status<>'confirmed' or needs_reschedule or attendance_confirmed_at is null);
      return 'confirmed';
    when 'reschedule' then
      update appointments set needs_reschedule=true where id=p_id and not needs_reschedule;
      return 'requested';
    when 'cancel' then
      if not company.allow_customer_cancel or event.starts_at<now()+make_interval(hours=>company.cancel_hours) then
        raise exception using errcode='22023',message='O prazo de cancelamento online terminou. Entre em contato com a empresa.';
      end if;
      update appointments set status='cancelled',needs_reschedule=false where id=p_id;
      return 'cancelled';
    else raise exception using errcode='22023',message='Ação inválida.';
  end case;
end;
$$;

create function public.consume_rate_limit(p_scope text,p_hash text,p_limit int) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  hit_count int;
begin
  insert into private.rate_limits as l(scope,key_hash,bucket,hits)
    values(p_scope,p_hash,date_trunc('hour',now()),1)
  on conflict(scope,key_hash,bucket) do update set hits=least(l.hits+1,10000)
  returning hits into hit_count;
  return hit_count<=p_limit;
end;
$$;

create function private.enqueue_appointment(p_event appointments) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  c companies%rowtype;
begin
  if p_event.kind<>'appointment' then return; end if;
  select * into c from companies where id=p_event.company_id;
  update reminder_jobs set status='skipped',finished_at=now(),
    reason=case when schedule_version<>p_event.schedule_version then 'rescheduled'
      when p_event.status not in ('pending','confirmed') or p_event.client_id is null then 'inactive'
      else 'settings' end
    where appointment_id=p_event.id and status='pending' and
      (schedule_version<>p_event.schedule_version or p_event.status not in ('pending','confirmed') or p_event.client_id is null
        or (purpose='reminder' and not offset_minutes=any(c.reminder_minutes))
        or (channel='internal' and not c.reminder_internal)
        or (channel='email' and not c.reminder_email)
        or (channel='whatsapp' and not c.reminder_whatsapp));
  if p_event.status not in ('pending','confirmed') or p_event.starts_at<=now() or p_event.client_id is null then return; end if;

  insert into reminder_jobs as j(company_id,appointment_id,schedule_version,channel,purpose,offset_minutes,run_at,next_attempt_at)
  select c.id,p_event.id,p_event.schedule_version,channels.channel,'reminder',minutes,due,due
  from unnest(c.reminder_minutes) minutes
    cross join (values('internal',c.reminder_internal),('email',c.reminder_email),('whatsapp',c.reminder_whatsapp)) channels(channel,enabled)
    cross join lateral (select p_event.starts_at-make_interval(mins=>minutes) as due) timing
  where channels.enabled and due>=now()
  on conflict(appointment_id,schedule_version,channel,purpose,offset_minutes) do update
    set status='pending',finished_at=null,reason=null,next_attempt_at=excluded.run_at
    where j.status='skipped' and j.reason='settings';

  if p_event.source='online' and p_event.status='confirmed' then
    insert into reminder_jobs(company_id,appointment_id,schedule_version,channel,purpose,offset_minutes,run_at,next_attempt_at)
      select c.id,p_event.id,p_event.schedule_version,channels.channel,'confirmation',0,now(),now()
      from (values('email',c.reminder_email),('whatsapp',c.reminder_whatsapp)) channels(channel,enabled)
      where channels.enabled
      on conflict do nothing;
  end if;
end;
$$;

create function private.schedule_notifications() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  label notification_kind;
  message text;
begin
  if new.kind<>'appointment' then return null; end if;
  if tg_op='INSERT' then
    label:='new_booking'; message:='Novo atendimento na agenda.';
  elsif old.status<>'cancelled' and new.status='cancelled' then
    label:='cancelled'; message:='Um atendimento foi cancelado.';
  elsif new.starts_at is distinct from old.starts_at or new.professional_id is distinct from old.professional_id then
    label:='rescheduled'; message:='Um atendimento foi reagendado.';
  elsif new.needs_reschedule and not old.needs_reschedule then
    label:='rescheduled'; message:='Uma cliente solicitou reagendamento.';
  elsif new.attendance_confirmed_at is not null and old.attendance_confirmed_at is null then
    label:='confirmed'; message:='A cliente confirmou a presença.';
  elsif new.status='confirmed' and old.status<>'confirmed' then
    label:='confirmed'; message:='Um atendimento foi confirmado.';
  end if;
  if label is not null then perform private.notify(new.company_id,label,message,new.id,new.professional_id,'agenda'); end if;
  if tg_op='INSERT' or new.schedule_version<>old.schedule_version or new.status<>old.status then
    perform private.enqueue_appointment(new);
  end if;
  return null;
end;
$$;
create trigger schedule_notifications after insert or update on appointments
  for each row execute function private.schedule_notifications();

create function public.save_company_settings(p_company uuid,p_data jsonb) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  days jsonb := p_data->'working_hours';
  offsets int[];
  d record;
  event appointments%rowtype;
  logo text := nullif(p_data->>'logo_path','');
begin
  perform private.require_manager(p_company);
  if jsonb_typeof(days) is distinct from 'object' then
    raise exception using errcode='22023',message='Revise os dias de funcionamento.';
  end if;
  for d in select key,value from jsonb_each(days) loop
    if d.key !~ '^[1-7]$' or d.value->>'open' is null or d.value->>'close' is null or
      d.value->>'open' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or d.value->>'close' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or
      (d.value->>'open')>=(d.value->>'close') then
      raise exception using errcode='22023',message='O fechamento deve ser posterior à abertura.';
    end if;
  end loop;
  select coalesce(array_agg(distinct minute order by minute desc),'{}') into offsets
    from (select value::int as minute from jsonb_array_elements_text(p_data->'reminder_minutes')) list;
  if cardinality(offsets)>5 or exists(select 1 from unnest(offsets) m where m not between 15 and 10080)
     or (logo is not null and split_part(logo,'/',1)<>p_company::text) then
    raise exception using errcode='22023',message='Revise o logotipo e os prazos dos lembretes.';
  end if;
  if (p_data->>'reminder_email')::boolean and strpos(coalesce(p_data->>'reminder_template',''),'{link}')=0 then
    raise exception using errcode='22023',message='Inclua {link} no lembrete por e-mail.';
  end if;

  update companies set name=btrim(p_data->>'name'),description=coalesce(p_data->>'description',''),
    address=coalesce(p_data->>'address',''),logo_path=logo,working_hours=days,
    booking_enabled=(p_data->>'booking_enabled')::boolean,auto_confirm=(p_data->>'auto_confirm')::boolean,
    allow_customer_cancel=(p_data->>'allow_customer_cancel')::boolean,cancel_hours=(p_data->>'cancel_hours')::int,
    allow_negative_stock=(p_data->>'allow_negative_stock')::boolean,reminder_minutes=offsets,
    reminder_internal=(p_data->>'reminder_internal')::boolean,reminder_email=(p_data->>'reminder_email')::boolean,
    reminder_whatsapp=(p_data->>'reminder_whatsapp')::boolean,reminder_template=coalesce(p_data->>'reminder_template','')
  where id=p_company;
  for event in select * from appointments where company_id=p_company and kind='appointment'
    and status in ('pending','confirmed') and starts_at>now()
  loop
    perform private.enqueue_appointment(event);
  end loop;
end;
$$;

create function public.claim_reminders(p_limit int default 30) returns table(id uuid,claimed_at timestamptz)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update reminder_jobs j set status=case when j.channel='email' and j.attempts<4 and
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

create function public.reminder_payload(p_id uuid,p_claim timestamptz) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('channel',j.channel,'purpose',j.purpose,'attempts',j.attempts,'offset',j.offset_minutes,
    'appointment_id',a.id,'schedule_version',a.schedule_version,'starts_at',a.starts_at,'ends_at',a.ends_at,
    'service',a.title,'company',c.name,'timezone',c.timezone,'template',c.reminder_template,
    'client',split_part(btrim(coalesce(cl.name,'')),' ',1),
    'destination',case when j.channel='email' and cl.email_consented_at is not null then cl.email
      when j.channel='whatsapp' and cl.whatsapp_consented_at is not null then cl.whatsapp end,
    'eligible',a.status in ('pending','confirmed') and a.client_id is not null and a.starts_at>now()
      and a.schedule_version=j.schedule_version and j.run_at>=now()-interval '6 hours'
      and (j.purpose='confirmation' and a.status='confirmed' or j.purpose='reminder' and j.offset_minutes=any(c.reminder_minutes))
      and case j.channel when 'email' then c.reminder_email when 'whatsapp' then c.reminder_whatsapp else c.reminder_internal end)
  from reminder_jobs j join appointments a on a.id=j.appointment_id
    join companies c on c.id=j.company_id left join clients cl on cl.id=a.client_id
  where j.id=p_id and j.status='sending' and j.claimed_at=p_claim
$$;

create function public.deliver_internal_reminder(p_id uuid,p_claim timestamptz) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  j reminder_jobs%rowtype;
  a appointments%rowtype;
  valid boolean;
begin
  select * into j from reminder_jobs where id=p_id and claimed_at=p_claim and status='sending' and channel='internal' for update;
  if not found then return; end if;
  valid:=coalesce((public.reminder_payload(p_id,p_claim)->>'eligible')::boolean,false);
  if valid then
    select * into a from appointments where id=j.appointment_id;
    perform private.notify(j.company_id,'upcoming','Lembrete de um próximo atendimento.',a.id,a.professional_id,'agenda');
  end if;
  update reminder_jobs set status=case when valid then 'sent' else 'skipped' end,
    reason=case when not valid then 'ineligible' end,finished_at=now() where id=p_id;
end;
$$;

create function public.finish_reminder(p_id uuid,p_claim timestamptz,p_result text,p_reason text,p_provider text) returns void
language sql security definer set search_path=public,pg_temp as $$
  update reminder_jobs j set
    status=case when p_result='retry' and j.attempts<4 and j.run_at>now()-interval '6 hours' then 'pending'
      when p_result='retry' then 'failed' else p_result end,
    next_attempt_at=now()+make_interval(mins=>least(60,5*j.attempts)),reason=left(p_reason,90),
    provider_id=left(p_provider,255),finished_at=now()
  where j.id=p_id and j.status='sending' and j.claimed_at=p_claim
    and p_result in ('retry','sent','failed','skipped','unknown')
$$;

create function public.scan_alerts() returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  firm record;
  item record;
  birthday record;
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  warning text;
begin
  insert into private.rate_limits(scope,key_hash,bucket,hits)
    values('cron','alerts',date_trunc('hour',now()),1) on conflict do nothing;
  if not found then return; end if;
  delete from private.rate_limits where bucket<now()-interval '48 hours';

  for firm in select id from companies loop
    for item in select p.id,p.name,p.expires_on,
      coalesce(sum(-m.quantity_delta) filter (where m.created_at>=now()-interval '7 days'),0) as recent,
      coalesce(sum(-m.quantity_delta) filter (where m.created_at<now()-interval '7 days'),0) as older,
      count(*) filter (where m.created_at<now()-interval '7 days') as samples
      from products p left join stock_movements m on m.product_id=p.id and m.kind='consumption'
        and m.created_at>=now()-interval '28 days'
      where p.company_id=firm.id and p.active group by p.id
    loop
      warning:=case when item.expires_on<today then 'expired'
        when item.expires_on<=today+30 then 'expiring' else 'ok' end;
      if private.set_alert(firm.id,'expiry:'||item.id,warning||coalesce(item.expires_on::text,'')) and warning<>'ok' then
        perform private.notify(firm.id,warning::notification_kind,item.name||
          case when warning='expired' then ' está vencido.' else ' vence em até 30 dias.' end,item.id,null,'managers');
      end if;
      warning:=case when item.samples>=3 and item.older>0 and item.recent>item.older/3*1.5 then 'high' else 'ok' end;
      if private.set_alert(firm.id,'usage:'||item.id,warning) and warning='high' then
        perform private.notify(firm.id,'high_usage',item.name||' teve consumo elevado nos últimos sete dias.',item.id,null,'managers');
      end if;
    end loop;

    for birthday in select id from clients where company_id=firm.id and
      to_char(clients.birthday,'MM-DD')=to_char(today,'MM-DD')
    loop
      if private.set_alert(firm.id,'birthday:'||birthday.id,today::text) then
        perform private.notify(firm.id,'birthday','Uma cliente faz aniversário hoje.',birthday.id,null,'managers');
      end if;
    end loop;
  end loop;
end;
$$;

grant execute on function public.save_company_settings(uuid,jsonb) to authenticated;
revoke execute on function public.booking_catalog(text),public.booking_slots(text,uuid,uuid,date),public.book_online(text,jsonb),
  public.booking_details(uuid,int),public.apply_booking_action(uuid,int,text),public.consume_rate_limit(text,text,int),
  public.claim_reminders(int),public.reminder_payload(uuid,timestamptz),public.deliver_internal_reminder(uuid,timestamptz),
  public.finish_reminder(uuid,timestamptz,text,text,text),public.scan_alerts() from public,anon,authenticated;
grant execute on function public.booking_catalog(text),public.booking_slots(text,uuid,uuid,date),public.book_online(text,jsonb),
  public.booking_details(uuid,int),public.apply_booking_action(uuid,int,text),public.consume_rate_limit(text,text,int),
  public.claim_reminders(int),public.reminder_payload(uuid,timestamptz),public.deliver_internal_reminder(uuid,timestamptz),
  public.finish_reminder(uuid,timestamptz,text,text,text),public.scan_alerts() to service_role;
