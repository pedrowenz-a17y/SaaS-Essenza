\set ON_ERROR_STOP 1
begin;
set local timezone = 'UTC';

create function pg_temp.require(p_condition boolean, p_message text) returns void
language plpgsql as $$
begin
  if p_condition is distinct from true then raise exception 'Falha: %',p_message; end if;
end;
$$;

do $test$
declare
  owner_user uuid := gen_random_uuid();
  other_user uuid := gen_random_uuid();
  professional_user uuid := gen_random_uuid();
  reception_user uuid := gen_random_uuid();
  company uuid;
  other_company uuid;
  professional uuid;
  invited uuid;
  receptionist uuid;
  customer uuid;
  another_customer uuid;
  isolated_customer uuid;
  product uuid;
  service uuid;
  schedule uuid;
  later_schedule uuid;
  lockout uuid;
  online uuid;
  version int;
  previous timestamptz;
  available boolean;
  result_row record;
  payload jsonb;
  due_job uuid;
  claimed timestamptz;
  seen int;
  day date := (now() at time zone 'America/Sao_Paulo')::date;
  next_monday date := day+(8-extract(isodow from day)::int)+7;
  first_slot timestamptz := (next_monday+time '09:00') at time zone 'America/Sao_Paulo';
  client_data jsonb := '{"name":"Ana Teste","phone":"+5511999991001","email":"ana@example.test","whatsapp":"+5511999991001","email_opt_in":true,"whatsapp_opt_in":true}';
  product_data jsonb := jsonb_build_object('name','Cola QA','unit','ml','initial_stock',3,'minimum',1,'cost_cents',2000,'expires_on',day+10);
  service_data jsonb := '{"name":"Extensão QA","price_cents":15000,"duration_minutes":60,"color":"#A75E78"}';
  appointment_data jsonb;
  public_data jsonb;
  recipe jsonb;
begin
  insert into auth.users(id,email,email_confirmed_at)
  values (owner_user,'owner.operations@example.test',now()),(other_user,'isolated.operations@example.test',now()),
    (professional_user,'professional.operations@example.test',now()),(reception_user,'reception.operations@example.test',now());
  perform set_config('request.jwt.claim.sub',owner_user::text,true);
  company := public.create_company('Empresa Operações QA','operacoes-qa','Proprietária QA');
  select id into professional from members where company_id=company and user_id=owner_user;
  customer := public.save_client(company,null,client_data);
  another_customer := public.save_client(company,null,client_data||'{"name":"Outro Cadastro","phone":"+5511999991002"}');
  perform pg_temp.require((select email_consented_at is not null and whatsapp_consented_at is not null from clients where id=customer),'consentimentos gravados');
  perform set_config('request.jwt.claim.sub',other_user::text,true);
  other_company := public.create_company('Outra Empresa QA','outra-operacoes-qa','Outra proprietária');
  isolated_customer := public.save_client(other_company,null,client_data);
  perform set_config('request.jwt.claim.sub',owner_user::text,true);
  set local role authenticated;
  select count(*) into seen from clients where id=isolated_customer;
  reset role;
  perform pg_temp.require(seen=0,'RLS isola clientes de outra empresa');
  begin
    perform public.save_client(other_company,isolated_customer,client_data);
    raise exception 'escopo de empresa aceito indevidamente';
  exception when insufficient_privilege then null; end;
  perform pg_temp.require(not has_function_privilege('authenticated','public.book_online(text,jsonb)','execute') and
    not has_function_privilege('anon','public.save_client(uuid,uuid,jsonb)','execute'),'RPCs com privilégios explícitos');

  invited := public.save_member(company,null,'Profissional QA','professional.operations@example.test','professional',true,true);
  receptionist := public.save_member(company,null,'Recepcionista QA','reception.operations@example.test','receptionist',true,false);
  perform set_config('request.jwt.claim.sub',professional_user::text,true);
  perform pg_temp.require((select count(*)=1 from public.my_invitations()),'convite para e-mail verificado');
  perform pg_temp.require(public.accept_company_invite(company)='operacoes-qa','aceite de convite');
  perform set_config('request.jwt.claim.sub',reception_user::text,true);
  perform public.accept_company_invite(company);
  begin
    perform public.save_product(company,null,product_data);
    raise exception 'recepção editou estoque';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claim.sub',owner_user::text,true);
  product := public.save_product(company,null,product_data);
  perform pg_temp.require((select quantity=3 from products where id=product),'saldo inicial');
  perform pg_temp.require((select count(*)=1 from stock_movements where product_id=product),'movimentação do saldo inicial');
  perform pg_temp.require((select count(*)=0 from notifications where entity_id=product),'sem falso alerta inicial');
  recipe := jsonb_build_array(jsonb_build_object('product_id',product,'quantity',2));
  service := public.save_service(company,null,service_data,recipe,array[professional,invited]);
  perform pg_temp.require((select count(*)=2 from service_professionals where service_id=service),'profissionais vinculadas');
  begin
    perform public.save_service(other_company,null,service_data,recipe,array[professional]);
    raise exception 'serviço de outra empresa aceito';
  exception when insufficient_privilege then null; end;

  appointment_data := jsonb_build_object('professional_id',professional,'client_id',customer,'service_id',service,
    'starts_at',first_slot,'duration_minutes',60,'initial_status','pending');
  schedule := public.save_appointment(company,null,appointment_data);
  begin
    perform public.save_appointment(company,null,appointment_data);
    raise exception 'conflito de agenda aceito';
  exception when exclusion_violation then null; end;
  later_schedule := public.save_appointment(company,null,appointment_data||jsonb_build_object('starts_at',first_slot+interval '1 hour'));
  lockout := public.save_appointment(company,null,jsonb_build_object('professional_id',professional,
    'starts_at',first_slot+interval '2 hours','duration_minutes',60,'block',true,'title','Bloqueio QA'));
  select exists(select 1 from public.booking_slots('operacoes-qa',service,professional,next_monday)
    where starts_at=first_slot+interval '2 hours') into available;
  perform pg_temp.require(not available,'bloqueio omitido das vagas públicas');
  select updated_at into previous from appointments where id=later_schedule;
  perform public.save_appointment(company,later_schedule,appointment_data||jsonb_build_object(
    'starts_at',first_slot+interval '3 hours','updated_at',previous));
  perform pg_temp.require((select schedule_version=2 and starts_at=first_slot+interval '3 hours'
    from appointments where id=later_schedule),'reagendamento atualiza versão');
  perform pg_temp.require((select count(*)=1 from reminder_jobs where appointment_id=later_schedule and status='skipped' and reason='rescheduled'),
    'reagendamento desativa aviso anterior');
  perform public.change_appointment_status(company,lockout,'cancelled');
  perform pg_temp.require(exists(select 1 from public.booking_slots('operacoes-qa',service,professional,next_monday)
    where starts_at=first_slot+interval '2 hours'),'remoção libera o horário');

  perform public.change_appointment_status(company,schedule,'confirmed');
  perform public.finish_appointment(company,schedule,recipe,null);
  perform public.finish_appointment(company,schedule,recipe,null);
  perform pg_temp.require((select quantity=1 from products where id=product),'baixa do estoque aplicada uma vez');
  perform pg_temp.require((select count(*)=1 from stock_movements where appointment_id=schedule),'sem baixa duplicada');
  perform pg_temp.require((select count(*)=1 from finance_entries where appointment_id=schedule and settled_on is null),'receita pendente gerada');
  begin
    perform public.finish_appointment(company,later_schedule,recipe,'pix');
    raise exception 'baixa acima do saldo aceito';
  exception when invalid_parameter_value then null; end;
  perform pg_temp.require((select quantity=1 from products where id=product) and
    (select status='pending' from appointments where id=later_schedule),'baixa inválida faz rollback');
  perform public.move_stock(company,product,'out',0.1,'Conferência',null,null);
  perform public.move_stock(company,product,'out',0.1,'Conferência',null,null);
  perform pg_temp.require((select count(*)=1 from notifications where entity_id=product and kind='low_stock'),'alerta de mínimo deduplicado');
  perform public.mark_shopping(company,product,true);
  perform pg_temp.require((select bought_at is not null from shopping_items where product_id=product),'lista marcada como comprada');
  perform public.move_stock(company,product,'in',2,'Compra QA',2000,'pix');
  perform pg_temp.require(not exists(select 1 from shopping_items where product_id=product),'reposição encerra a compra');
  select id into result_row from finance_entries where appointment_id=schedule;
  perform public.settle_finance(company,result_row.id,day,'pix');
  payload := public.finance_summary(company,day,day);
  perform pg_temp.require((payload->>'income')::int=15000 and (payload->>'expenses')::int=4000 and (payload->>'profit')::int=11000,
    'receita, compra e lucro estimado conciliados');

  public_data := jsonb_build_object('service_id',service,'professional_id',professional,
    'starts_at',first_slot+interval '4 hours','name','Cliente Online QA','phone','+5511999991999','email','online@example.test','email_opt_in',true);
  payload := public.book_online('operacoes-qa',public_data);
  online := (payload->>'id')::uuid;
  version := (payload->>'schedule_version')::int;
  perform pg_temp.require(payload->>'status'='pending','fluxo público com aprovação da empresa');
  perform pg_temp.require(not exists(select 1 from public.booking_slots('operacoes-qa',service,professional,next_monday)
    where starts_at=first_slot+interval '4 hours'),'ocupação online refletida nas vagas');
  begin
    perform public.apply_booking_action(online,version,'confirm');
    raise exception 'cliente contornou aprovação manual';
  exception when invalid_parameter_value then null; end;
  perform pg_temp.require(public.apply_booking_action(online,version,'reschedule')='requested','solicitação pública de reagendamento');
  perform public.change_appointment_status(company,online,'confirmed');
  perform pg_temp.require(public.apply_booking_action(online,version,'confirm')='confirmed','confirmação pública válida');
  perform public.apply_booking_action(online,version,'confirm');
  perform pg_temp.require((select count(*)=1 from notifications where entity_id=online and message='A cliente confirmou a presença.'),
    'confirmação de presença mesmo em agenda confirmada, sem duplicação');
  perform pg_temp.require(public.apply_booking_action(online,version,'cancel')='cancelled','cancelamento público dentro do prazo');
  perform pg_temp.require((select count(*)=0 from reminder_jobs where appointment_id=online and status='pending'),'cancelamento retira avisos pendentes');

  select j.id into due_job from reminder_jobs j where j.appointment_id=later_schedule and j.status='pending' and channel='internal';
  perform pg_temp.require((select run_at=(first_slot+interval '3 hours')-interval '24 hours' from reminder_jobs where id=due_job),'lembrete padrão de 24 horas');
  update reminder_jobs set next_attempt_at=now()-interval '1 second',run_at=now()-interval '1 second' where id=due_job;
  select c.claimed_at into claimed from public.claim_reminders(10) c where c.id=due_job;
  perform pg_temp.require(claimed is not null and not exists(select 1 from public.claim_reminders(10) c where c.id=due_job),
    'fila reserva cada envio uma vez');
  perform public.deliver_internal_reminder(due_job,claimed);
  perform public.deliver_internal_reminder(due_job,claimed);
  perform pg_temp.require((select count(*)=1 from notifications where entity_id=later_schedule and kind='upcoming'),
    'lembrete interno registra aviso real uma vez');
  perform public.scan_alerts();
  perform public.scan_alerts();
  perform pg_temp.require((select count(*)=1 from notifications where entity_id=product and kind='expiring'),'alerta de vencimento deduplicado');

  perform set_config('request.jwt.claim.sub',professional_user::text,true);
  set local role authenticated;
  select count(*) into seen from appointments where company_id=company;
  reset role;
  perform pg_temp.require(seen=0,'profissional vê somente sua agenda');
  begin
    perform public.change_appointment_status(company,later_schedule,'confirmed');
    raise exception 'profissional alterou agenda de outra integrante';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',reception_user::text,true);
  set local role authenticated;
  select count(*) into seen from finance_entries where company_id=company;
  reset role;
  perform pg_temp.require(seen=0,'recepção sem leitura de finanças');

  perform set_config('request.jwt.claim.sub',owner_user::text,true);
  perform public.read_notifications(company,null);
  set local role authenticated;
  select count(*) into seen from notification_list where company_id=company and not is_read;
  reset role;
  perform pg_temp.require(seen=0,'leitura individual atualiza contador');
  perform public.erase_client(company,customer);
  perform pg_temp.require(not exists(select 1 from clients where id=customer) and
    (select client_id is null and notes='' from appointments where id=schedule),'exclusão remove dados pessoais e anonimiza histórico');
  perform pg_temp.require(not exists(select 1 from reminder_jobs where appointment_id=schedule),'exclusão remove lembretes pessoais');
  perform pg_temp.require(exists(select 1 from clients where id=another_customer),'exclusão preserva outros registros');
end;
$test$;

select '1..10';
select 'ok 1 - RLS, privilégios e isolamento de empresas';
select 'ok 2 - cadastro de clientes, consentimentos e convites';
select 'ok 3 - disponibilidade, bloqueios e conflito de agenda';
select 'ok 4 - reagendamento e atualização de lembretes';
select 'ok 5 - consumo atômico com ajuste e conclusão idempotente';
select 'ok 6 - movimentações, alertas e lista de compras';
select 'ok 7 - transações, recebimentos e lucro estimado';
select 'ok 8 - agendamento público, aprovação e cancelamento';
select 'ok 9 - fila de lembretes, vencimentos e notificações lidas';
select 'ok 10 - permissões por função e exclusão de dados pessoais';
rollback;
