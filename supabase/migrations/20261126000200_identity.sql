alter default privileges revoke execute on functions from public;
alter default privileges in schema private revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
grant usage on schema private to authenticated;

create function private.member_role(p_company uuid) returns public.staff_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from members where company_id = p_company and user_id = (select auth.uid()) and active
$$;
create function private.member_id(p_company uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select id from members where company_id = p_company and user_id = (select auth.uid()) and active
$$;
create function private.can_manage(p_company uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(private.member_role(p_company) in ('owner','admin'), false)
$$;
create function private.can_schedule(p_company uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(private.member_role(p_company) in ('owner','admin','receptionist'), false)
$$;
create function private.require_manager(p_company uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not private.can_manage(p_company) then
    raise exception using errcode = '42501', message = 'Sem permissão para esta operação.';
  end if;
end;
$$;
create function private.require_scheduler(p_company uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not private.can_schedule(p_company) then
    raise exception using errcode = '42501', message = 'Sem permissão para gerenciar a agenda.';
  end if;
end;
$$;
create function private.works_on_appointment(p_company uuid, p_client uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from appointments
    where company_id = p_company and client_id = p_client and professional_id = private.member_id(p_company))
$$;
create function private.storage_manager(p_directory text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists(select 1 from members where company_id::text = p_directory and
    user_id = (select auth.uid()) and active and role in ('owner','admin'))
$$;
create function private.can_read_notification(p_company uuid, p_visibility text, p_professional uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select case p_visibility
    when 'managers' then private.can_manage(p_company)
    when 'agenda' then private.can_schedule(p_company) or private.member_id(p_company) = p_professional
    else private.member_id(p_company) is not null end
$$;

grant execute on function private.member_role(uuid), private.member_id(uuid), private.can_manage(uuid),
  private.can_schedule(uuid), private.works_on_appointment(uuid,uuid), private.storage_manager(text),
  private.can_read_notification(uuid,text,uuid) to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['companies','members','clients','products','services','service_materials',
    'service_professionals','appointments','stock_movements','shopping_items','finance_entries',
    'notifications','notification_reads','reminder_jobs','audit_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end;
$$;

create policy own_companies on companies for select to authenticated
  using (private.member_id(id) is not null);
create policy company_team on members for select to authenticated
  using (user_id = (select auth.uid()) or private.can_manage(company_id));
create policy client_directory on clients for select to authenticated
  using (private.can_schedule(company_id) or private.works_on_appointment(company_id, id));
create policy product_inventory on products for select to authenticated using (private.can_manage(company_id));
create policy service_catalog on services for select to authenticated
  using (private.member_id(company_id) is not null);
create policy material_catalog on service_materials for select to authenticated using (private.can_manage(company_id));
create policy professional_catalog on service_professionals for select to authenticated
  using (private.member_id(company_id) is not null);
create policy agenda on appointments for select to authenticated
  using (private.can_schedule(company_id) or private.member_id(company_id) = professional_id);
create policy stock_history on stock_movements for select to authenticated using (private.can_manage(company_id));
create policy shopping_list on shopping_items for select to authenticated using (private.can_manage(company_id));
create policy finances on finance_entries for select to authenticated using (private.can_manage(company_id));
create policy team_notifications on notifications for select to authenticated
  using (private.can_read_notification(company_id, visibility, professional_id));
create policy own_notification_reads on notification_reads for select to authenticated
  using (user_id = (select auth.uid()));
create policy sending_history on reminder_jobs for select to authenticated using (private.can_manage(company_id));
create policy operation_history on audit_events for select to authenticated using (private.can_manage(company_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('company-logos','company-logos',true,2097152,array['image/jpeg','image/png','image/webp']),
  ('product-photos','product-photos',false,2097152,array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy essenza_image_read on storage.objects for select to authenticated
  using (bucket_id in ('company-logos','product-photos') and private.storage_manager((storage.foldername(name))[1]));
create policy essenza_image_insert on storage.objects for insert to authenticated
  with check (bucket_id in ('company-logos','product-photos') and private.storage_manager((storage.foldername(name))[1]));
create policy essenza_image_delete on storage.objects for delete to authenticated
  using (bucket_id in ('company-logos','product-photos') and private.storage_manager((storage.foldername(name))[1]));

create function public.create_company(p_name text, p_slug text, p_member text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  new_company uuid;
  verified_email text;
begin
  select lower(email) into verified_email from auth.users
    where id = (select auth.uid()) and email_confirmed_at is not null;
  if verified_email is null then
    raise exception using errcode = '42501', message = 'Confirme seu e-mail para criar a empresa.';
  end if;
  insert into companies(name,slug) values(btrim(p_name), lower(btrim(p_slug))) returning id into new_company;
  insert into members(company_id,user_id,email,name,role,bookable)
    values(new_company,(select auth.uid()),verified_email,btrim(p_member),'owner',true);
  return new_company;
exception when unique_violation then
  raise exception using errcode = '23505', message = 'Este endereço de agendamento já está em uso.';
end;
$$;

create function public.my_invitations() returns table(company_id uuid, company_name text, slug text, role public.staff_role)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, c.name, c.slug, m.role
  from members m join companies c on c.id = m.company_id
  join auth.users u on lower(u.email) = m.email
  where u.id = (select auth.uid()) and u.email_confirmed_at is not null
    and m.user_id is null and m.active and m.role <> 'owner'
  order by c.name
$$;

create function public.accept_company_invite(p_company uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  accepted uuid;
begin
  update members m set user_id = (select auth.uid()) from auth.users u
    where m.company_id = p_company and m.role <> 'owner' and m.user_id is null and m.active
      and u.id = (select auth.uid()) and u.email_confirmed_at is not null and lower(u.email) = m.email
    returning m.id into accepted;
  if accepted is null then
    raise exception using errcode = '42501', message = 'Convite indisponível para sua conta.';
  end if;
  return (select slug from companies where id = p_company);
end;
$$;

create function public.save_member(p_company uuid, p_id uuid, p_name text, p_email text,
  p_role public.staff_role, p_active boolean, p_bookable boolean) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  saved uuid;
  existing members%rowtype;
  caller public.staff_role := private.member_role(p_company);
begin
  perform private.require_manager(p_company);
  if p_id is null then
    if p_role = 'owner' or (p_role = 'admin' and caller <> 'owner') then
      raise exception using errcode = '42501', message = 'Somente a proprietária pode convidar administradoras.';
    end if;
    if p_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception using errcode = '22023', message = 'Informe um e-mail válido.';
    end if;
    insert into members(company_id,name,email,role,active,bookable)
    values(p_company,btrim(p_name),lower(btrim(p_email)),p_role,p_active,p_bookable)
    returning id into saved;
  else
    select * into existing from members where company_id=p_company and id=p_id for update;
    if not found then raise exception using errcode='22023', message='Integrante não encontrada.'; end if;
    if caller <> 'owner' and (existing.role in ('owner','admin') or p_role in ('owner','admin')) then
      raise exception using errcode = '42501', message = 'Somente a proprietária pode editar esta função.';
    end if;
    if existing.role = 'owner' then
      update members set name=btrim(p_name),bookable=p_bookable where id=p_id returning id into saved;
    elsif p_role <> 'owner' then
      update members set name=btrim(p_name),role=p_role,active=p_active,bookable=p_bookable
        where id=p_id returning id into saved;
    else
      raise exception using errcode = '42501', message = 'O papel de proprietária é reservado à criação da empresa.';
    end if;
  end if;
  return saved;
exception when unique_violation then
  raise exception using errcode='23505', message='Já existe uma integrante com este e-mail na empresa.';
end;
$$;

create function private.notify(p_company uuid, p_kind public.notification_kind, p_message text,
  p_entity uuid, p_professional uuid default null, p_visibility text default 'everyone') returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into notifications(company_id,kind,message,entity_id,professional_id,visibility)
  values(p_company,p_kind,p_message,p_entity,p_professional,p_visibility)
$$;

create function public.read_notifications(p_company uuid, p_notification uuid default null) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into notification_reads(notification_id,user_id)
  select n.id,(select auth.uid()) from notifications n
  where n.company_id = p_company and (p_notification is null or n.id=p_notification)
    and private.can_read_notification(n.company_id,n.visibility,n.professional_id)
  on conflict do nothing
$$;

create view public.notification_list with (security_invoker = true) as
select n.*, r.read_at is not null as is_read
from public.notifications n
left join public.notification_reads r on r.notification_id=n.id and r.user_id=(select auth.uid());
revoke all on public.notification_list from public,anon,authenticated;
grant select on public.notification_list to authenticated;

create function private.audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  row_data jsonb := to_jsonb(case when tg_op='DELETE' then old else new end);
begin
  if tg_op='DELETE' and not exists(select 1 from companies where id=coalesce(row_data->>'company_id',row_data->>'id')::uuid) then
    return null;
  end if;
  insert into audit_events(company_id,actor_id,entity,entity_id,action)
  values (coalesce(row_data->>'company_id',row_data->>'id')::uuid,
    (select auth.uid()),tg_table_name,(row_data->>'id')::uuid,lower(tg_op));
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['companies','members','clients','products','services','appointments','stock_movements','finance_entries']
  loop
    execute format('create trigger audit_row after insert or update or delete on public.%I for each row execute function private.audit()',t);
  end loop;
end;
$$;

revoke execute on function public.create_company(text,text,text), public.my_invitations(), public.accept_company_invite(uuid),
  public.save_member(uuid,uuid,text,text,public.staff_role,boolean,boolean), public.read_notifications(uuid,uuid) from public,anon;
grant execute on function public.create_company(text,text,text), public.my_invitations(), public.accept_company_invite(uuid),
  public.save_member(uuid,uuid,text,text,public.staff_role,boolean,boolean), public.read_notifications(uuid,uuid) to authenticated;
