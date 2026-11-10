-- Equipment Service for Claude Code: the records an equipment dealer or distributor keeps
-- for the machines it has sold, installed and services under contract.
-- Plain Postgres. Runs on any Postgres 14+ and on embedded PGlite. No extensions.

create function stamp_updated() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- The businesses whose equipment you look after.
create table customers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null check (length(trim(name)) > 0),
  contact_name text not null default '',
  contact_email text,
  phone text,
  region text not null default '',
  external_ref text unique,                        -- the Salesforce Account Id, when imported
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Where the equipment stands: a warehouse, a plant room, a dairy shed.
create table sites (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  customer_id uuid not null references customers,
  name text not null check (length(trim(name)) > 0),
  address text not null default '',
  region text not null default '',
  access_notes text not null default '',           -- inductions, gate codes, hours
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The makers whose equipment you sell and claim warranty from.
create table makers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null check (length(trim(name)) > 0),
  claim_window_days integer not null default 30 check (claim_window_days > 0),  -- days from repair to lodge a claim
  labour_rate_cents integer check (labour_rate_cents >= 0),                     -- what the maker pays per warranty hour
  claims_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The installed base: every machine you sold, installed or look after.
create table equipment (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                       -- your unit number
  serial text not null check (length(trim(serial)) > 0),
  maker_id uuid references makers,
  model text not null default '',
  kind text not null check (kind in ('forklift','compressor','generator','refrigeration','pump','boiler','crane','elevating_work_platform','kitchen','dairy','other')),
  customer_id uuid not null references customers,
  site_id uuid references sites,
  installed_on date,
  warranty_ends_on date,
  hour_meter integer check (hour_meter >= 0),
  hours_read_on date,
  inspection_kind text not null default '',        -- a periodic statutory inspection, if the unit needs one
  inspection_due date,
  status text not null default 'in_service' check (status in ('in_service','out_of_service','removed')),
  external_ref text unique,                        -- the Salesforce Asset Id, when imported
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (maker_id, serial)
);

-- Service agreements: what you promised, for how long and for how much.
create table contracts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  customer_id uuid not null references customers,
  name text not null check (length(trim(name)) > 0),
  kind text not null check (kind in ('full_service','planned_maintenance','breakdown_only','extended_warranty')),
  starts_on date not null,
  ends_on date not null,
  response_hours integer check (response_hours > 0),   -- promised on-site time for a breakdown
  annual_value_cents integer not null default 0 check (annual_value_cents >= 0),
  covers_parts boolean not null default false,
  covers_labour boolean not null default true,
  renewal_notice_days integer not null default 60 check (renewal_notice_days >= 0),
  status text not null default 'active' check (status in ('active','ended','cancelled')),
  external_ref text unique,                        -- the Salesforce ServiceContract Id, when imported
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on > starts_on)
);

-- Which units each contract covers.
create table contract_equipment (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contracts,
  equipment_id uuid not null references equipment,
  created_at timestamptz not null default now(),
  unique (contract_id, equipment_id)
);

-- Planned maintenance: a task that comes round by date, by run hours, or both.
create table pm_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  equipment_id uuid not null references equipment,
  task text not null check (length(trim(task)) > 0),       -- "250 hour service", "annual safety inspection"
  interval_days integer check (interval_days > 0),
  interval_hours integer check (interval_hours > 0),
  baseline_on date not null,                       -- counted from here until the first visit is done
  baseline_hours integer not null default 0 check (baseline_hours >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (interval_days is not null or interval_hours is not null)
);

create table technicians (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null check (length(trim(name)) > 0),
  region text not null default '',
  phone text,
  cost_rate_cents integer not null default 0 check (cost_rate_cents >= 0),   -- what an hour of their time costs you
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Licences, tickets and maker training: anything with an expiry that lets a technician do the work.
create table tickets (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  technician_id uuid not null references technicians,
  kind text not null check (kind in ('licence','high_risk_work','refrigerant','electrical','maker_training','site_induction','other')),
  name text not null check (length(trim(name)) > 0),
  covers_kind text not null default '',            -- an equipment kind this ticket is needed for, if any
  reference text not null default '',
  expires_on date,
  evidence text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Work orders: breakdowns, planned visits, installs, inspections.
create table jobs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  customer_id uuid not null references customers,
  site_id uuid references sites,
  equipment_id uuid references equipment,
  contract_id uuid references contracts,
  plan_id uuid references pm_plans,
  kind text not null check (kind in ('breakdown','planned','install','inspection','warranty','other')),
  priority text not null default 'normal' check (priority in ('urgent','high','normal','low')),
  reported_at timestamptz not null,
  description text not null check (length(trim(description)) > 0),
  technician_id uuid references technicians,
  scheduled_on date,
  arrived_at timestamptz,
  completed_at timestamptz,
  hour_meter integer check (hour_meter >= 0),
  status text not null default 'open' check (status in ('open','scheduled','in_progress','waiting_parts','done','invoiced','cancelled')),
  resolution text not null default '',
  labour_minutes integer not null default 0 check (labour_minutes >= 0),
  chargeable boolean not null default true,
  fixed_first_visit boolean,
  checklist_done boolean not null default false,   -- the commissioning or inspection checklist was completed and filed
  invoiced_on date,
  external_ref text unique,                        -- the Salesforce WorkOrder Id, when imported
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (arrived_at is null or arrived_at >= reported_at),
  check (completed_at is null or arrived_at is null or completed_at >= arrived_at),
  check (status not in ('done','invoiced') or (completed_at is not null and length(trim(resolution)) > 0)),
  check (status <> 'invoiced' or invoiced_on is not null),
  check (kind <> 'planned' or plan_id is not null)
);

create table parts_used (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  job_id uuid not null references jobs,
  part_number text not null check (length(trim(part_number)) > 0),
  description text not null default '',
  qty numeric(10,2) not null check (qty > 0),
  unit_cost_cents integer not null default 0 check (unit_cost_cents >= 0),
  unit_price_cents integer not null default 0 check (unit_price_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Claims to the maker for repairs done under the maker's warranty.
create table warranty_claims (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  job_id uuid not null references jobs,
  claim_cents integer not null check (claim_cents >= 0),
  status text not null default 'draft' check (status in ('draft','submitted','approved','rejected','paid')),
  submitted_on date,
  maker_reference text not null default '',
  decided_on date,
  paid_cents integer check (paid_cents >= 0),
  reason text not null default '',                  -- the maker's reason when rejected or short paid
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'draft' or submitted_on is not null),
  check (status not in ('approved','rejected','paid') or decided_on is not null),
  check (status <> 'paid' or paid_cents is not null)
);

-- Hour meter readings, so run hours have a history and never go backwards.
create table meter_readings (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references equipment,
  read_on date not null,
  hours integer not null check (hours >= 0),
  source text not null default 'technician',
  created_at timestamptz not null default now()
);

-- Append-only diary of conversations and decisions about a customer, unit or contract.
create table notes (
  id uuid primary key default gen_random_uuid(),
  about text not null check (about in ('customers','equipment','contracts','technicians')),
  about_id uuid not null,
  happened_on date not null,
  author text not null,
  body text not null check (length(trim(body)) > 0),
  created_at timestamptz not null default now()
);

create function notes_append_only() returns trigger language plpgsql as $$
begin raise exception 'notes are append-only: add a new note instead'; end $$;
create trigger notes_append_only before update or delete on notes for each row execute function notes_append_only();

-- ---------------------------------------------------------------- guards

-- A site and a unit belong to one customer; a unit's site must be that customer's.
create function equipment_guard() returns trigger language plpgsql as $$
begin
  if new.site_id is not null and not exists (select 1 from sites where id = new.site_id and customer_id = new.customer_id) then
    raise exception 'Site belongs to a different customer from unit %', new.code;
  end if;
  if new.warranty_ends_on is not null and new.installed_on is not null and new.warranty_ends_on < new.installed_on then
    raise exception 'Warranty on unit % ends before it was installed', new.code;
  end if;
  return new;
end $$;
create trigger equipment_guard before insert or update on equipment for each row execute function equipment_guard();

create function contract_equipment_guard() returns trigger language plpgsql as $$
declare c contracts; e equipment;
begin
  select * into c from contracts where id = new.contract_id;
  select * into e from equipment where id = new.equipment_id;
  if c.customer_id <> e.customer_id then raise exception 'Unit % belongs to a different customer from contract %', e.code, c.code; end if;
  if e.status = 'removed' then raise exception 'Unit % has been removed and cannot go on a contract', e.code; end if;
  return new;
end $$;
create trigger contract_equipment_guard before insert or update on contract_equipment for each row execute function contract_equipment_guard();

-- A job's unit, site, contract and plan must all belong to the job's customer, and the contract must cover the unit.
create function job_guard() returns trigger language plpgsql as $$
declare e equipment; c contracts; p pm_plans; t technicians;
begin
  if new.equipment_id is not null then
    select * into e from equipment where id = new.equipment_id;
    if e.customer_id <> new.customer_id then raise exception 'Unit % belongs to a different customer', e.code; end if;
    if new.site_id is null then new.site_id = e.site_id; end if;
  end if;
  if new.site_id is not null and not exists (select 1 from sites where id = new.site_id and customer_id = new.customer_id) then
    raise exception 'Site belongs to a different customer';
  end if;
  if new.contract_id is not null then
    select * into c from contracts where id = new.contract_id;
    if c.customer_id <> new.customer_id then raise exception 'Contract % belongs to a different customer', c.code; end if;
    if new.equipment_id is not null and not exists (select 1 from contract_equipment where contract_id = c.id and equipment_id = new.equipment_id) then
      raise exception 'Contract % does not cover unit %', c.code, e.code;
    end if;
  end if;
  if new.plan_id is not null then
    select * into p from pm_plans where id = new.plan_id;
    if new.equipment_id is distinct from p.equipment_id then raise exception 'Plan % is for a different unit', p.code; end if;
    if new.status in ('done','invoiced') and p.interval_hours is not null and new.hour_meter is null then
      raise exception 'Plan % counts run hours: record the hour meter reading before closing the job', p.code;
    end if;
  end if;
  if new.technician_id is not null and tg_op = 'INSERT' then
    select * into t from technicians where id = new.technician_id;
    if not t.active then raise exception 'Technician % is not active', t.code; end if;
  end if;
  return new;
end $$;
create trigger job_guard before insert or update on jobs for each row execute function job_guard();

-- A claim only for a job on a unit that was under the maker's warranty when the job came in.
create function claim_guard() returns trigger language plpgsql as $$
declare j jobs; e equipment;
begin
  select * into j from jobs where id = new.job_id;
  if j.equipment_id is null then raise exception 'Job % has no unit: a warranty claim needs one', j.code; end if;
  select * into e from equipment where id = j.equipment_id;
  if e.maker_id is null then raise exception 'Unit % has no maker recorded', e.code; end if;
  if e.warranty_ends_on is null or e.warranty_ends_on < (j.reported_at at time zone 'UTC')::date then
    raise exception 'Unit % was out of warranty when job % came in', e.code, j.code;
  end if;
  return new;
end $$;
create trigger claim_guard before insert or update on warranty_claims for each row execute function claim_guard();

-- Run hours only go forward. The unit carries its latest reading.
create function meter_guard() returns trigger language plpgsql as $$
declare last integer;
begin
  select max(hours) into last from meter_readings where equipment_id = new.equipment_id and read_on <= new.read_on;
  if last is not null and new.hours < last then raise exception 'Hour meter cannot go backwards: % is below the last reading of %', new.hours, last; end if;
  update equipment set hour_meter = new.hours, hours_read_on = new.read_on
    where id = new.equipment_id and (hours_read_on is null or hours_read_on <= new.read_on);
  return new;
end $$;
create trigger meter_guard before insert on meter_readings for each row execute function meter_guard();

-- ---------------------------------------------------------------- views

-- The next planned visit for each plan, by date and by run hours, whichever comes first.
create view pm_due as
select p.id, p.code, p.task, e.id equipment_id, e.code unit, e.serial, e.kind, c.code customer_code, c.name customer,
  e.hour_meter, e.hours_read_on, p.interval_days, p.interval_hours,
  coalesce(ld.done_on, p.baseline_on) last_done_on,
  coalesce(ld.hours, p.baseline_hours) last_done_hours,
  case when p.interval_days is not null then coalesce(ld.done_on, p.baseline_on) + p.interval_days end next_due_on,
  case when p.interval_days is not null then coalesce(ld.done_on, p.baseline_on) + p.interval_days - current_date end days_left,
  case when p.interval_hours is not null and e.hour_meter is not null then coalesce(ld.hours, p.baseline_hours) + p.interval_hours - e.hour_meter end hours_left,
  (select j.code from jobs j where j.plan_id = p.id and j.status in ('open','scheduled','in_progress','waiting_parts') limit 1) open_job,
  (select ce.contract_id from contract_equipment ce join contracts k on k.id = ce.contract_id
     where ce.equipment_id = e.id and k.status = 'active' and current_date between k.starts_on and k.ends_on limit 1) contract_id
from pm_plans p
join equipment e on e.id = p.equipment_id
join customers c on c.id = e.customer_id
left join lateral (
  select (j.completed_at at time zone 'UTC')::date done_on, j.hour_meter hours from jobs j
  where j.plan_id = p.id and j.status in ('done','invoiced')
  order by j.completed_at desc limit 1
) ld on true
where p.active and e.status <> 'removed';

-- Each breakdown against the response time its contract promises.
create view job_response as
select j.id, j.code, j.kind, j.priority, j.status, c.name customer, e.code unit, k.code contract, k.response_hours,
  j.reported_at, j.arrived_at, t.name technician,
  case when k.response_hours is not null and j.kind = 'breakdown' then j.reported_at + k.response_hours * interval '1 hour' end due_at,
  case when j.arrived_at is not null then round(extract(epoch from (j.arrived_at - j.reported_at)) / 60)::int end response_minutes,
  case
    when k.response_hours is null or j.kind <> 'breakdown' then 'no promise'
    when j.arrived_at is not null and j.arrived_at <= j.reported_at + k.response_hours * interval '1 hour' then 'met'
    when j.arrived_at is not null then 'missed'
    when j.status = 'cancelled' then 'cancelled'
    when now() > j.reported_at + k.response_hours * interval '1 hour' then 'missed, not on site'
    else 'open, on the clock' end response
from jobs j
join customers c on c.id = j.customer_id
left join equipment e on e.id = j.equipment_id
left join contracts k on k.id = j.contract_id
left join technicians t on t.id = j.technician_id;

-- Contracts with their units, the time left and what they cost to service over the last 12 months.
create view contract_status as
select k.id, k.code, k.name, k.kind, c.code customer_code, c.name customer, k.starts_on, k.ends_on,
  k.ends_on - current_date days_left, k.renewal_notice_days, k.response_hours, k.annual_value_cents, k.status,
  (select count(*)::int from contract_equipment ce where ce.contract_id = k.id) units,
  coalesce(cost.labour_cents, 0)::int labour_cost_cents,
  coalesce(cost.parts_cents, 0)::int parts_cost_cents,
  coalesce(cost.jobs, 0)::int jobs_12_months,
  case when k.starts_on > current_date - 365 then 'under a year old' end note
from contracts k
join customers c on c.id = k.customer_id
left join lateral (
  select count(*) jobs,
    sum(round(j.labour_minutes * t.cost_rate_cents / 60.0)) filter (where k.covers_labour) labour_cents,
    (select sum(round(pu.qty * pu.unit_cost_cents)) from parts_used pu join jobs j2 on j2.id = pu.job_id
      where j2.contract_id = k.id and k.covers_parts and j2.status in ('done','invoiced')
        and j2.completed_at >= now() - interval '365 days'
        and not exists (select 1 from warranty_claims w where w.job_id = j2.id and w.status in ('approved','paid'))) parts_cents
  from jobs j left join technicians t on t.id = j.technician_id
  where j.contract_id = k.id and j.status in ('done','invoiced') and j.completed_at >= now() - interval '365 days'
) cost on true;

-- Warranty claims with the days the maker allows to lodge them.
create view claim_status as
select w.id, w.code, w.status, j.code job, e.code unit, e.serial, m.code maker_code, m.name maker, m.claim_window_days,
  (j.completed_at at time zone 'UTC')::date repaired_on,
  w.claim_cents, w.paid_cents, w.submitted_on, w.decided_on, w.maker_reference, w.reason,
  case when w.status = 'draft' and j.completed_at is not null
       then (j.completed_at at time zone 'UTC')::date + m.claim_window_days - current_date end days_to_lodge
from warranty_claims w
join jobs j on j.id = w.job_id
join equipment e on e.id = j.equipment_id
join makers m on m.id = e.maker_id;

-- Each unit with its contract, warranty and record of breakdowns.
create view equipment_status as
select e.id, e.code, e.serial, coalesce(m.name, '') maker, e.model, e.kind, c.code customer_code, c.name customer,
  coalesce(s.name, '') site, e.status, e.installed_on, e.warranty_ends_on,
  case when e.warranty_ends_on >= current_date then 'in warranty' when e.warranty_ends_on is not null then 'out of warranty' else 'unknown' end warranty,
  e.hour_meter, e.hours_read_on, e.inspection_kind, e.inspection_due,
  (select k.code from contract_equipment ce join contracts k on k.id = ce.contract_id
     where ce.equipment_id = e.id and k.status = 'active' and current_date between k.starts_on and k.ends_on order by k.ends_on desc limit 1) contract,
  (select count(*)::int from jobs j where j.equipment_id = e.id and j.kind in ('breakdown','warranty') and j.reported_at >= now() - interval '365 days' and j.status <> 'cancelled') breakdowns_12_months,
  (select count(*)::int from jobs j where j.equipment_id = e.id and j.status in ('open','scheduled','in_progress','waiting_parts')) open_jobs,
  (select count(*)::int from pm_plans p where p.equipment_id = e.id and p.active) plans
from equipment e
join customers c on c.id = e.customer_id
left join makers m on m.id = e.maker_id
left join sites s on s.id = e.site_id;

-- Tickets with the days they have left.
create view ticket_status as
select k.id, k.code, t.code technician_code, t.name technician, k.kind, k.name, k.covers_kind, k.reference, k.expires_on,
  k.expires_on - current_date days_left, k.evidence
from tickets k join technicians t on t.id = k.technician_id
where t.active;

-- ---------------------------------------------------------------- housekeeping

create trigger updated before update on customers for each row execute function stamp_updated();
create trigger updated before update on sites for each row execute function stamp_updated();
create trigger updated before update on makers for each row execute function stamp_updated();
create trigger updated before update on equipment for each row execute function stamp_updated();
create trigger updated before update on contracts for each row execute function stamp_updated();
create trigger updated before update on pm_plans for each row execute function stamp_updated();
create trigger updated before update on technicians for each row execute function stamp_updated();
create trigger updated before update on tickets for each row execute function stamp_updated();
create trigger updated before update on jobs for each row execute function stamp_updated();
create trigger updated before update on parts_used for each row execute function stamp_updated();
create trigger updated before update on warranty_claims for each row execute function stamp_updated();

alter table customers enable row level security;
alter table sites enable row level security;
alter table makers enable row level security;
alter table equipment enable row level security;
alter table contracts enable row level security;
alter table contract_equipment enable row level security;
alter table pm_plans enable row level security;
alter table technicians enable row level security;
alter table tickets enable row level security;
alter table jobs enable row level security;
alter table parts_used enable row level security;
alter table warranty_claims enable row level security;
alter table meter_readings enable row level security;
alter table notes enable row level security;
