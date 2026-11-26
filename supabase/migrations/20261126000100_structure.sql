create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
revoke create on schema public from public, anon, authenticated;
create extension if not exists btree_gist with schema extensions;
set search_path = public, extensions;

create type staff_role as enum ('owner', 'admin', 'professional', 'receptionist');
create type appointment_status as enum ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show');
create type payment_method as enum ('pix', 'cash', 'credit', 'debit', 'other');
create type movement_kind as enum ('in', 'out', 'consumption', 'loss', 'adjustment');
create type notification_kind as enum (
  'new_booking', 'cancelled', 'rescheduled', 'confirmed', 'upcoming', 'low_stock', 'out_of_stock',
  'expiring', 'expired', 'high_usage', 'pending_payment', 'birthday'
);

create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 100),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,47}$'),
  timezone text not null default 'America/Sao_Paulo' check (timezone = 'America/Sao_Paulo'),
  description text not null default '' check (length(description) <= 700),
  address text not null default '' check (length(address) <= 250),
  logo_path text,
  working_hours jsonb not null default '{"1":{"open":"09:00","close":"18:00"},"2":{"open":"09:00","close":"18:00"},"3":{"open":"09:00","close":"18:00"},"4":{"open":"09:00","close":"18:00"},"5":{"open":"09:00","close":"18:00"},"6":{"open":"09:00","close":"13:00"}}',
  booking_enabled boolean not null default true,
  auto_confirm boolean not null default false,
  allow_customer_cancel boolean not null default true,
  cancel_hours int not null default 12 check (cancel_hours between 0 and 168),
  allow_negative_stock boolean not null default false,
  reminder_minutes int[] not null default array[1440] check (cardinality(reminder_minutes) <= 5),
  reminder_internal boolean not null default true,
  reminder_email boolean not null default false,
  reminder_whatsapp boolean not null default false,
  reminder_template text not null default 'Olá, {cliente}! Seu horário de {servico} está marcado para {data}, às {hora}, na {empresa}. Use este link para gerenciar seu atendimento: {link}' check (length(reminder_template) <= 1200),
  plan text not null default 'base',
  created_at timestamptz not null default now()
);

create table members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  email text not null check (length(email) between 3 and 254 and email = lower(email)),
  name text not null check (length(btrim(name)) between 2 and 100),
  role staff_role not null,
  active boolean not null default true,
  bookable boolean not null default false,
  created_at timestamptz not null default now(),
  unique (company_id, user_id),
  unique (company_id, email),
  unique (company_id, id)
);
create unique index members_one_owner on members(company_id) where role = 'owner';
create index members_user_lookup on members(user_id) where active;
create index members_invitation_lookup on members(email) where active and user_id is null;

create table clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 150),
  phone text not null check (phone ~ '^\+[1-9][0-9]{8,14}$'),
  whatsapp text check (whatsapp ~ '^\+[1-9][0-9]{8,14}$'),
  email text check (length(email) <= 254 and email = lower(email)),
  birthday date,
  notes text not null default '' check (length(notes) <= 2000),
  preferences text not null default '' check (length(preferences) <= 2000),
  email_consented_at timestamptz,
  whatsapp_consented_at timestamptz,
  consent_source text check (consent_source in ('office', 'online')),
  created_at timestamptz not null default now(),
  unique (company_id, id),
  check (email_consented_at is null or email is not null),
  check (whatsapp_consented_at is null or whatsapp is not null)
);
create index clients_directory on clients(company_id, name, id);
create index clients_contact on clients(company_id, phone, email);

create table products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 120),
  photo_path text,
  category text not null default '' check (length(category) <= 80),
  brand text not null default '' check (length(brand) <= 100),
  supplier text not null default '' check (length(supplier) <= 120),
  quantity numeric(14,3) not null default 0,
  minimum numeric(14,3) not null default 0 check (minimum >= 0),
  unit text not null check (length(btrim(unit)) between 1 and 24),
  cost_cents bigint not null default 0 check (cost_cents between 0 and 100000000000),
  expires_on date,
  location text not null default '' check (length(location) <= 150),
  notes text not null default '' check (length(notes) <= 2000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);
create index products_directory on products(company_id, active, name);

create table services (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null check (length(btrim(name)) between 2 and 120),
  category text not null default '' check (length(category) <= 80),
  description text not null default '' check (length(description) <= 1200),
  price_cents bigint not null check (price_cents between 0 and 100000000000),
  duration_minutes int not null check (duration_minutes between 5 and 720),
  color text not null default '#A75E78' check (color ~ '^#[0-9a-fA-F]{6}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, id)
);
create index services_directory on services(company_id, active, name);

create table service_materials (
  company_id uuid not null,
  service_id uuid not null,
  product_id uuid not null,
  quantity numeric(14,3) not null check (quantity > 0),
  primary key (service_id, product_id),
  foreign key (company_id, service_id) references services(company_id, id) on delete cascade,
  foreign key (company_id, product_id) references products(company_id, id)
);
create index service_materials_product on service_materials(company_id, product_id);

create table service_professionals (
  company_id uuid not null,
  service_id uuid not null,
  member_id uuid not null,
  primary key (service_id, member_id),
  foreign key (company_id, service_id) references services(company_id, id) on delete cascade,
  foreign key (company_id, member_id) references members(company_id, id)
);
create index service_professionals_member on service_professionals(company_id, member_id);

create table appointments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  professional_id uuid not null,
  client_id uuid,
  service_id uuid,
  kind text not null default 'appointment' check (kind in ('appointment', 'block')),
  title text not null check (length(btrim(title)) between 2 and 120),
  color text not null default '#A75E78' check (color ~ '^#[0-9a-fA-F]{6}$'),
  status appointment_status not null default 'pending',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  price_cents bigint not null default 0 check (price_cents between 0 and 100000000000),
  notes text not null default '' check (length(notes) <= 2000),
  source text not null default 'office' check (source in ('office', 'online')),
  needs_reschedule boolean not null default false,
  attendance_confirmed_at timestamptz,
  schedule_version int not null default 1,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, id),
  foreign key (company_id, professional_id) references members(company_id, id),
  foreign key (company_id, client_id) references clients(company_id, id) on delete set null (client_id),
  foreign key (company_id, service_id) references services(company_id, id),
  check (ends_at > starts_at and ends_at - starts_at <= interval '24h'),
  check ((kind = 'block' and service_id is null and client_id is null and price_cents = 0 and status in ('confirmed','cancelled')) or
         (kind = 'appointment' and service_id is not null)),
  check ((status = 'completed') = (completed_at is not null)),
  exclude using gist (
    company_id with =, professional_id with =, tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('pending', 'confirmed', 'in_progress', 'completed'))
);
create index appointments_timeline on appointments(company_id, starts_at);
create index appointments_client on appointments(company_id, client_id, starts_at desc);
create index appointments_professional on appointments(company_id, professional_id, starts_at);

create table stock_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  product_id uuid not null,
  appointment_id uuid,
  kind movement_kind not null,
  quantity_delta numeric(14,3) not null check (quantity_delta <> 0),
  quantity_after numeric(14,3) not null,
  cost_cents bigint not null check (cost_cents between 0 and 100000000000),
  notes text not null default '' check (length(notes) <= 2000),
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (company_id, product_id) references products(company_id, id),
  foreign key (company_id, appointment_id) references appointments(company_id, id),
  unique (appointment_id, product_id),
  unique (company_id, id)
);
create index movements_history on stock_movements(company_id, product_id, created_at desc);
create index movements_company_history on stock_movements(company_id, created_at desc);

create table shopping_items (
  company_id uuid not null,
  product_id uuid primary key,
  bought_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (company_id, product_id) references products(company_id, id) on delete cascade
);

create table finance_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  appointment_id uuid unique,
  movement_id uuid unique,
  kind text not null check (kind in ('income', 'expense')),
  description text not null check (length(btrim(description)) between 2 and 180),
  category text not null default '' check (length(category) <= 100),
  amount_cents bigint not null check (amount_cents between 0 and 100000000000),
  occurred_on date not null,
  settled_on date,
  method payment_method,
  created_at timestamptz not null default now(),
  foreign key (company_id, appointment_id) references appointments(company_id, id),
  foreign key (company_id, movement_id) references stock_movements(company_id, id),
  check ((settled_on is null and method is null) or (settled_on is not null and method is not null))
);
create index finance_occurrences on finance_entries(company_id, occurred_on desc);
create index finance_cash on finance_entries(company_id, settled_on desc);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  kind notification_kind not null,
  message text not null check (length(message) between 1 and 300),
  entity_id uuid,
  professional_id uuid,
  visibility text not null default 'everyone' check (visibility in ('everyone','agenda','managers')),
  created_at timestamptz not null default now(),
  foreign key (company_id, professional_id) references members(company_id, id)
);
create index notifications_company_history on notifications(company_id, created_at desc);

create table notification_reads (
  notification_id uuid not null references notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create table private.alert_states (
  company_id uuid not null references companies(id) on delete cascade,
  alert_key text not null,
  state text not null,
  primary key(company_id, alert_key)
);

create table reminder_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  appointment_id uuid not null,
  schedule_version int not null,
  channel text not null check (channel in ('internal','email','whatsapp')),
  purpose text not null check (purpose in ('reminder','confirmation')),
  offset_minutes int not null,
  run_at timestamptz not null,
  next_attempt_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','skipped','unknown')),
  attempts int not null default 0,
  claimed_at timestamptz,
  finished_at timestamptz,
  provider_id text,
  reason text,
  created_at timestamptz not null default now(),
  foreign key (company_id, appointment_id) references appointments(company_id, id) on delete cascade,
  unique (appointment_id, schedule_version, channel, purpose, offset_minutes)
);
create index reminder_queue on reminder_jobs(next_attempt_at) where status = 'pending';
create index reminder_history on reminder_jobs(company_id, created_at desc);

create table audit_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  entity text not null,
  entity_id uuid not null,
  action text not null,
  created_at timestamptz not null default now()
);
create index audit_history on audit_events(company_id, created_at desc);

create table private.rate_limits (
  scope text not null,
  key_hash text not null,
  bucket timestamptz not null,
  hits int not null,
  primary key (scope, key_hash, bucket)
);
