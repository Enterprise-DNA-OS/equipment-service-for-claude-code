#!/usr/bin/env node
// The one CLI. Every slash command in .claude/commands drives it.
//
//   npm run service -- <command> [arguments] [--json]
//   npm run service -- help
//
// Reads print a table (or JSON with --json). Writes take a JSON file (--data=)
// or explicit flags, resolve names case-insensitively and by id prefix, and
// list the candidates and exit 1 when a name matches more than one record.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { parseCsv, pick } from './lib/csv.mjs';
import { table } from './lib/format.mjs';

// ---------------------------------------------------------------- record types

export const fields = {
  customers: ['code', 'name', 'contact_name', 'contact_email', 'phone', 'region', 'external_ref', 'notes'],
  sites: ['code', 'customer_id', 'name', 'address', 'region', 'access_notes'],
  makers: ['code', 'name', 'claim_window_days', 'labour_rate_cents', 'claims_email'],
  equipment: ['code', 'serial', 'maker_id', 'model', 'kind', 'customer_id', 'site_id', 'installed_on', 'warranty_ends_on', 'inspection_kind', 'inspection_due', 'status', 'external_ref', 'notes'],
  contracts: ['code', 'customer_id', 'name', 'kind', 'starts_on', 'ends_on', 'response_hours', 'annual_value_cents', 'covers_parts', 'covers_labour', 'renewal_notice_days', 'status', 'external_ref', 'notes'],
  pm_plans: ['code', 'equipment_id', 'task', 'interval_days', 'interval_hours', 'baseline_on', 'baseline_hours', 'active'],
  technicians: ['code', 'name', 'region', 'phone', 'cost_rate_cents', 'active'],
  tickets: ['code', 'technician_id', 'kind', 'name', 'covers_kind', 'reference', 'expires_on', 'evidence'],
  jobs: ['code', 'customer_id', 'site_id', 'equipment_id', 'contract_id', 'plan_id', 'kind', 'priority', 'reported_at', 'description', 'technician_id', 'scheduled_on', 'arrived_at', 'completed_at', 'hour_meter', 'status', 'resolution', 'labour_minutes', 'chargeable', 'fixed_first_visit', 'checklist_done', 'invoiced_on', 'external_ref'],
  parts_used: ['code', 'job_id', 'part_number', 'description', 'qty', 'unit_cost_cents', 'unit_price_cents'],
  warranty_claims: ['code', 'job_id', 'claim_cents', 'status', 'submitted_on', 'maker_reference', 'decided_on', 'paid_cents', 'reason'],
};
const refs = { customer_id: 'customers', site_id: 'sites', maker_id: 'makers', equipment_id: 'equipment', contract_id: 'contracts', plan_id: 'pm_plans', technician_id: 'technicians', job_id: 'jobs' };
const integers = ['claim_window_days', 'labour_rate_cents', 'response_hours', 'annual_value_cents', 'renewal_notice_days', 'interval_days', 'interval_hours', 'baseline_hours', 'cost_rate_cents', 'hour_meter', 'labour_minutes', 'unit_cost_cents', 'unit_price_cents', 'claim_cents', 'paid_cents'];
const numbers = ['qty'];
const booleans = ['covers_parts', 'covers_labour', 'active', 'chargeable', 'fixed_first_visit', 'checklist_done'];
const required = ['code', 'name', 'serial', 'task', 'description', 'part_number', 'kind'];
const nameColumn = { equipment: 'serial', pm_plans: 'task', jobs: 'description', parts_used: 'part_number', warranty_claims: 'maker_reference' };
const OPEN = "('open','scheduled','in_progress','waiting_parts')";

// ---------------------------------------------------------------- reads

export const reads = {
  customers: `select c.code,c.name,c.contact_name,c.region,
    (select count(*)::int from equipment e where e.customer_id = c.id and e.status <> 'removed') units,
    (select count(*)::int from contracts k where k.customer_id = c.id and k.status = 'active') contracts,
    (select count(*)::int from jobs j where j.customer_id = c.id and j.status in ${OPEN}) open_jobs
    from customers c order by c.name`,
  units: 'select code,serial,maker,model,kind,customer,site,status,warranty,contract,hour_meter,inspection_due from equipment_status order by code',
  contracts: 'select code,customer,name,kind,starts_on,ends_on,days_left,response_hours,units,annual_value_cents,status from contract_status order by ends_on',
  technicians: `select t.code,t.name,t.region,t.active,
    (select count(*)::int from jobs j where j.technician_id = t.id and j.status in ${OPEN}) open_jobs,
    (select min(expires_on) from tickets k where k.technician_id = t.id) next_ticket_expiry
    from technicians t order by t.name`,
  plans: 'select code,unit,customer,task,interval_days,interval_hours,last_done_on,last_done_hours,next_due_on,days_left,hours_left,open_job from pm_due order by unit, code',
  'open-jobs': `select j.code,j.kind,j.priority,j.status,c.name customer,coalesce(e.code,'') unit,coalesce(t.name,'') technician,j.reported_at,j.scheduled_on,j.description
    from jobs j join customers c on c.id = j.customer_id left join equipment e on e.id = j.equipment_id left join technicians t on t.id = j.technician_id
    where j.status in ${OPEN} order by j.reported_at`,
  dispatch: `select r.code,r.priority,r.status,r.customer,r.unit,s.region,coalesce(r.technician,'unassigned') technician,r.reported_at,r.due_at,r.response,
    case when r.due_at is not null and r.arrived_at is null then round(extract(epoch from (r.due_at - now())) / 60)::int end minutes_to_due
    from job_response r join jobs j on j.id = r.id left join sites s on s.id = j.site_id
    where r.status in ${OPEN}
    order by case r.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, r.due_at nulls last, r.reported_at`,
  'pm-due': `select code plan,unit,customer,task,next_due_on,days_left,hours_left,coalesce(open_job,'') open_job from pm_due
    where (days_left is not null and days_left <= 30) or (hours_left is not null and hours_left <= 100)
    order by least(coalesce(days_left, 9999), coalesce(hours_left / 10, 9999))`,
  'unscheduled-pm': `select code plan,unit,customer,task,next_due_on,days_left,hours_left from pm_due
    where open_job is null and ((days_left is not null and days_left <= 14) or (hours_left is not null and hours_left <= 50))
    order by least(coalesce(days_left, 9999), coalesce(hours_left / 10, 9999))`,
  'response-times': `select r.contract,r.customer,k.response_hours promised_hours,count(*)::int breakdowns,
    count(*) filter (where r.response = 'met')::int met,
    count(*) filter (where r.response like 'missed%')::int missed,
    round(avg(r.response_minutes) / 60.0, 1) avg_hours_to_site
    from job_response r join contracts k on k.code = r.contract
    where r.response <> 'no promise' and r.reported_at >= now() - interval '90 days'
    group by r.contract, r.customer, k.response_hours order by missed desc, r.contract`,
  'missed-response': `select code,customer,unit,contract,response_hours,reported_at,due_at,arrived_at,response_minutes,coalesce(technician,'unassigned') technician from job_response
    where response like 'missed%' and reported_at >= now() - interval '90 days' order by reported_at desc`,
  'renewals-due': `select code,customer,name,ends_on,days_left,renewal_notice_days,annual_value_cents,units,status,
    case when days_left < 0 then 'ended, still marked active' else 'in the notice window' end why
    from contract_status where status = 'active' and days_left <= renewal_notice_days order by days_left`,
  'contract-margin': `select code,customer,kind,annual_value_cents,jobs_12_months,labour_cost_cents,parts_cost_cents,
    annual_value_cents - labour_cost_cents - parts_cost_cents margin_cents,
    case when annual_value_cents > 0 then round(100.0 * (annual_value_cents - labour_cost_cents - parts_cost_cents) / annual_value_cents) end margin_pct,
    coalesce(note,'') note
    from contract_status where status = 'active' order by margin_cents`,
  'warranty-claims': `select code,status,job,unit,maker,repaired_on,claim_cents,submitted_on,current_date - submitted_on days_with_maker,days_to_lodge,maker_reference from claim_status
    where status in ('draft','submitted','approved') order by status, days_to_lodge nulls last, submitted_on`,
  'warranty-unclaimed': `select j.code job,e.code unit,m.name maker,(j.completed_at at time zone 'UTC')::date repaired_on,
    (j.completed_at at time zone 'UTC')::date + m.claim_window_days - current_date days_to_lodge,
    coalesce((select sum(round(pu.qty * pu.unit_cost_cents)) from parts_used pu where pu.job_id = j.id), 0)::int parts_cents, j.labour_minutes
    from jobs j join equipment e on e.id = j.equipment_id join makers m on m.id = e.maker_id
    where j.status in ('done','invoiced') and j.kind in ('breakdown','warranty')
      and e.warranty_ends_on >= (j.reported_at at time zone 'UTC')::date
      and not exists (select 1 from warranty_claims w where w.job_id = j.id)
    order by days_to_lodge`,
  'warranty-recovery': `select maker,count(*)::int claims,sum(claim_cents)::int claimed_cents,
    coalesce(sum(paid_cents) filter (where status = 'paid'), 0)::int paid_cents,
    count(*) filter (where status = 'rejected')::int rejected,
    count(*) filter (where status in ('draft','submitted','approved'))::int open,
    case when count(*) filter (where status in ('paid','rejected')) > 0
      then round(100.0 * count(*) filter (where status = 'rejected') / count(*) filter (where status in ('paid','rejected'))) end rejected_pct
    from claim_status group by maker order by claimed_cents desc`,
  uncovered: `select e.code unit,e.serial,e.kind,e.customer,e.site,
    case when e.contract is null and exists (select 1 from contracts k join customers c on c.id = k.customer_id where c.code = e.customer_code and k.status = 'active' and k.ends_on >= current_date) then 'customer has a contract, this unit is not on it'
         when e.contract is null then 'no contract'
         else 'no maintenance plan' end gap
    from equipment_status e where e.status <> 'removed' and (e.contract is null or e.plans = 0) order by e.customer, e.code`,
  'repeat-breakdowns': `select code unit,serial,maker,model,customer,breakdowns_12_months,warranty from equipment_status
    where breakdowns_12_months >= 3 order by breakdowns_12_months desc`,
  'first-time-fix': `select t.name technician,count(*)::int jobs_done,
    count(*) filter (where j.fixed_first_visit)::int fixed_first_visit,
    round(100.0 * count(*) filter (where j.fixed_first_visit) / nullif(count(*) filter (where j.fixed_first_visit is not null), 0)) pct,
    round(sum(j.labour_minutes) / 60.0, 1) hours_on_jobs
    from jobs j join technicians t on t.id = j.technician_id
    where j.status in ('done','invoiced') and j.kind in ('breakdown','warranty') and j.completed_at >= now() - interval '180 days'
    group by t.name order by pct nulls last`,
  'stuck-jobs': `select j.code,j.status,c.name customer,coalesce(e.code,'') unit,coalesce(t.name,'unassigned') technician,
    (current_date - (j.reported_at at time zone 'UTC')::date) days_open,j.description
    from jobs j join customers c on c.id = j.customer_id left join equipment e on e.id = j.equipment_id left join technicians t on t.id = j.technician_id
    where j.status in ${OPEN} and (j.status = 'waiting_parts' or j.reported_at < now() - interval '7 days' or (j.technician_id is null and j.reported_at < now() - interval '4 hours'))
    order by days_open desc`,
  unbilled: `select j.code,c.name customer,coalesce(e.code,'') unit,j.kind,(j.completed_at at time zone 'UTC')::date completed_on,
    current_date - (j.completed_at at time zone 'UTC')::date days_waiting,round(j.labour_minutes / 60.0, 2) labour_hours,
    coalesce((select sum(round(pu.qty * pu.unit_price_cents)) from parts_used pu where pu.job_id = j.id), 0)::int parts_price_cents
    from jobs j join customers c on c.id = j.customer_id left join equipment e on e.id = j.equipment_id
    where j.status = 'done' and j.chargeable order by completed_on`,
  'inspections-due': `select code unit,serial,kind,customer,site,inspection_kind,inspection_due,inspection_due - current_date days_left from equipment_status
    where status <> 'removed' and inspection_kind <> '' and (inspection_due is null or inspection_due <= current_date + 30) order by inspection_due nulls first`,
  'tickets-due': `select code,technician,kind,name,expires_on,days_left,evidence from ticket_status
    where expires_on is null or expires_on <= current_date + 30 or evidence = '' order by expires_on nulls first`,
  'technician-load': `select t.name technician,t.region,
    count(j.id) filter (where j.status in ${OPEN})::int open_jobs,
    count(j.id) filter (where j.scheduled_on between current_date and current_date + 7)::int booked_next_7_days,
    count(j.id) filter (where j.status in ${OPEN} and j.priority in ('urgent','high'))::int urgent_or_high
    from technicians t left join jobs j on j.technician_id = t.id where t.active group by t.id order by open_jobs desc`,
  'service-history': `select e.code unit,j.code,j.kind,(j.completed_at at time zone 'UTC')::date done_on,j.hour_meter,coalesce(t.name,'') technician,j.resolution
    from jobs j join equipment e on e.id = j.equipment_id left join technicians t on t.id = j.technician_id
    where j.status in ('done','invoiced') order by j.completed_at desc limit 200`,
};

const READ_ONLY_EXTRA = ['customer', 'unit', 'contract', 'technician', 'job', 'compliance', 'attention'];

// ---------------------------------------------------------------- helpers

export function options(args) {
  const opts = {}, pos = [];
  for (const arg of args) {
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      opts[arg.slice(2, eq < 0 ? undefined : eq)] = eq < 0 ? true : arg.slice(eq + 1);
    } else pos.push(arg);
  }
  return { opts, pos };
}

const today = () => new Date().toISOString().slice(0, 10);
const dollars = (cents) => `${Number(cents) < 0 ? '-' : ''}$${(Math.abs(Number(cents)) / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function cell(key, v) {
  if (v === null || v === undefined) return '';
  if (key.endsWith('_cents')) return dollars(v);
  if (v instanceof Date) return v.toISOString().slice(0, 16).replace('T', ' ') + 'Z';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function print(value, json = false) {
  if (json) return JSON.stringify(value, null, 2);
  if (Array.isArray(value)) {
    if (!value.length) return '(none)';
    const keys = Object.keys(value[0]).filter((k) => !['id', 'created_at', 'updated_at'].includes(k));
    return table(value, keys.map((key) => ({ key, label: key.replace(/_cents$/, '').replaceAll('_', ' '), format: (v) => cell(key, v) })));
  }
  return Object.entries(value).map(([k, v]) => `${k.replaceAll('_', ' ').toUpperCase()}\n${print(Array.isArray(v) ? v : [{ value: v }])}`).join('\n\n');
}

export async function resolve(db, type, ref) {
  if (!fields[type]) throw Error(`Unknown record type: ${type}`);
  if (!ref || typeof ref !== 'string') throw Error(`A ${type} reference is required`);
  const label = nameColumn[type] || 'name';
  let rows = await db.query(`select * from ${type} where lower(code) = lower($1) or lower(${label}::text) = lower($1)`, [ref]);
  if (!rows.length) {
    rows = await db.query(`select * from ${type} where left(id::text, length($1)) = lower($1) or strpos(lower(code), lower($1)) > 0 or strpos(lower(${label}::text), lower($1)) > 0 order by code`, [ref]);
  }
  if (rows.length !== 1) {
    const e = Error(rows.length
      ? `Ambiguous ${type} "${ref}": ${rows.map((r) => `${r.code} (${r[label]})`).join('; ')}`
      : `No ${type} matches "${ref}"`);
    e.candidates = rows.map((r) => ({ id: r.id, code: r.code, name: r[label] }));
    throw e;
  }
  return rows[0];
}

function isDate(v) {
  return /^\d{4}-\d\d-\d\d$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
}
function checkStamp(k, v) {
  if (!isDate(String(v).slice(0, 10))) throw Error(`${k} needs a real calendar date`);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:\d\d)$/.test(v)) throw Error(`${k} needs an ISO timestamp with a time zone, for example 2026-11-10T08:30:00+11:00`);
}

export function validate(type, data) {
  if (!fields[type]) throw Error(`Unknown record type: ${type}`);
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Object.keys(data).length) throw Error('Supply a non-empty record object');
  for (const [k, v] of Object.entries(data)) {
    if (!fields[type].includes(k)) throw Error(`Unknown ${type} field: ${k}`);
    if (v === null) continue;
    if (integers.includes(k)) { if (!Number.isSafeInteger(v) || v < 0) throw Error(`${k} must be a whole number, zero or more`); continue; }
    if (numbers.includes(k)) { if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw Error(`${k} must be a number above zero`); continue; }
    if (booleans.includes(k)) { if (typeof v !== 'boolean') throw Error(`${k} must be true or false`); continue; }
    if (typeof v !== 'string') throw Error(`${k} must be text`);
    if (required.includes(k) && !v.trim()) throw Error(`${k} cannot be blank`);
    if ((k.endsWith('_on') || k.endsWith('_due')) && !isDate(v)) throw Error(`${k} needs a real YYYY-MM-DD date`);
    if (k.endsWith('_at')) checkStamp(k, v);
  }
}

export async function save(db, type, data, ref = null) {
  validate(type, data);
  const row = ref ? await resolve(db, type, ref) : null;
  if (row && 'code' in data && data.code !== row.code) throw Error('code cannot change; add a new record');
  const values = { ...data };
  for (const [key, target] of Object.entries(refs)) {
    if (typeof values[key] === 'string' && values[key] && fields[type].includes(key)) values[key] = (await resolve(db, target, values[key])).id;
  }
  const keys = Object.keys(values), params = Object.values(values);
  if (row) {
    params.push(row.id);
    return db.query(`update ${type} set ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')} where id = $${params.length} returning *`, params);
  }
  return db.query(`insert into ${type} (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, params);
}

const newCode = (prefix) => `${prefix}-${randomUUID().slice(0, 6).toUpperCase()}`;
const toCents = (v, flag) => {
  const cents = Math.round(Number(v) * 100);
  if (v === undefined || v === true || !Number.isSafeInteger(cents) || cents < 0) throw Error(`${flag} must be an amount in dollars, for example 1840.50`);
  return cents;
};
const whole = (v, flag) => {
  const n = Number(v);
  if (v === true || !Number.isSafeInteger(n) || n < 0) throw Error(`${flag} must be a whole number`);
  return n;
};

// ---------------------------------------------------------------- compliance

export async function compliance(db) {
  const issues = [];
  const add = (record, rule, finding, source) => issues.push({ record, rule, finding, source });

  for (const p of await db.query('select * from pm_due order by code')) {
    const late = [];
    if (p.days_left !== null && p.days_left < 0) late.push(`${-p.days_left} days`);
    if (p.hours_left !== null && p.hours_left < 0) late.push(`${-p.hours_left} run hours`);
    if (late.length) add(p.unit, 'PM-OVERDUE', `${p.task} overdue by ${late.join(' and ')}${p.open_job ? `; booked as ${p.open_job}` : '; not booked'}`, 'WHS Regulations 2011 r 213 (maintenance and inspection as the manufacturer recommends)');
  }
  for (const e of await db.query("select * from equipment_status where status <> 'removed' and inspection_kind <> '' and (inspection_due is null or inspection_due < current_date)")) {
    add(e.code, 'INSPECTION', e.inspection_due ? `${e.inspection_kind} overdue since ${e.inspection_due.toISOString?.().slice(0, 10) ?? e.inspection_due}` : `${e.inspection_kind}: no due date recorded`, 'WHS Regulations 2011 r 213; r 235 for registrable cranes; the plant registration or certificate conditions');
  }
  for (const s of await db.query("select p.unit, p.task, p.hours_left, e.hours_read_on, current_date - e.hours_read_on days_since from pm_due p join equipment e on e.id = p.equipment_id where p.interval_hours is not null and (e.hours_read_on is null or e.hours_read_on < current_date - 60)")) {
    add(s.unit, 'METER-STALE', s.hours_read_on ? `Run hours last read ${s.days_since} days ago; "${s.task}" is counted on hours` : `No hour meter reading; "${s.task}" is counted on hours`, 'WHS Regulations 2011 r 213 (cannot follow an hours schedule without readings)');
  }
  const needs = await db.query("select distinct covers_kind from tickets where covers_kind <> ''");
  const kinds = new Set(needs.map((n) => n.covers_kind));
  for (const j of await db.query(`select j.code, e.kind, e.code unit, t.id tech_id, t.name tech from jobs j join equipment e on e.id = j.equipment_id join technicians t on t.id = j.technician_id where j.status in ${OPEN}`)) {
    if (!kinds.has(j.kind)) continue;
    const ok = (await db.query('select 1 from tickets where technician_id = $1 and covers_kind = $2 and (expires_on is null or expires_on >= current_date)', [j.tech_id, j.kind])).length;
    if (!ok) add(j.code, 'TICKET-FIT', `${j.tech} is booked on ${j.unit} (${j.kind.replaceAll('_', ' ')}) without a current ticket for it`, 'WHS Regulations 2011 r 213 (work done by a competent person); state licensing for that work');
  }
  for (const k of await db.query('select * from ticket_status order by technician')) {
    if (k.expires_on && k.days_left < 0) add(k.technician, 'TICKET-EXPIRED', `${k.name} expired ${k.expires_on.toISOString?.().slice(0, 10) ?? k.expires_on}`, k.kind === 'high_risk_work' ? 'WHS Regulations 2011 Part 4.5 (high risk work licences)' : 'State or national licensing for that work');
    if (!k.evidence) add(k.technician, 'EVIDENCE', `${k.name}: no copy on file`, 'Operator policy: keep a copy of every ticket');
  }
  for (const j of await db.query("select j.code, coalesce(e.code, '') unit from jobs j left join equipment e on e.id = j.equipment_id where j.kind = 'install' and j.status in ('done','invoiced') and not j.checklist_done")) {
    add(j.code, 'COMMISSIONING', `Install on ${j.unit} closed with no commissioning checklist filed`, 'WHS Act 2011 s 26; Health and Safety at Work Act 2015 (NZ) s 43 (duty of those who install and commission plant)');
  }
  for (const r of await db.query("select * from job_response where response like 'missed%' and reported_at >= now() - interval '30 days'")) {
    add(r.code, 'RESPONSE', r.response === 'missed' ? `On site in ${Math.round(r.response_minutes / 6) / 10} hours against a ${r.response_hours} hour promise (${r.contract})` : `Not on site and past the ${r.response_hours} hour promise (${r.contract})`, `Service agreement ${r.contract}: response time`);
  }
  for (const k of await db.query("select * from contract_status where status = 'active' and days_left < 0")) {
    const jobs = (await db.query(`select count(*)::int n from jobs where contract_id = $1 and status in ${OPEN}`, [k.id]))[0].n;
    add(k.code, 'CONTRACT-ENDED', `Ended ${-k.days_left} days ago and still marked active${jobs ? `; ${jobs} open job(s) booked against it` : ''}`, `Service agreement ${k.code}: term`);
  }
  for (const k of await db.query("select * from contract_status where status = 'active' and days_left >= 0 and days_left <= renewal_notice_days")) {
    add(k.code, 'RENEWAL', `Ends in ${k.days_left} days, inside the ${k.renewal_notice_days} day renewal window`, 'Operator policy: renewal notice period');
  }
  for (const u of await db.query(reads['warranty-unclaimed'])) {
    add(u.job, 'WARRANTY-WINDOW', u.days_to_lodge < 0 ? `No claim lodged and the ${u.maker} window closed ${-u.days_to_lodge} days ago` : `No claim lodged; ${u.days_to_lodge} days left in the ${u.maker} window`, `${u.maker} warranty policy: claim window`);
  }
  for (const w of await db.query("select * from claim_status where status = 'draft' and days_to_lodge is not null and days_to_lodge <= 7")) {
    add(w.code, 'WARRANTY-WINDOW', `Draft claim not lodged; ${w.days_to_lodge} days left`, `${w.maker} warranty policy: claim window`);
  }
  for (const w of await db.query("select * from claim_status where status = 'submitted' and submitted_on < current_date - 30")) {
    add(w.code, 'CLAIM-STALE', `With ${w.maker} for ${Math.round((Date.now() - new Date(w.submitted_on).getTime()) / 86400000)} days with no decision`, 'Operator policy: chase claims after 30 days');
  }
  for (const b of await db.query("select * from (" + reads.unbilled + ") u where days_waiting > 3")) {
    add(b.code, 'UNBILLED', `Done ${b.days_waiting} days ago, chargeable and not invoiced`, 'Operator policy: invoice within 3 days of completion');
  }
  return issues;
}

// ---------------------------------------------------------------- writes with rules

async function logNote(db, type, ref, { author, text, date }) {
  if (!['customers', 'equipment', 'contracts', 'technicians'].includes(type)) throw Error('log works on customers, equipment, contracts or technicians');
  if (!author || !text || !date) throw Error('log needs --author, --text and --date');
  if (!isDate(date)) throw Error('--date needs a real YYYY-MM-DD date');
  const row = await resolve(db, type, ref);
  return db.query('insert into notes (about, about_id, happened_on, author, body) values ($1,$2,$3,$4,$5) returning about, happened_on, author, body', [type, row.id, date, author, text]);
}

async function activeContract(db, equipmentId) {
  return (await db.query(`select k.* from contract_equipment ce join contracts k on k.id = ce.contract_id
    where ce.equipment_id = $1 and k.status = 'active' and current_date between k.starts_on and k.ends_on order by k.ends_on desc limit 1`, [equipmentId]))[0] || null;
}

async function raiseJob(db, unitRef, o) {
  if (!o.text) throw Error('raise needs --text (what the customer reported)');
  const kind = o.kind || 'breakdown';
  if (kind === 'planned') throw Error('Book planned work against its plan: raise <unit> --plan=<plan code>');
  const e = await resolve(db, 'equipment', unitRef);
  const k = await activeContract(db, e.id);
  const data = { code: o.code || newCode('J'), customer_id: e.customer_id, equipment_id: e.id, kind, priority: o.priority || 'normal', reported_at: o.at || new Date().toISOString(), description: o.text };
  if (k) data.contract_id = k.id;
  if (o.plan) {
    const p = await resolve(db, 'pm_plans', o.plan);
    data.plan_id = p.id; data.kind = 'planned';
  }
  if (o.tech) data.technician_id = (await resolve(db, 'technicians', o.tech)).id;
  if (o.on) { data.scheduled_on = o.on; data.status = 'scheduled'; }
  if (k && kind === 'breakdown' && !o.charge) data.chargeable = k.covers_labour ? false : true;
  validate('jobs', Object.fromEntries(Object.entries(data).filter(([key]) => !key.endsWith('_id'))));
  const keys = Object.keys(data);
  return db.query(`insert into jobs (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning code, kind, priority, status, reported_at`, Object.values(data));
}

async function assignJob(db, ref, o) {
  if (!o.tech) throw Error('assign needs --tech');
  const data = { technician_id: o.tech, status: 'scheduled' };
  if (o.on) data.scheduled_on = o.on;
  return save(db, 'jobs', data, ref);
}

async function arrive(db, ref, o) {
  const j = await resolve(db, 'jobs', ref);
  if (j.arrived_at) throw Error(`Job ${j.code} already has an arrival time`);
  return save(db, 'jobs', { arrived_at: o.at || new Date().toISOString(), status: 'in_progress' }, j.code);
}

async function completeJob(db, ref, o) {
  if (!o.note) throw Error('complete needs --note (what was found and done)');
  const j = await resolve(db, 'jobs', ref);
  const at = o.at || new Date().toISOString();
  const data = { status: 'done', completed_at: at, resolution: o.note, fixed_first_visit: !o['not-first-visit'] };
  if (!j.arrived_at) data.arrived_at = at;
  if (o.minutes !== undefined) data.labour_minutes = whole(o.minutes, '--minutes');
  if (o.hours !== undefined) data.hour_meter = whole(o.hours, '--hours');
  if (o.checklist) data.checklist_done = true;
  if (o['no-charge']) data.chargeable = false;
  await db.exec('BEGIN');
  try {
    const rows = await save(db, 'jobs', data, j.code);
    if (data.hour_meter !== undefined && j.equipment_id) await db.query('insert into meter_readings (equipment_id, read_on, hours, source) values ($1, $2, $3, $4)', [j.equipment_id, at.slice(0, 10), data.hour_meter, `job ${j.code}`]);
    await db.exec('COMMIT');
    return rows;
  } catch (e) { await db.exec('ROLLBACK'); throw e; }
}

async function addPart(db, ref, o) {
  if (!o.part) throw Error('part needs --part (the part number)');
  const qty = o.qty === undefined ? 1 : Number(o.qty);
  return save(db, 'parts_used', { code: newCode('PU'), job_id: ref, part_number: o.part, description: o.text || '', qty, unit_cost_cents: toCents(o.cost, '--cost'), unit_price_cents: o.price === undefined ? 0 : toCents(o.price, '--price') });
}

async function meter(db, ref, o) {
  const e = await resolve(db, 'equipment', ref);
  const hours = whole(o.hours, '--hours');
  const date = o.date || today();
  if (!isDate(date)) throw Error('--date needs a real YYYY-MM-DD date');
  await db.query('insert into meter_readings (equipment_id, read_on, hours, source) values ($1,$2,$3,$4)', [e.id, date, hours, o.source || 'customer']);
  return db.query('select code, hour_meter, hours_read_on from equipment where id = $1', [e.id]);
}

async function invoice(db, ref, o) {
  const j = await resolve(db, 'jobs', ref);
  if (j.status !== 'done') throw Error(`Job ${j.code} is ${j.status}: only a done job can be marked invoiced`);
  if (!j.chargeable) throw Error(`Job ${j.code} is not chargeable`);
  return save(db, 'jobs', { status: 'invoiced', invoiced_on: o.date || today() }, j.code);
}

async function raiseClaim(db, ref, o) {
  const j = await resolve(db, 'jobs', ref);
  const exists = await db.query('select code from warranty_claims where job_id = $1', [j.id]);
  if (exists.length) throw Error(`Job ${j.code} already has claim ${exists[0].code}`);
  let cents;
  if (o.amount !== undefined) cents = toCents(o.amount, '--amount');
  else {
    const r = (await db.query(`select coalesce((select sum(round(qty * unit_cost_cents)) from parts_used where job_id = $1), 0)::int parts,
      coalesce(round($2::int * m.labour_rate_cents / 60.0), 0)::int labour
      from equipment e left join makers m on m.id = e.maker_id where e.id = $3`, [j.id, j.labour_minutes, j.equipment_id]))[0] || { parts: 0, labour: 0 };
    cents = r.parts + r.labour;
  }
  return save(db, 'warranty_claims', { code: o.code || newCode('W'), job_id: j.code, claim_cents: cents, status: 'draft' });
}

async function lodgeClaim(db, ref, o) {
  if (!o.ref) throw Error('lodge needs --ref (the maker\'s claim number)');
  return save(db, 'warranty_claims', { status: 'submitted', submitted_on: o.date || today(), maker_reference: o.ref }, ref);
}

async function decideClaim(db, ref, o) {
  if (!['approved', 'rejected', 'paid'].includes(o.status)) throw Error('decide needs --status=approved|rejected|paid');
  const data = { status: o.status, decided_on: o.date || today() };
  if (o.status === 'paid') data.paid_cents = toCents(o.paid, '--paid');
  if (o.reason) data.reason = o.reason;
  if (o.status === 'rejected' && !o.reason) throw Error('A rejected claim needs --reason (the maker\'s words)');
  return save(db, 'warranty_claims', data, ref);
}

async function writeDraft(name, title, body) {
  const dir = path.resolve(process.env.OUTPUT_DIR || REPO_ROOT, 'drafts');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}-${today()}-${randomUUID().slice(0, 6)}.md`);
  fs.writeFileSync(file, `# DRAFT: ${title}\n\nNothing has been sent. Check every line against the source records before it is used.\n\n${body}\n`, { flag: 'wx' });
  return [{ file }];
}

function mdTable(rows) {
  if (!rows.length) return '_None._\n';
  const keys = Object.keys(rows[0]).filter((k) => k !== 'id');
  return [`| ${keys.map((k) => k.replace(/_cents$/, '').replaceAll('_', ' ')).join(' | ')} |`, `| ${keys.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${keys.map((k) => cell(k, r[k]).replaceAll('|', '/')).join(' | ')} |`)].join('\n') + '\n';
}

// ---------------------------------------------------------------- import

// Salesforce Data Export writes one CSV per object, with API field names as headers.
// These are the standard field names; --map=<json> renames them to whatever the file has.
export const importHeaders = {
  accounts: { external_ref: 'Id', code: 'AccountNumber', name: 'Name', phone: 'Phone', region: 'BillingCity' },
  assets: { external_ref: 'Id', name: 'Name', serial: 'SerialNumber', account: 'AccountId', installed_on: 'InstallDate', status: 'Status', kind: 'Kind', warranty_ends_on: 'WarrantyEndDate' },
  contracts: { external_ref: 'Id', code: 'ContractNumber', name: 'Name', account: 'AccountId', starts_on: 'StartDate', ends_on: 'EndDate', kind: 'Kind' },
  'contract-lines': { contract: 'ServiceContractId', asset: 'AssetId' },
  'work-orders': { external_ref: 'Id', code: 'WorkOrderNumber', account: 'AccountId', asset: 'AssetId', contract: 'ServiceContractId', subject: 'Subject', description: 'Description', priority: 'Priority', status: 'Status', created: 'CreatedDate', ended: 'EndDate', kind: 'Kind' },
};
const statusMap = { new: 'open', open: 'open', scheduled: 'scheduled', dispatched: 'scheduled', 'in progress': 'in_progress', 'on hold': 'waiting_parts', completed: 'done', closed: 'done', 'cannot complete': 'cancelled', canceled: 'cancelled', cancelled: 'cancelled' };
const priorityMap = { critical: 'urgent', high: 'high', medium: 'normal', low: 'low', '': 'normal' };
const assetStatus = { installed: 'in_service', registered: 'in_service', purchased: 'in_service', shipped: 'in_service', obsolete: 'removed', '': 'in_service' };
const dateOnly = (v) => (v ? v.slice(0, 10) : '');
const stamp = (v) => {
  if (!v) return '';
  const s = v.trim().replace(' ', 'T');
  if (/^\d{4}-\d\d-\d\d$/.test(s)) return s + 'T00:00:00Z';
  return /(Z|[+-]\d\d:?\d\d)$/.test(s) ? s.replace(/([+-]\d\d)(\d\d)$/, '$1:$2') : s + 'Z';
};
const tail = (id) => String(id).slice(0, 15).slice(-6);  // the 15-character Id without its checksum suffix

async function byRef(db, type, ref, line) {
  const row = (await db.query(`select * from ${type} where external_ref = $1`, [ref]))[0];
  if (!row) throw Error(`${line}: no ${type} imported with Salesforce Id ${ref}; import that file first`);
  return row;
}

export async function importFile(db, kind, file, { map = null, dryRun = false } = {}) {
  if (!importHeaders[kind]) throw Error(`--kind must be one of: ${Object.keys(importHeaders).join(', ')}`);
  if (!file) throw Error('Use --file=<CSV from the Salesforce Data Export>');
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  if (!rows.length) throw Error('The CSV has no rows');
  const mapping = { ...importHeaders[kind], ...(map ? JSON.parse(fs.readFileSync(map, 'utf8')) : {}) };
  for (const k of Object.keys(mapping)) if (!(k in importHeaders[kind])) throw Error(`Unknown mapping field ${k}`);
  const counts = { created: 0, unchanged: 0 };
  const seen = new Set();
  await db.exec('BEGIN');
  try {
    for (const [i, raw] of rows.entries()) {
      const r = Object.fromEntries(Object.entries(mapping).map(([k, h]) => [k, pick(raw, h).trim()]));
      const line = `CSV row ${i + 2}`;
      const key = r.external_ref || `${r.contract}/${r.asset}`;
      if (seen.has(key)) throw Error(`${line}: duplicate record ${key}`);
      seen.add(key);
      if (kind !== 'contract-lines' && !r.external_ref) throw Error(`${line}: the Salesforce Id column is empty`);
      const existing = r.external_ref ? (await db.query(`select * from ${{ accounts: 'customers', assets: 'equipment', contracts: 'contracts', 'work-orders': 'jobs' }[kind]} where external_ref = $1`, [r.external_ref]))[0] : null;
      if (kind === 'accounts') {
        if (!r.name) throw Error(`${line}: account name is required`);
        if (existing) { if (existing.name !== r.name) throw Error(`${line}: account ${r.external_ref} already imported under another name; reconcile it first`); counts.unchanged++; continue; }
        const data = { code: r.code || `SF-${tail(r.external_ref)}`, name: r.name, phone: r.phone || null, region: r.region || '', external_ref: r.external_ref };
        validate('customers', data); await save(db, 'customers', data); counts.created++;
      } else if (kind === 'assets') {
        if (!r.serial) throw Error(`${line}: serial number is required`);
        const c = await byRef(db, 'customers', r.account, line);
        if (existing) { if (existing.serial !== r.serial) throw Error(`${line}: asset ${r.external_ref} already imported with a different serial; reconcile it first`); counts.unchanged++; continue; }
        const ekind = (r.kind || 'other').toLowerCase().replaceAll(' ', '_');
        const status = assetStatus[(r.status || '').toLowerCase()];
        if (!status) throw Error(`${line}: unknown asset status "${r.status}"`);
        const data = { code: `A-${tail(r.external_ref)}`, serial: r.serial, model: r.name || '', kind: ekind, customer_id: c.code, status, external_ref: r.external_ref };
        if (r.installed_on) data.installed_on = dateOnly(r.installed_on);
        if (r.warranty_ends_on) data.warranty_ends_on = dateOnly(r.warranty_ends_on);
        validate('equipment', data); await save(db, 'equipment', data); counts.created++;
      } else if (kind === 'contracts') {
        const c = await byRef(db, 'customers', r.account, line);
        if (!r.starts_on || !r.ends_on) throw Error(`${line}: start and end dates are required`);
        if (existing) { if (dateOnly(r.ends_on) !== existing.ends_on.toISOString?.().slice(0, 10) && dateOnly(r.ends_on) !== String(existing.ends_on)) throw Error(`${line}: contract ${r.external_ref} already imported with a different end date; reconcile it first`); counts.unchanged++; continue; }
        const data = { code: r.code || `SC-${tail(r.external_ref)}`, customer_id: c.code, name: r.name || 'Service contract', kind: (r.kind || 'full_service').toLowerCase().replaceAll(' ', '_'), starts_on: dateOnly(r.starts_on), ends_on: dateOnly(r.ends_on), status: dateOnly(r.ends_on) < today() ? 'ended' : 'active', external_ref: r.external_ref };
        validate('contracts', data); await save(db, 'contracts', data); counts.created++;
      } else if (kind === 'contract-lines') {
        if (!r.contract || !r.asset) throw Error(`${line}: contract and asset Ids are required`);
        const k = await byRef(db, 'contracts', r.contract, line);
        const e = await byRef(db, 'equipment', r.asset, line);
        const res = await db.query('insert into contract_equipment (contract_id, equipment_id) values ($1, $2) on conflict do nothing returning id', [k.id, e.id]);
        if (res.length) counts.created++; else counts.unchanged++;
      } else {
        const c = await byRef(db, 'customers', r.account, line);
        const status = statusMap[(r.status || 'new').toLowerCase()];
        if (!status) throw Error(`${line}: unknown work order status "${r.status}"`);
        const priority = priorityMap[(r.priority || '').toLowerCase()];
        if (!priority) throw Error(`${line}: unknown priority "${r.priority}"`);
        if (existing) { counts.unchanged++; continue; }
        const data = { code: r.code ? `WO-${r.code}` : `WO-${tail(r.external_ref)}`, customer_id: c.code, kind: (r.kind || 'other').toLowerCase(), priority, reported_at: stamp(r.created), description: [r.subject, r.description].filter(Boolean).join(': ') || 'Imported work order', status, external_ref: r.external_ref };
        if (r.asset) data.equipment_id = (await byRef(db, 'equipment', r.asset, line)).code;
        if (r.contract) data.contract_id = (await byRef(db, 'contracts', r.contract, line)).code;
        if (status === 'done') { data.completed_at = stamp(r.ended || r.created); data.resolution = r.description || r.subject || 'Imported from Salesforce as completed'; data.chargeable = false; }
        validate('jobs', data); await save(db, 'jobs', data); counts.created++;
      }
    }
    await db.exec(dryRun ? 'ROLLBACK' : 'COMMIT');
    return [{ mode: dryRun ? 'dry run, nothing saved' : 'imported', kind, rows: rows.length, ...counts }];
  } catch (e) { await db.exec('ROLLBACK'); throw e; }
}

// ---------------------------------------------------------------- dispatcher

const allowed = {
  add: ['data'], update: ['data'], log: ['author', 'text', 'date'],
  raise: ['text', 'kind', 'priority', 'at', 'plan', 'tech', 'on', 'charge', 'code'], assign: ['tech', 'on'], arrive: ['at'],
  complete: ['note', 'minutes', 'hours', 'at', 'not-first-visit', 'checklist', 'no-charge'], part: ['part', 'qty', 'cost', 'price', 'text'],
  meter: ['hours', 'date', 'source'], invoice: ['date'], claim: ['amount', 'code'], lodge: ['ref', 'date'], decide: ['status', 'paid', 'reason', 'date'],
  import: ['kind', 'file', 'map', 'dry-run'], export: ['out'],
};
const arity = { add: 1, update: 2, log: 2, raise: 1, assign: 1, arrive: 1, complete: 1, part: 1, meter: 1, invoice: 1, claim: 1, lodge: 1, decide: 1, customer: 1, unit: 1, contract: 1, technician: 1, job: 1, 'draft-renewal': 1, 'draft-claim': 1, import: 1 };

export const commandList = [...Object.keys(reads), ...READ_ONLY_EXTRA, 'add', 'update', 'log', 'raise', 'assign', 'arrive', 'complete', 'part', 'meter', 'invoice', 'claim', 'lodge', 'decide', 'weekly-review', 'draft-weekly', 'draft-renewal', 'draft-claim', 'import', 'export'];

export async function run(db, args) {
  const { opts: o, pos } = options(args);
  const [cmd = 'help', ...rest] = pos;
  for (const key of Object.keys(o)) if (key !== 'json' && !(allowed[cmd] || []).includes(key)) throw Error(`Unknown option --${key} for ${cmd}`);
  if (rest.length !== (arity[cmd] || 0)) throw Error(`Wrong number of arguments for ${cmd}; see docs/cli.md`);

  if (reads[cmd]) return db.query(reads[cmd]);
  switch (cmd) {
    case 'help':
      return [{ usage: 'npm run service -- <command> [arguments] [--json]', commands: commandList.join(', ') }];
    case 'customer': {
      const c = await resolve(db, 'customers', rest[0]);
      return {
        customer: [c],
        sites: await db.query('select code,name,address,access_notes from sites where customer_id = $1 order by code', [c.id]),
        units: await db.query('select code,serial,model,kind,warranty,contract,hour_meter,breakdowns_12_months from equipment_status where customer_code = $1 order by code', [c.code]),
        contracts: await db.query('select code,name,kind,ends_on,days_left,response_hours,annual_value_cents,status from contract_status where customer_code = $1 order by ends_on', [c.code]),
        open_jobs: await db.query(`select code,kind,priority,status,reported_at,description from jobs where customer_id = $1 and status in ${OPEN} order by reported_at`, [c.id]),
        notes: await db.query("select happened_on,author,body from notes where about = 'customers' and about_id = $1 order by happened_on", [c.id]),
      };
    }
    case 'unit': {
      const e = await resolve(db, 'equipment', rest[0]);
      return {
        unit: await db.query('select * from equipment_status where id = $1', [e.id]),
        plans: await db.query('select code,task,next_due_on,days_left,hours_left,open_job from pm_due where equipment_id = $1', [e.id]),
        jobs: await db.query("select j.code,j.kind,j.status,j.reported_at,(j.completed_at at time zone 'UTC')::date done_on,j.hour_meter,j.resolution from jobs j where j.equipment_id = $1 order by j.reported_at desc", [e.id]),
        claims: await db.query('select code,status,claim_cents,submitted_on,paid_cents,reason from claim_status where unit = $1', [e.code]),
        readings: await db.query('select read_on,hours,source from meter_readings where equipment_id = $1 order by read_on desc limit 10', [e.id]),
        notes: await db.query("select happened_on,author,body from notes where about = 'equipment' and about_id = $1 order by happened_on", [e.id]),
      };
    }
    case 'contract': {
      const k = await resolve(db, 'contracts', rest[0]);
      return {
        contract: await db.query('select * from contract_status where id = $1', [k.id]),
        units: await db.query('select e.code,e.serial,e.model,e.kind,e.hour_meter from contract_equipment ce join equipment e on e.id = ce.equipment_id where ce.contract_id = $1 order by e.code', [k.id]),
        margin: await db.query("select annual_value_cents,labour_cost_cents,parts_cost_cents,margin_cents,margin_pct from (" + reads['contract-margin'] + ") m where code = $1", [k.code]),
        response: await db.query("select code,reported_at,response,response_minutes from job_response where contract = $1 and response <> 'no promise' order by reported_at desc", [k.code]),
        notes: await db.query("select happened_on,author,body from notes where about = 'contracts' and about_id = $1 order by happened_on", [k.id]),
      };
    }
    case 'technician': {
      const t = await resolve(db, 'technicians', rest[0]);
      return {
        technician: [t],
        tickets: await db.query('select code,kind,name,covers_kind,expires_on,days_left,evidence from ticket_status where technician_code = $1 order by expires_on nulls first', [t.code]),
        open_jobs: await db.query(`select j.code,j.kind,j.priority,j.status,j.scheduled_on,e.code unit from jobs j left join equipment e on e.id = j.equipment_id where j.technician_id = $1 and j.status in ${OPEN} order by j.scheduled_on nulls first`, [t.id]),
        notes: await db.query("select happened_on,author,body from notes where about = 'technicians' and about_id = $1 order by happened_on", [t.id]),
      };
    }
    case 'job': {
      const j = await resolve(db, 'jobs', rest[0]);
      return {
        job: [j],
        response: await db.query('select contract,response_hours,due_at,response,response_minutes from job_response where id = $1', [j.id]),
        parts: await db.query('select code,part_number,description,qty,unit_cost_cents,unit_price_cents from parts_used where job_id = $1 order by code', [j.id]),
        claim: await db.query('select code,status,claim_cents,submitted_on,maker_reference,paid_cents,reason from warranty_claims where job_id = $1', [j.id]),
      };
    }
    case 'compliance':
      return compliance(db);
    case 'attention':
      return {
        dispatch: (await db.query(reads.dispatch)).filter((r) => r.response !== 'no promise' || ['urgent', 'high'].includes(r.priority) || r.technician === 'unassigned'),
        compliance: await compliance(db),
        pm_not_booked: await db.query(reads['unscheduled-pm']),
        stuck_jobs: await db.query(reads['stuck-jobs']),
        renewals: await db.query(reads['renewals-due']),
      };
    case 'add':
    case 'update': {
      if (!o.data) throw Error('Use --data=<JSON file>');
      return save(db, rest[0], JSON.parse(fs.readFileSync(o.data, 'utf8')), cmd === 'update' ? rest[1] : null);
    }
    case 'log': return logNote(db, rest[0], rest[1], o);
    case 'raise': return raiseJob(db, rest[0], o);
    case 'assign': return assignJob(db, rest[0], o);
    case 'arrive': return arrive(db, rest[0], o);
    case 'complete': return completeJob(db, rest[0], o);
    case 'part': return addPart(db, rest[0], o);
    case 'meter': return meter(db, rest[0], o);
    case 'invoice': return invoice(db, rest[0], o);
    case 'claim': return raiseClaim(db, rest[0], o);
    case 'lodge': return lodgeClaim(db, rest[0], o);
    case 'decide': return decideClaim(db, rest[0], o);
    case 'weekly-review':
    case 'draft-weekly': {
      const issues = await compliance(db);
      const body = [
        `## Findings (${issues.length})`, mdTable(issues),
        '## Breakdowns on the clock', mdTable((await db.query(reads.dispatch)).filter((r) => r.response !== 'no promise')),
        '## Planned maintenance due and not booked', mdTable(await db.query(reads['unscheduled-pm'])),
        '## Response times, last 90 days', mdTable(await db.query(reads['response-times'])),
        '## Contracts to renew', mdTable(await db.query(reads['renewals-due'])),
        '## Contracts losing money', mdTable((await db.query(reads['contract-margin'])).filter((m) => m.margin_cents < 0)),
        '## Warranty money to claim', mdTable(await db.query(reads['warranty-unclaimed'])),
        '## Done and not invoiced', mdTable(await db.query(reads.unbilled)),
      ].join('\n');
      return writeDraft(cmd, `Monday service review, week of ${today()}`, body);
    }
    case 'draft-renewal': {
      const k = await resolve(db, 'contracts', rest[0]);
      const s = (await db.query('select * from contract_status where id = $1', [k.id]))[0];
      const c = (await db.query('select * from customers where id = $1', [k.customer_id]))[0];
      const units = await db.query('select e.code,e.serial,e.model from contract_equipment ce join equipment e on e.id = ce.equipment_id where ce.contract_id = $1 order by e.code', [k.id]);
      const resp = (await db.query("select count(*)::int n, count(*) filter (where response = 'met')::int met from job_response where contract = $1 and response <> 'no promise'", [k.code]))[0];
      const visits = (await db.query("select count(*)::int n from jobs where contract_id = $1 and status in ('done','invoiced') and completed_at >= now() - interval '365 days'", [k.id]))[0].n;
      const body = `To: ${c.contact_email || '[contact email]'}\nSubject: Renewing ${k.name}\n\nHi ${(c.contact_name || c.name).split(' ')[0]},\n\nYour service agreement ${k.code} for ${units.length} unit(s) ends on ${String(s.ends_on.toISOString?.() ?? s.ends_on).slice(0, 10)}.\n\nIn the last 12 months we made ${visits} visit(s) under it${resp.n ? `, and reached ${resp.met} of ${resp.n} breakdowns inside the ${k.response_hours} hour response time` : ''}.\n\nUnits covered:\n\n${units.map((u) => `- ${u.code}: ${u.model} (serial ${u.serial})`).join('\n')}\n\nThe renewal terms are attached. [Check the price and terms before this goes.]\n\nThanks,\n[Your name]\n`;
      return writeDraft('renewal', `Renewal letter for ${k.code}`, body);
    }
    case 'draft-claim': {
      const w = await resolve(db, 'warranty_claims', rest[0]);
      const s = (await db.query('select * from claim_status where id = $1', [w.id]))[0];
      const j = (await db.query('select * from jobs where id = $1', [w.job_id]))[0];
      const e = (await db.query('select * from equipment where id = $1', [j.equipment_id]))[0];
      const m = (await db.query('select * from makers where id = $1', [e.maker_id]))[0];
      const parts = await db.query('select part_number,description,qty,unit_cost_cents from parts_used where job_id = $1 order by code', [j.id]);
      const body = `To: ${m.claims_email || '[maker claims address]'}\nSubject: Warranty claim ${w.code}: ${e.model}, serial ${e.serial}\n\nUnit: ${e.model}, serial ${e.serial}\nInstalled: ${String(e.installed_on?.toISOString?.() ?? e.installed_on ?? '').slice(0, 10)}\nFault reported: ${new Date(j.reported_at).toISOString().slice(0, 10)}: ${j.description}\nRepaired: ${String(s.repaired_on?.toISOString?.() ?? s.repaired_on).slice(0, 10)}${j.hour_meter !== null ? ` at ${j.hour_meter} hours` : ''}\nWork done: ${j.resolution}\nLabour: ${(j.labour_minutes / 60).toFixed(2)} hours\n\nParts:\n\n${mdTable(parts)}\nAmount claimed: ${dollars(w.claim_cents)}\n\nThanks,\n[Your name]\n`;
      return writeDraft('warranty-claim', `Warranty claim ${w.code} to ${m.name}`, body);
    }
    case 'import':
      if (rest[0] !== 'salesforce') throw Error('Supported importer: salesforce (accounts, assets, contracts, contract-lines, work-orders)');
      return importFile(db, o.kind, o.file, { map: o.map, dryRun: Boolean(o['dry-run']) });
    case 'export': {
      if (!o.out) throw Error('Use --out=<new JSON file>');
      const data = { format: 'equipment-service-v1', exported_at: new Date().toISOString() };
      await db.exec('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try {
        for (const t of [...Object.keys(fields), 'contract_equipment', 'meter_readings', 'notes']) {
          data[t] = await db.query(`select * from ${t} order by ${fields[t] ? 'code' : 'created_at, id'}`);
        }
        await db.exec('COMMIT');
      } catch (e) { await db.exec('ROLLBACK'); throw e; }
      const file = path.resolve(o.out);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
      return [{ file, record_types: Object.keys(data).length - 2 }];
    }
    default:
      throw Error(`Unknown command "${cmd}". Run: npm run service -- help`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let db;
  const args = process.argv.slice(2);
  try {
    db = await getDb();
    console.log(print(await run(db, args), Boolean(options(args).opts.json)));
  } catch (e) {
    if (args.includes('--json')) console.error(JSON.stringify({ error: e.message, ...(e.candidates ? { candidates: e.candidates } : {}) }));
    else console.error(e.message + (e.candidates?.length ? '\nCandidates:\n' + e.candidates.map((c) => `  ${c.code}  ${c.name}`).join('\n') : ''));
    process.exitCode = 1;
  } finally {
    if (db) await db.close();
  }
}
