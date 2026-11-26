create function public.staff_roster(p_company uuid)
returns table(id uuid, name text, role staff_role, active boolean, bookable boolean, joined boolean, email text)
language sql stable security definer set search_path=public,pg_temp as $$
  select m.id,m.name,m.role,m.active,m.bookable,m.user_id is not null,
    case when private.can_manage(p_company) then m.email end
  from members m where m.company_id=p_company and private.member_id(p_company) is not null
    and (m.active or private.can_manage(p_company))
  order by m.name
$$;

create function public.save_client(p_company uuid,p_id uuid,p_data jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  saved uuid;
  contact_email text := nullif(lower(btrim(p_data->>'email')),'');
  contact_whatsapp text := nullif(p_data->>'whatsapp','');
  email_opt_in boolean := coalesce((p_data->>'email_opt_in')::boolean,false);
  whatsapp_opt_in boolean := coalesce((p_data->>'whatsapp_opt_in')::boolean,false);
  birth date := nullif(p_data->>'birthday','')::date;
begin
  perform private.require_scheduler(p_company);
  if birth > (now() at time zone 'America/Sao_Paulo')::date or birth < date '1900-01-01' then
    raise exception using errcode='22023',message='Informe uma data de nascimento válida.';
  end if;
  if contact_email is not null and contact_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using errcode='22023',message='Informe um e-mail válido.';
  end if;

  if p_id is null then
    insert into clients(company_id,name,phone,whatsapp,email,birthday,notes,preferences,
      email_consented_at,whatsapp_consented_at,consent_source)
    values(p_company,btrim(p_data->>'name'),p_data->>'phone',contact_whatsapp,contact_email,birth,
      coalesce(p_data->>'notes',''),coalesce(p_data->>'preferences',''),
      case when email_opt_in and contact_email is not null then now() end,
      case when whatsapp_opt_in and contact_whatsapp is not null then now() end,
      case when email_opt_in or whatsapp_opt_in then 'office' end)
    returning id into saved;
  else
    update clients set name=btrim(p_data->>'name'), phone=p_data->>'phone',
      whatsapp=contact_whatsapp,email=contact_email,birthday=birth,notes=coalesce(p_data->>'notes',''),
      preferences=coalesce(p_data->>'preferences',''),
      email_consented_at=case when email_opt_in and contact_email is not null
        then coalesce(case when email=contact_email then email_consented_at end,now()) end,
      whatsapp_consented_at=case when whatsapp_opt_in and contact_whatsapp is not null
        then coalesce(case when whatsapp=contact_whatsapp then whatsapp_consented_at end,now()) end,
      consent_source=case when email_opt_in or whatsapp_opt_in then coalesce(consent_source,'office') end
    where company_id=p_company and id=p_id returning id into saved;
  end if;
  if saved is null then raise exception using errcode='22023',message='Cliente não encontrada.'; end if;
  return saved;
end;
$$;

create function public.erase_client(p_company uuid,p_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform private.require_manager(p_company);
  perform 1 from clients where company_id=p_company and id=p_id for update;
  if not found then raise exception using errcode='22023',message='Cliente não encontrada.'; end if;
  delete from reminder_jobs where company_id=p_company
    and appointment_id in (select id from appointments where company_id=p_company and client_id=p_id);
  delete from notifications where company_id=p_company and entity_id=p_id and kind='birthday';
  update appointments set notes='' where company_id=p_company and client_id=p_id;
  delete from clients where company_id=p_company and id=p_id;
end;
$$;

create view public.client_directory with (security_invoker=true) as
select c.*,
  (select max(a.starts_at) from appointments a where a.company_id=c.company_id
    and a.client_id=c.id and a.status='completed') as last_visit,
  (select min(a.starts_at) from appointments a where a.company_id=c.company_id
    and a.client_id=c.id and a.status in ('pending','confirmed','in_progress')
    and a.starts_at >= now()) as next_visit
from clients c;
revoke all on public.client_directory from public, anon, authenticated;
grant select on public.client_directory to authenticated;

create function private.set_alert(p_company uuid,p_key text,p_state text) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into private.alert_states as current(company_id,alert_key,state)
    values(p_company,p_key,p_state)
  on conflict(company_id,alert_key) do update set state=excluded.state where current.state is distinct from excluded.state;
  return found;
end;
$$;

create function private.reconcile_stock() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  stock_state text := case when not new.active then 'ok' when new.quantity<=0 then 'out'
    when new.quantity<=new.minimum then 'low' else 'ok' end;
begin
  if stock_state='ok' then
    delete from shopping_items where company_id=new.company_id and product_id=new.id;
  else
    insert into shopping_items(company_id,product_id) values(new.company_id,new.id) on conflict do nothing;
  end if;
  if private.set_alert(new.company_id,'stock:'||new.id,stock_state) and stock_state<>'ok' then
    perform private.notify(new.company_id,
      (case when stock_state='out' then 'out_of_stock' else 'low_stock' end)::notification_kind,
      case when stock_state='out' then new.name||' está esgotado.'
        else new.name||' atingiu o estoque mínimo. Confira a lista de compras.' end,
      new.id,null,'managers');
  end if;
  return null;
end;
$$;
create trigger stock_alerts after insert or update of quantity,minimum,active on products
  for each row execute function private.reconcile_stock();

create function private.apply_movement(p_company uuid,p_product uuid,p_kind movement_kind,p_quantity numeric,
  p_notes text,p_appointment uuid default null,p_cost bigint default null) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  item products%rowtype;
  result uuid;
  delta numeric(14,3);
  allow_negative boolean;
begin
  if p_quantity is null or p_quantity::text in ('NaN','Infinity','-Infinity') or
    abs(p_quantity)>99999999 or p_quantity<>round(p_quantity,3) or
    (p_kind<>'adjustment' and p_quantity<=0) then
    raise exception using errcode='22023',message='Informe uma quantidade válida com até três casas decimais.';
  end if;
  select allow_negative_stock into allow_negative from companies where id=p_company for share;
  select * into item from products where company_id=p_company and id=p_product and active for update;
  if not found then raise exception using errcode='22023',message='Produto indisponível.'; end if;
  delta := case p_kind when 'adjustment' then p_quantity-item.quantity when 'in' then p_quantity else -p_quantity end;
  if delta=0 then return null; end if;
  if item.quantity+delta<0 and not allow_negative then
    raise exception using errcode='22023',message='Saldo insuficiente para '||item.name||'.';
  end if;
  insert into stock_movements(company_id,product_id,appointment_id,kind,quantity_delta,quantity_after,
    cost_cents,notes,actor_id)
  values(p_company,p_product,p_appointment,p_kind,delta,item.quantity+delta,
    coalesce(p_cost,item.cost_cents),coalesce(p_notes,''),(select auth.uid())) returning id into result;
  update products set quantity=quantity+delta,
    cost_cents=case when p_kind='in' then coalesce(p_cost,cost_cents) else cost_cents end where id=p_product;
  return result;
end;
$$;

create function public.save_product(p_company uuid,p_id uuid,p_data jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  saved uuid;
  image_path text := nullif(p_data->>'photo_path','');
  initial_stock numeric := coalesce((p_data->>'initial_stock')::numeric,0);
  minimum_stock numeric := (p_data->>'minimum')::numeric;
begin
  perform private.require_manager(p_company);
  if image_path is not null and split_part(image_path,'/',1)<>p_company::text then
    raise exception using errcode='22023',message='Foto inválida.';
  end if;
  if minimum_stock is null or minimum_stock::text in ('NaN','Infinity','-Infinity') or
    minimum_stock<0 or minimum_stock>99999999 or minimum_stock<>round(minimum_stock,3) or
    initial_stock<0 or initial_stock::text in ('NaN','Infinity','-Infinity') then
    raise exception using errcode='22023',message='Informe quantidades válidas.';
  end if;

  -- An initial balance is recorded below before alerting on the committed stock level.
  perform 1 from companies where id=p_company for share;
  if p_id is null then
    insert into products(company_id,name,photo_path,category,brand,supplier,quantity,minimum,unit,
      cost_cents,expires_on,location,notes,active)
    values(p_company,btrim(p_data->>'name'),image_path,coalesce(p_data->>'category',''),
      coalesce(p_data->>'brand',''),coalesce(p_data->>'supplier',''),0,minimum_stock,
      btrim(p_data->>'unit'),(p_data->>'cost_cents')::bigint,nullif(p_data->>'expires_on','')::date,
      coalesce(p_data->>'location',''),coalesce(p_data->>'notes',''),initial_stock=0)
    returning id into saved;
    if initial_stock>0 then
      if initial_stock>99999999 or initial_stock<>round(initial_stock,3) then
        raise exception using errcode='22023',message='Informe um saldo inicial válido.';
      end if;
      insert into stock_movements(company_id,product_id,kind,quantity_delta,quantity_after,cost_cents,notes,actor_id)
      values(p_company,saved,'in',initial_stock,initial_stock,(p_data->>'cost_cents')::bigint,'Saldo inicial',(select auth.uid()));
      update products set quantity=initial_stock,active=true where id=saved;
    end if;
  else
    update products set name=btrim(p_data->>'name'),photo_path=image_path,category=coalesce(p_data->>'category',''),
      brand=coalesce(p_data->>'brand',''),supplier=coalesce(p_data->>'supplier',''),minimum=minimum_stock,
      unit=btrim(p_data->>'unit'),cost_cents=(p_data->>'cost_cents')::bigint,
      expires_on=nullif(p_data->>'expires_on','')::date,location=coalesce(p_data->>'location',''),
      notes=coalesce(p_data->>'notes','')
    where company_id=p_company and id=p_id returning id into saved;
  end if;
  if saved is null then raise exception using errcode='22023',message='Produto não encontrado.'; end if;
  return saved;
end;
$$;

create function public.set_product_active(p_company uuid,p_id uuid,p_active boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform private.require_manager(p_company);
  perform 1 from products where company_id=p_company and id=p_id for update;
  if not found then raise exception using errcode='22023',message='Produto não encontrado.'; end if;
  if not p_active and exists(select 1 from service_materials sm join services s on s.id=sm.service_id
    where sm.company_id=p_company and sm.product_id=p_id and (s.active or exists(
      select 1 from appointments a where a.service_id=s.id and a.status in ('pending','confirmed','in_progress')
    ))) then
    raise exception using errcode='22023',message='Retire o produto dos serviços ativos e dos atendimentos em aberto antes de arquivá-lo.';
  end if;
  update products set active=p_active where id=p_id;
end;
$$;

create function public.move_stock(p_company uuid,p_id uuid,p_kind movement_kind,p_quantity numeric,
  p_notes text,p_cost bigint,p_method payment_method) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  movement uuid;
  amount bigint;
  local_day date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  perform private.require_manager(p_company);
  if p_kind<>'in' and (p_cost is not null or p_method is not null) then
    raise exception using errcode='22023',message='Compras são registradas em entradas de produtos.';
  end if;
  movement := private.apply_movement(p_company,p_id,p_kind,p_quantity,p_notes,null,p_cost);
  if movement is not null and p_method is not null then
    select round(sm.quantity_delta*sm.cost_cents)::bigint into amount from stock_movements sm where id=movement;
    insert into finance_entries(company_id,movement_id,kind,description,category,amount_cents,occurred_on,settled_on,method)
    values(p_company,movement,'expense',(select 'Compra de '||name from products where id=p_id),
      'Produtos',amount,local_day,local_day,p_method);
  end if;
  return movement;
end;
$$;

create function public.mark_shopping(p_company uuid,p_product uuid,p_bought boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform private.require_manager(p_company);
  update shopping_items set bought_at=case when p_bought then coalesce(bought_at,now()) end
    where company_id=p_company and product_id=p_product;
  if not found then raise exception using errcode='22023',message='Esse produto já saiu da lista de reposição.'; end if;
end;
$$;

create function public.save_service(p_company uuid,p_id uuid,p_data jsonb,p_materials jsonb,p_professionals uuid[]) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  saved uuid;
  material record;
begin
  perform private.require_manager(p_company);
  if jsonb_typeof(p_materials)<>'array' or jsonb_array_length(p_materials)>50 or
     coalesce(cardinality(p_professionals),0)>100 then
    raise exception using errcode='22023',message='Revise os materiais e profissionais informados.';
  end if;
  if p_id is null then
    insert into services(company_id,name,category,description,price_cents,duration_minutes,color)
    values(p_company,btrim(p_data->>'name'),coalesce(p_data->>'category',''),coalesce(p_data->>'description',''),
      (p_data->>'price_cents')::bigint,(p_data->>'duration_minutes')::int,p_data->>'color') returning id into saved;
  else
    update services set name=btrim(p_data->>'name'),category=coalesce(p_data->>'category',''),
      description=coalesce(p_data->>'description',''),price_cents=(p_data->>'price_cents')::bigint,
      duration_minutes=(p_data->>'duration_minutes')::int,color=p_data->>'color'
    where company_id=p_company and id=p_id returning id into saved;
    if saved is null then raise exception using errcode='22023',message='Serviço não encontrado.'; end if;
  end if;

  if exists(select 1 from unnest(p_professionals) v(id)
    where not exists(select 1 from members m where m.company_id=p_company and m.id=v.id and m.active and m.bookable)) then
    raise exception using errcode='22023',message='Selecione profissionais disponíveis desta empresa.';
  end if;
  delete from service_professionals where service_id=saved;
  insert into service_professionals(company_id,service_id,member_id)
    select distinct p_company,saved,id from unnest(p_professionals) v(id);

  delete from service_materials where service_id=saved;
  for material in select * from jsonb_to_recordset(p_materials) as x(product_id uuid,quantity numeric) order by product_id loop
    perform 1 from products where company_id=p_company and id=material.product_id and active for share;
    if not found or material.quantity is null or material.quantity::text in ('NaN','Infinity','-Infinity')
      or material.quantity<=0 or material.quantity>99999999 or material.quantity<>round(material.quantity,3) then
      raise exception using errcode='22023',message='Selecione produtos ativos e informe quantidades válidas.';
    end if;
    insert into service_materials(company_id,service_id,product_id,quantity)
      values(p_company,saved,material.product_id,material.quantity);
  end loop;
  return saved;
end;
$$;

create function public.set_service_active(p_company uuid,p_id uuid,p_active boolean) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform private.require_manager(p_company);
  perform 1 from services where company_id=p_company and id=p_id for update;
  if not found then raise exception using errcode='22023',message='Serviço não encontrado.'; end if;
  -- Use the same product locks as catalog editing and archiving.
  perform 1 from products p join service_materials sm on sm.product_id=p.id
    where sm.company_id=p_company and sm.service_id=p_id order by p.id for share of p;
  if p_active and exists(select 1 from service_materials sm join products p on p.id=sm.product_id
    where sm.company_id=p_company and sm.service_id=p_id and not p.active) then
    raise exception using errcode='22023',message='Atualize os materiais arquivados antes de reativar o serviço.';
  end if;
  update services set active=p_active where id=p_id;
end;
$$;

create function private.assert_working_time(p_company companies,p_start timestamptz,p_end timestamptz) returns void
language plpgsql stable set search_path=public,pg_temp as $$
declare
  local_start timestamp := p_start at time zone p_company.timezone;
  local_end timestamp := p_end at time zone p_company.timezone;
  hours jsonb := p_company.working_hours->(extract(isodow from local_start)::int::text);
begin
  if p_start is null or p_end is null or p_end<=p_start or hours is null or local_start::date<>local_end::date
    or local_start::time<(hours->>'open')::time or local_end::time>(hours->>'close')::time then
    raise exception using errcode='22023',message='Escolha um horário dentro do funcionamento da empresa.';
  end if;
end;
$$;

create function private.assert_assignment(p_company uuid,p_service uuid,p_member uuid) returns void
language plpgsql set search_path=public,pg_temp as $$
begin
  perform 1 from members where company_id=p_company and id=p_member and active and bookable for share;
  if not found or not exists(select 1 from service_professionals
    where company_id=p_company and service_id=p_service and member_id=p_member) then
    raise exception using errcode='22023',message='Essa profissional está indisponível para o serviço selecionado.';
  end if;
end;
$$;

create function private.bump_schedule() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  new.updated_at := greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
  if row(new.starts_at,new.ends_at,new.service_id,new.professional_id,new.client_id)
       is distinct from row(old.starts_at,old.ends_at,old.service_id,old.professional_id,old.client_id)
     or (old.status in ('cancelled','no_show') and new.status in ('pending','confirmed')) then
    new.schedule_version := old.schedule_version+1;
    new.needs_reschedule := false;
    new.attendance_confirmed_at := null;
  end if;
  return new;
end;
$$;
create trigger bump_schedule before update on appointments for each row execute function private.bump_schedule();

create function public.save_appointment(p_company uuid,p_id uuid,p_data jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  company companies%rowtype;
  service services%rowtype;
  existing appointments%rowtype;
  saved uuid;
  professional uuid := (p_data->>'professional_id')::uuid;
  client uuid := nullif(p_data->>'client_id','')::uuid;
  service_key uuid := nullif(p_data->>'service_id','')::uuid;
  starts timestamptz := (p_data->>'starts_at')::timestamptz;
  ends timestamptz := starts+make_interval(mins=>(p_data->>'duration_minutes')::int);
  block boolean := coalesce((p_data->>'block')::boolean,false);
  label text;
  shade text;
  price bigint;
  new_status appointment_status;
begin
  perform private.require_scheduler(p_company);
  select * into company from companies where id=p_company for share;
  if p_id is not null then
    select * into existing from appointments where company_id=p_company and id=p_id for update;
    if not found or existing.status in ('completed','in_progress') then
      raise exception using errcode='22023',message='Este horário não pode ser editado.';
    end if;
    if existing.updated_at is distinct from (p_data->>'updated_at')::timestamptz then
      raise exception using errcode='40001',message='Este horário foi alterado. Atualize a agenda e tente novamente.';
    end if;
    if (existing.kind='block')<>block then
      raise exception using errcode='22023',message='O tipo de registro não pode ser alterado.';
    end if;
  end if;

  if block then
    perform 1 from members where id=professional and company_id=p_company and active and bookable for share;
    if not found then raise exception using errcode='22023',message='Selecione uma profissional disponível.'; end if;
    label := coalesce(nullif(btrim(p_data->>'title'),''),'Horário bloqueado');
    shade := '#7B7380';
    price := 0;
    new_status := 'confirmed';
    client := null;
    service_key := null;
  else
    select * into service from services where id=service_key and company_id=p_company
      and (active or existing.service_id=service_key) for share;
    if not found then raise exception using errcode='22023',message='Selecione um serviço disponível.'; end if;
    if client is null or not exists(select 1 from clients where company_id=p_company and id=client) then
      raise exception using errcode='22023',message='Selecione uma cliente desta empresa.';
    end if;
    if existing.service_id is distinct from service_key or existing.professional_id is distinct from professional
      or existing.starts_at is distinct from starts or existing.ends_at is distinct from ends
      or existing.status in ('cancelled','no_show') then
      perform private.assert_assignment(p_company,service_key,professional);
      perform private.assert_working_time(company,starts,ends);
    end if;
    label := case when existing.service_id=service_key then existing.title else service.name end;
    shade := service.color;
    price := coalesce((p_data->>'price_cents')::bigint,service.price_cents);
    new_status := case when existing.status in ('pending','confirmed') then existing.status
      else coalesce((p_data->>'initial_status')::appointment_status,'pending') end;
    if new_status not in ('pending','confirmed') then
      raise exception using errcode='22023',message='Selecione um status de agendamento válido.';
    end if;
  end if;

  if p_id is null then
    insert into appointments(company_id,professional_id,client_id,service_id,kind,title,color,status,
      starts_at,ends_at,price_cents,notes)
    values(p_company,professional,client,service_key,case when block then 'block' else 'appointment' end,
      label,shade,new_status,starts,ends,price,coalesce(p_data->>'notes','')) returning id into saved;
  else
    update appointments set professional_id=professional,client_id=client,service_id=service_key,title=label,
      color=shade,status=new_status,starts_at=starts,ends_at=ends,price_cents=price,notes=coalesce(p_data->>'notes','')
    where id=p_id returning id into saved;
  end if;
  return saved;
exception when exclusion_violation then
  raise exception using errcode='23P01',message='A profissional já tem um atendimento ou bloqueio nesse horário.';
end;
$$;

create function public.change_appointment_status(p_company uuid,p_id uuid,p_status appointment_status) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  event appointments%rowtype;
begin
  select * into event from appointments where company_id=p_company and id=p_id for update;
  if not found or not coalesce(private.can_schedule(p_company) or private.member_id(p_company)=event.professional_id,false) then
    raise exception using errcode='42501',message='Atendimento indisponível para sua conta.';
  end if;
  if event.status=p_status then return; end if;
  if event.status not in ('pending','confirmed','in_progress')
      or p_status not in ('confirmed','in_progress','cancelled','no_show')
      or (event.kind='block' and p_status<>'cancelled')
      or (event.status='in_progress' and p_status not in ('cancelled','no_show')) then
    raise exception using errcode='22023',message='Esta mudança de status não está disponível.';
  end if;
  update appointments set status=p_status,needs_reschedule=false where id=p_id;
end;
$$;

create function public.appointment_materials(p_company uuid,p_id uuid)
returns table(product_id uuid,name text,quantity numeric,unit text,available numeric)
language sql stable security definer set search_path=public,pg_temp as $$
  select p.id,p.name,sm.quantity,p.unit,p.quantity
  from appointments a join service_materials sm on sm.service_id=a.service_id
  join products p on p.id=sm.product_id
  where a.company_id=p_company and a.id=p_id and
    (private.can_schedule(p_company) or private.member_id(p_company)=a.professional_id)
  order by p.name
$$;

create function public.finish_appointment(p_company uuid,p_id uuid,p_usage jsonb,p_method payment_method) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  event appointments%rowtype;
  mat record;
  saved uuid;
  local_day date := (now() at time zone 'America/Sao_Paulo')::date;
  formula_size int;
begin
  perform 1 from companies where id=p_company for share;
  select * into event from appointments where company_id=p_company and id=p_id for update;
  if not found or event.kind<>'appointment' or
    not coalesce(private.can_schedule(p_company) or private.member_id(p_company)=event.professional_id,false) then
    raise exception using errcode='42501',message='Atendimento indisponível para sua conta.';
  end if;
  if event.status='completed' then return p_id; end if;
  if event.status not in ('pending','confirmed','in_progress') then
    raise exception using errcode='22023',message='Somente atendimentos ativos podem ser concluídos.';
  end if;
  if p_method is not null and not private.can_schedule(p_company) then
    raise exception using errcode='42501',message='A recepção ou a administração pode registrar o pagamento.';
  end if;

  -- Keep the recipe stable during inventory consumption and acquire product locks in a consistent order.
  perform 1 from services where id=event.service_id for share;
  select count(*) into formula_size from service_materials where service_id=event.service_id;
  if jsonb_typeof(p_usage)<>'array' or jsonb_array_length(p_usage)<>formula_size then
    raise exception using errcode='22023',message='Os materiais do serviço mudaram. Reabra o atendimento e confira as quantidades.';
  end if;
  if exists(select product_id from jsonb_to_recordset(p_usage) x(product_id uuid,quantity numeric)
    group by product_id having count(*)>1) then
    raise exception using errcode='22023',message='Há materiais repetidos.';
  end if;

  for mat in select * from jsonb_to_recordset(p_usage) x(product_id uuid,quantity numeric) order by product_id loop
    if mat.quantity is null or mat.quantity::text in ('NaN','Infinity','-Infinity') or mat.quantity<0
      or mat.quantity>99999999 or mat.quantity<>round(mat.quantity,3) or not exists(
        select 1 from service_materials where service_id=event.service_id and product_id=mat.product_id) then
      raise exception using errcode='22023',message='Revise os materiais e as quantidades informadas.';
    end if;
    if mat.quantity>0 then
      perform private.apply_movement(p_company,mat.product_id,'consumption',mat.quantity,'Consumo no atendimento',p_id);
    end if;
  end loop;
  update appointments set status='completed',completed_at=now(),needs_reschedule=false where id=p_id returning id into saved;
  if event.price_cents>0 then
    insert into finance_entries(company_id,appointment_id,kind,description,category,amount_cents,occurred_on,settled_on,method)
    values(p_company,p_id,'income',event.title,'Atendimentos',event.price_cents,local_day,
      case when p_method is not null then local_day end,p_method);
  end if;
  return saved;
end;
$$;

create function private.notify_pending_payment() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.kind='income' and new.settled_on is null
    and (tg_op='INSERT' or old.settled_on is not null) then
    perform private.notify(new.company_id,'pending_payment','Há um pagamento de receita pendente.',new.id,null,'managers');
  end if;
  return null;
end;
$$;
create trigger pending_payment after insert or update of settled_on on finance_entries
  for each row execute function private.notify_pending_payment();

create function public.save_finance(p_company uuid,p_id uuid,p_data jsonb) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  saved uuid;
  settled date := nullif(p_data->>'settled_on','')::date;
  selected_method payment_method := nullif(p_data->>'method','')::payment_method;
begin
  perform private.require_manager(p_company);
  if settled is not null and (settled<(p_data->>'occurred_on')::date or
    settled>(now() at time zone 'America/Sao_Paulo')::date) then
    raise exception using errcode='22023',message='Informe uma data de pagamento entre o lançamento e hoje.';
  end if;
  if p_id is null then
    insert into finance_entries(company_id,kind,description,category,amount_cents,occurred_on,settled_on,method)
    values(p_company,p_data->>'kind',btrim(p_data->>'description'),coalesce(p_data->>'category',''),
      (p_data->>'amount_cents')::bigint,(p_data->>'occurred_on')::date,settled,selected_method) returning id into saved;
  else
    update finance_entries set kind=p_data->>'kind',description=btrim(p_data->>'description'),
      category=coalesce(p_data->>'category',''),amount_cents=(p_data->>'amount_cents')::bigint,
      occurred_on=(p_data->>'occurred_on')::date,settled_on=settled,method=selected_method
    where company_id=p_company and id=p_id and appointment_id is null and movement_id is null returning id into saved;
  end if;
  if saved is null then raise exception using errcode='22023',message='Este lançamento só permite atualizar o pagamento.'; end if;
  return saved;
end;
$$;

create function public.settle_finance(p_company uuid,p_id uuid,p_day date,p_method payment_method) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform private.require_manager(p_company);
  if p_day>(now() at time zone 'America/Sao_Paulo')::date or (p_day is null)<>(p_method is null) then
    raise exception using errcode='22023',message='Informe uma data de pagamento válida e a forma utilizada.';
  end if;
  update finance_entries set settled_on=p_day,method=p_method
    where company_id=p_company and id=p_id and (p_day is null or p_day>=occurred_on);
  if not found then raise exception using errcode='22023',message='Revise o lançamento e sua data de pagamento.'; end if;
end;
$$;

create function public.delete_finance(p_company uuid,p_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform private.require_manager(p_company);
  delete from finance_entries where company_id=p_company and id=p_id and appointment_id is null and movement_id is null;
  if not found then raise exception using errcode='22023',message='Lançamento automático ou inexistente.'; end if;
end;
$$;

grant execute on function public.staff_roster(uuid), public.save_client(uuid,uuid,jsonb),public.erase_client(uuid,uuid),
  public.save_product(uuid,uuid,jsonb),public.set_product_active(uuid,uuid,boolean),
  public.move_stock(uuid,uuid,movement_kind,numeric,text,bigint,payment_method),public.mark_shopping(uuid,uuid,boolean),
  public.save_service(uuid,uuid,jsonb,jsonb,uuid[]),public.set_service_active(uuid,uuid,boolean),
  public.save_appointment(uuid,uuid,jsonb),public.change_appointment_status(uuid,uuid,appointment_status),
  public.appointment_materials(uuid,uuid),public.finish_appointment(uuid,uuid,jsonb,payment_method),
  public.save_finance(uuid,uuid,jsonb),public.settle_finance(uuid,uuid,date,payment_method),public.delete_finance(uuid,uuid)
to authenticated;
