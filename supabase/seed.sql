-- Fictional demo dealer: Example Equipment Services, a Melbourne forklift, compressor and
-- refrigeration dealer with 5 customers, 12 units, 5 service contracts and 4 technicians.
-- Every business, maker and person here is invented.
-- Dates are relative to today so the attention commands always have something to say.
-- Idempotent: every insert skips a record that is already there.

insert into customers (code, name, contact_name, contact_email, phone, region) values
  ('HARBOUR', 'Harbour Cold Stores', 'Leanne Moss', 'leanne@harbourcold.example', '03 9000 0101', 'Port Melbourne'),
  ('GREENLEAF', 'Greenleaf Produce', 'Tony Rizzo', 'tony@greenleaf.example', '03 9000 0202', 'Epping'),
  ('RIVERMILL', 'Rivermill Bakery', 'Anna Webb', 'anna@rivermill.example', '03 5200 0303', 'Geelong'),
  ('NORTHGATE', 'Northgate Logistics', 'Sunil Rao', 'sunil@northgate.example', '03 9000 0404', 'Laverton'),
  ('ORCHARDHILL', 'Orchard Hill Dairy', 'Kate Brennan', 'kate@orchardhill.example', '03 5600 0505', 'Gippsland')
on conflict (code) do nothing;

insert into sites (code, customer_id, name, address, region, access_notes)
select x.code, c.id, x.name, x.address, x.region, x.access
from (values
  ('HAR-DC', 'HARBOUR', 'Port Melbourne cold store', '12 Wharf Rd, Port Melbourne VIC', 'Port Melbourne', 'Freezer suits supplied. Report to dock office.'),
  ('GRE-EPP', 'GREENLEAF', 'Epping market warehouse', '40 Cooper St, Epping VIC', 'Epping', 'Market hours 4am to 11am: avoid the forklift aisles then.'),
  ('RIV-BAKE', 'RIVERMILL', 'Geelong bakery', '7 Mill Lane, Geelong VIC', 'Geelong', 'Site induction video before first visit.'),
  ('NOR-DC1', 'NORTHGATE', 'Laverton distribution centre', '200 Boundary Rd, Laverton North VIC', 'Laverton', 'Hi-vis and steel caps. Gate code from dispatch.'),
  ('ORC-SHED', 'ORCHARDHILL', 'Orchard Hill milking shed', '1450 Princes Hwy, Gippsland VIC', 'Gippsland', 'Not during milking: 5am to 8am and 3pm to 6pm.')
) as x(code, customer, name, address, region, access)
join customers c on c.code = x.customer
on conflict (code) do nothing;

insert into makers (code, name, claim_window_days, labour_rate_cents, claims_email) values
  ('KESTREL', 'Kestrel Lift', 30, 9500, 'warranty@kestrellift.example'),
  ('BROLGA', 'Brolga Compressors', 45, 9000, 'claims@brolga.example'),
  ('SOUTHCROSS', 'Southcross Refrigeration', 21, 9800, 'service@southcross.example'),
  ('IRONBARK', 'Ironbark Power', 30, 8800, 'warranty@ironbark.example'),
  ('CLARION', 'Clarion Kitchens', 30, 8500, 'support@clarion.example')
on conflict (code) do nothing;

insert into equipment (code, serial, maker_id, model, kind, customer_id, site_id, installed_on, warranty_ends_on, inspection_kind, inspection_due)
select x.code, x.serial, m.id, x.model, x.kind, c.id, s.id, current_date + x.installed, current_date + x.warranty, x.inspection_kind, current_date + x.inspection
from (values
  ('U101', 'KL25-40091', 'KESTREL', 'FL25 2.5 t LPG forklift', 'forklift', 'HARBOUR', 'HAR-DC', -760, -30, '', null::int),
  ('U102', 'KL25-40377', 'KESTREL', 'FL25E 2.5 t electric forklift', 'forklift', 'HARBOUR', 'HAR-DC', -200, 530, '', null),
  ('U103', 'SX-CR-2210', 'SOUTHCROSS', 'CR40 freezer condensing unit', 'refrigeration', 'HARBOUR', 'HAR-DC', -900, -170, '', null),
  ('U201', 'KL30-31155', 'KESTREL', 'FL30 3 t diesel forklift', 'forklift', 'GREENLEAF', 'GRE-EPP', -1400, -670, '', null),
  ('U202', 'BR-SC22-0871', 'BROLGA', 'SC22 rotary screw compressor', 'compressor', 'GREENLEAF', 'GRE-EPP', -500, 230, '', null),
  ('U301', 'BR-SC37-0412', 'BROLGA', 'SC37 rotary screw compressor', 'compressor', 'RIVERMILL', 'RIV-BAKE', -670, 60, '', null),
  ('U302', 'BR-RV500-118', 'BROLGA', 'RV500 air receiver', 'boiler', 'RIVERMILL', 'RIV-BAKE', -670, -305, 'Pressure vessel external inspection', -12),
  ('U303', 'CK-CO10-5530', 'CLARION', 'CO10 combi oven', 'kitchen', 'RIVERMILL', 'RIV-BAKE', -420, -55, '', null),
  ('U401', 'KL-BM12-0098', 'KESTREL', 'BM12 12 m boom lift', 'elevating_work_platform', 'NORTHGATE', 'NOR-DC1', -300, 65, 'Annual EWP inspection', 20),
  ('U402', 'KL25-40502', 'KESTREL', 'FL25 2.5 t LPG forklift', 'forklift', 'NORTHGATE', 'NOR-DC1', -150, 580, '', null),
  ('U501', 'IB-VP-7741', 'IRONBARK', 'VP75 milking vacuum pump', 'dairy', 'ORCHARDHILL', 'ORC-SHED', -1100, -370, '', null),
  ('U502', 'IB-G60-2290', 'IRONBARK', 'G60 60 kVA standby generator', 'generator', 'ORCHARDHILL', 'ORC-SHED', -800, -70, '', null)
) as x(code, serial, maker, model, kind, customer, site, installed, warranty, inspection_kind, inspection)
join makers m on m.code = x.maker
join customers c on c.code = x.customer
join sites s on s.code = x.site
on conflict (code) do nothing;

-- Hour meter readings: the trigger keeps each unit's latest reading on the unit.
insert into meter_readings (equipment_id, read_on, hours, source)
select e.id, current_date + x.read_on, x.hours, 'technician'
from (values
  ('U101', -2, 4180), ('U102', -10, 380), ('U201', -3, 6080), ('U202', -30, 3100), ('U301', -20, 7950),
  ('U401', -60, 410), ('U402', -4, 1650), ('U501', -5, 9020), ('U502', -95, 1140)
) as x(unit, read_on, hours)
join equipment e on e.code = x.unit
where not exists (select 1 from meter_readings r where r.equipment_id = e.id);

insert into contracts (code, customer_id, name, kind, starts_on, ends_on, response_hours, annual_value_cents, covers_parts, covers_labour, renewal_notice_days, status)
select x.code, c.id, x.name, x.kind, current_date + x.starts, current_date + x.ends, x.response, x.value, x.parts, x.labour, 60, 'active'
from (values
  ('K-HARB', 'HARBOUR', 'Cold store fleet full service', 'full_service', -125, 240, 4, 1860000, true, true),
  ('K-GREEN', 'GREENLEAF', 'Forklift planned maintenance', 'planned_maintenance', -340, 25, null::int, 390000, false, true),
  ('K-RIVER', 'RIVERMILL', 'Bakery plant full service', 'full_service', -200, 165, 4, 480000, true, true),
  ('K-NORTH', 'NORTHGATE', 'Distribution centre fleet service', 'full_service', -100, 265, 4, 1200000, false, true),
  ('K-ORCH', 'ORCHARDHILL', 'Dairy shed planned maintenance', 'planned_maintenance', -380, -15, null, 240000, false, true)
) as x(code, customer, name, kind, starts, ends, response, value, parts, labour)
join customers c on c.code = x.customer
on conflict (code) do nothing;

insert into contract_equipment (contract_id, equipment_id)
select k.id, e.id
from (values ('K-HARB', 'U101'), ('K-HARB', 'U102'), ('K-HARB', 'U103'), ('K-GREEN', 'U201'),
  ('K-RIVER', 'U301'), ('K-RIVER', 'U302'), ('K-RIVER', 'U303'), ('K-NORTH', 'U401'), ('K-NORTH', 'U402'),
  ('K-ORCH', 'U501'), ('K-ORCH', 'U502')) as x(contract, unit)
join contracts k on k.code = x.contract
join equipment e on e.code = x.unit
on conflict (contract_id, equipment_id) do nothing;

insert into pm_plans (code, equipment_id, task, interval_days, interval_hours, baseline_on, baseline_hours)
select x.code, e.id, x.task, x.days, x.hours, current_date + x.base_on, x.base_hours
from (values
  ('P-101', 'U101', '500 hour service', 180, 500, -400, 2900),
  ('P-102', 'U102', '500 hour service', 180, 500, -150, 0),
  ('P-103', 'U103', 'Quarterly refrigeration service', 90, null::int, -100, 0),
  ('P-201', 'U201', '250 hour service', null::int, 250, -30, 5900),
  ('P-301', 'U301', 'Annual compressor service', 365, 4000, -515, 2500),
  ('P-302', 'U302', 'Six-monthly receiver and safety valve check', 182, null, -190, 0),
  ('P-401', 'U401', 'Quarterly EWP service', 91, null, -60, 0),
  ('P-402', 'U402', '500 hour service', 180, 500, -45, 1200),
  ('P-501', 'U501', 'Six-monthly vacuum pump service', 182, null, -170, 0),
  ('P-502', 'U502', '250 hour generator service', 365, 250, -100, 900)
) as x(code, unit, task, days, hours, base_on, base_hours)
join equipment e on e.code = x.unit
on conflict (code) do nothing;

insert into technicians (code, name, region, phone, cost_rate_cents) values
  ('JREID', 'Jordan Reid', 'West', '0400 100 001', 6800),
  ('PKAUR', 'Priya Kaur', 'Bayside', '0400 100 002', 7200),
  ('MLAWSON', 'Mia Lawson', 'North', '0400 100 003', 6500),
  ('BOKAFOR', 'Ben Okafor', 'Geelong and Gippsland', '0400 100 004', 7000)
on conflict (code) do nothing;

insert into tickets (code, technician_id, kind, name, covers_kind, reference, expires_on, evidence)
select x.code, t.id, x.kind, x.name, x.covers, x.ref, current_date + x.expires, x.evidence
from (values
  ('TK-JR-LF', 'JREID', 'high_risk_work', 'High risk work licence LF (forklift)', 'forklift', 'HRW 0412 882', 300, 'Licence copy in technician file'),
  ('TK-PK-ARC', 'PKAUR', 'refrigerant', 'Refrigerant handling licence', 'refrigeration', 'L123456', -9, 'Licence copy in technician file'),
  ('TK-PK-LF', 'PKAUR', 'high_risk_work', 'High risk work licence LF (forklift)', 'forklift', 'HRW 0398 114', 520, 'Licence copy in technician file'),
  ('TK-ML-WP', 'MLAWSON', 'high_risk_work', 'High risk work licence WP (boom over 11 m)', 'elevating_work_platform', 'HRW 0455 270', 18, 'Licence copy in technician file'),
  ('TK-ML-LF', 'MLAWSON', 'high_risk_work', 'High risk work licence LF (forklift)', 'forklift', 'HRW 0455 271', 410, 'Licence copy in technician file'),
  ('TK-BO-EL', 'BOKAFOR', 'electrical', 'Electrical licence (A grade)', '', 'EL 33019', 400, 'Licence copy in technician file'),
  ('TK-BO-BR', 'BOKAFOR', 'maker_training', 'Brolga SC series service training', '', 'Course SC-2', null::int, '')
) as x(code, tech, kind, name, covers, ref, expires, evidence)
join technicians t on t.code = x.tech
on conflict (code) do nothing;

-- Jobs. Times count back from now, so response times always read the same.
insert into jobs (code, customer_id, equipment_id, contract_id, plan_id, kind, priority, reported_at, description, technician_id,
  scheduled_on, arrived_at, completed_at, hour_meter, status, resolution, labour_minutes, chargeable, fixed_first_visit, checklist_done, invoiced_on)
select x.code, e.customer_id, e.id, k.id, p.id, x.kind, x.priority,
  now() - x.reported_h * interval '1 hour', x.description, t.id,
  case when x.scheduled is not null then current_date + x.scheduled end,
  case when x.arrived_h is not null then now() - (x.reported_h - x.arrived_h) * interval '1 hour' end,
  case when x.completed_h is not null then now() - (x.reported_h - x.completed_h) * interval '1 hour' end,
  x.meter, x.status, x.resolution, x.labour, x.chargeable, x.first_visit, x.checklist,
  case when x.invoiced is not null then current_date + x.invoiced end
from (values
  ('J-1001', 'U402', 'K-NORTH', null, 'breakdown', 'urgent', 6, 'Will not lift. Hydraulic hose leaking at the mast.', null, null::int, null::numeric, null::numeric, null::int, 'open', '', 0, false, null::boolean, false, null::int),
  ('J-1002', 'U201', 'K-GREEN', null, 'breakdown', 'high', 2, 'Reverse alarm and lights out.', 'JREID', 0, null, null, null, 'scheduled', '', 0, true, null, false, null),
  ('J-1003', 'U101', 'K-HARB', 'P-101', 'planned', 'normal', 48, '500 hour service.', 'JREID', 2, null, null, null, 'scheduled', '', 0, false, null, false, null),
  ('J-1004', 'U102', 'K-HARB', null, 'warranty', 'high', 240, 'Drive motor controller fault code E41.', 'PKAUR', null, 3, 5, 380, 'done', 'Replaced drive controller under warranty. Tested under load.', 120, false, true, false, null),
  ('J-1005', 'U102', 'K-HARB', null, 'warranty', 'normal', 600, 'Seat switch intermittent, truck cutting out.', 'PKAUR', null, 3.5, 5, 290, 'done', 'Replaced seat switch harness.', 75, false, true, false, null),
  ('J-1006', 'U201', 'K-GREEN', null, 'breakdown', 'high', 960, 'Overheating on long runs.', 'JREID', null, 6, 9, 5980, 'invoiced', 'Radiator core blocked. Cleaned and replaced thermostat.', 180, true, true, false, -35),
  ('J-1007', 'U201', 'K-GREEN', null, 'breakdown', 'normal', 2880, 'Mast chain stretched.', 'JREID', null, 20, 22, 5710, 'invoiced', 'Replaced both mast chains.', 150, true, true, false, -115),
  ('J-1008', 'U201', 'K-GREEN', null, 'breakdown', 'high', 3500, 'Steering heavy.', 'MLAWSON', null, 5, 8, 5400, 'invoiced', 'Second visit: steer cylinder seals replaced.', 300, true, false, false, -140),
  ('J-1009', 'U301', 'K-RIVER', null, 'breakdown', 'urgent', 480, 'Compressor tripping on high temperature. Bakery on backup air.', 'BOKAFOR', null, 7, 12, 7900, 'done', 'Replaced thermostatic valve and oil cooler. Ran two hours to confirm.', 360, false, true, false, null),
  ('J-1010', 'U301', 'K-RIVER', null, 'breakdown', 'high', 2160, 'Oil carry-over into the air line.', 'BOKAFOR', null, 2, 6, 7300, 'done', 'Replaced separator element and scavenge line.', 240, false, true, false, null),
  ('J-1011', 'U301', 'K-RIVER', 'P-301', 'planned', 'normal', 3600, 'Annual compressor service.', 'BOKAFOR', null, 0.5, 3.5, 6500, 'done', 'Annual service: oil, filters, separator check, safety valve tested.', 180, false, true, true, null),
  ('J-1013', 'U103', 'K-HARB', 'P-103', 'planned', 'normal', 24, 'Quarterly refrigeration service.', 'PKAUR', 1, null, null, null, 'scheduled', '', 0, false, null, false, null),
  ('J-1014', 'U502', 'K-ORCH', 'P-502', 'planned', 'normal', 30, '250 hour generator service.', 'BOKAFOR', 5, null, null, null, 'scheduled', '', 0, false, null, false, null),
  ('J-1015', 'U501', 'K-ORCH', null, 'breakdown', 'high', 130, 'Vacuum pump noisy, vacuum dropping.', 'BOKAFOR', null, 5, 8, 9010, 'done', 'Replaced vanes and pulley belt.', 180, true, true, false, null),
  ('J-1016', 'U401', 'K-NORTH', null, 'install', 'normal', 7200, 'Deliver and commission new boom lift.', 'MLAWSON', null, 1, 6, 0, 'invoiced', 'Delivered, assembled and handed over to Sunil.', 300, true, true, false, -295),
  ('J-1017', 'U101', 'K-HARB', null, 'breakdown', 'high', 1440, 'LPG regulator freezing.', 'JREID', null, 3, 5, 3700, 'done', 'Replaced vaporiser regulator.', 120, false, true, false, null),
  ('J-1018', 'U101', 'K-HARB', 'P-101', 'planned', 'normal', 1680, '500 hour service.', 'JREID', null, 0.5, 3, 3560, 'done', 'Service done: oil, filters, brakes adjusted, chains lubricated.', 150, false, true, true, null),
  ('J-1019', 'U303', 'K-RIVER', null, 'breakdown', 'high', 216, 'Steam generator not heating.', 'BOKAFOR', null, 3, null, null, 'waiting_parts', '', 90, false, false, false, null),
  ('J-1020', 'U102', 'K-HARB', null, 'warranty', 'normal', 1920, 'Battery not holding charge.', 'PKAUR', null, 4, 6, 120, 'done', 'Two cells failed load test. Replaced battery module under warranty.', 150, false, true, false, null)
) as x(code, unit, contract, plan, kind, priority, reported_h, description, tech, scheduled, arrived_h, completed_h, meter, status, resolution, labour, chargeable, first_visit, checklist, invoiced)
join equipment e on e.code = x.unit
left join contracts k on k.code = x.contract
left join pm_plans p on p.code = x.plan
left join technicians t on t.code = x.tech
on conflict (code) do nothing;

insert into parts_used (code, job_id, part_number, description, qty, unit_cost_cents, unit_price_cents)
select x.code, j.id, x.part, x.description, x.qty, x.cost, x.price
from (values
  ('PU-01', 'J-1004', 'KL-CTRL-E48', 'Drive motor controller', 1, 61200, 0),
  ('PU-02', 'J-1005', 'KL-HARN-221', 'Seat switch harness', 1, 8400, 0),
  ('PU-03', 'J-1006', 'KL-RAD-30', 'Radiator core', 1, 72000, 104000),
  ('PU-04', 'J-1006', 'KL-THERM-82', 'Thermostat', 1, 3800, 6500),
  ('PU-05', 'J-1007', 'KL-CHN-30', 'Mast chain', 2, 21500, 32000),
  ('PU-06', 'J-1008', 'KL-SEAL-STR', 'Steer cylinder seal kit', 1, 9600, 15500),
  ('PU-07', 'J-1009', 'BR-TV-37', 'Thermostatic valve', 1, 68000, 0),
  ('PU-08', 'J-1009', 'BR-OC-37', 'Oil cooler', 1, 242000, 0),
  ('PU-09', 'J-1010', 'BR-SEP-37', 'Separator element', 1, 90000, 0),
  ('PU-10', 'J-1011', 'BR-SVC-37', 'Annual service kit', 1, 41000, 0),
  ('PU-11', 'J-1015', 'IB-VANE-75', 'Vane set', 1, 38000, 59000),
  ('PU-12', 'J-1015', 'IB-BELT-75', 'Pulley belt', 1, 4500, 7900),
  ('PU-13', 'J-1017', 'KL-REG-LPG', 'Vaporiser regulator', 1, 31000, 0),
  ('PU-14', 'J-1018', 'KL-SVC-500', '500 hour service kit', 1, 18500, 0),
  ('PU-15', 'J-1020', 'KL-BATT-M4', 'Battery module', 1, 148000, 0)
) as x(code, job, part, description, qty, cost, price)
join jobs j on j.code = x.job
on conflict (code) do nothing;

insert into warranty_claims (code, job_id, claim_cents, status, submitted_on, maker_reference, decided_on, paid_cents, reason)
select x.code, j.id, x.claim, x.status, current_date + x.submitted, x.ref, current_date + x.decided, x.paid, x.reason
from (values
  ('W-201', 'J-1004', 80200, 'draft', null::int, '', null::int, null::int, ''),
  ('W-202', 'J-1020', 162250, 'submitted', -72, 'KL-WC-88120', null, null, ''),
  ('W-203', 'J-1010', 126000, 'rejected', -80, 'BR-CL-4471', -40, null, 'Intake filter not changed at the interval in the operator manual.')
) as x(code, job, claim, status, submitted, ref, decided, paid, reason)
join jobs j on j.code = x.job
on conflict (code) do nothing;
