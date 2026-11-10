#!/usr/bin/env node
// npm test: a disposable database, every command exercised, the rules asserted. PASS or FAIL.
// Never touches DATABASE_URL: it uses TEST_DATABASE_URL (a disposable CI Postgres) or a temp PGlite.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getDb, REPO_ROOT } from './lib/db.mjs';
import { migrate } from './migrate.mjs';
import { seed } from './seed.mjs';
import { run, reads, save, resolve, compliance, importFile, commandList } from './service.mjs';
import { parseCsv } from './lib/csv.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'eq-test-'));
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || '';
process.env.DATA_DIR = path.join(temp, 'db');
process.env.OUTPUT_DIR = temp;

let db, checks = 0;
const ok = (v, msg) => { assert.ok(v, msg); checks++; };
const eq = (a, b, msg) => { assert.equal(a, b, msg); checks++; };
const rejects = async (fn, match) => { await assert.rejects(fn, match); checks++; };
const file = (name, value) => { const p = path.join(temp, name); fs.writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value)); return p; };
const cli = (script, args = [], status = 0) => {
  const out = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', script), ...args], { cwd: REPO_ROOT, env: process.env, encoding: 'utf8' });
  assert.equal(out.status, status, out.stderr || out.stdout); checks++;
  return out.stdout + out.stderr;
};
const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
const n = (v) => (v === null ? null : Number(v));

try {
  db = await getDb();
  if (process.env.TEST_DATABASE_URL) await db.exec('drop schema public cascade; create schema public;');
  await migrate(db);
  eq((await migrate(db)).ran.length, 0, 'second migrate applies nothing');
  await seed(db); await seed(db);
  eq((await run(db, ['units'])).length, 12, 'seed is idempotent');
  eq((await db.query('select count(*)::int n from meter_readings'))[0].n, 9, 'meter readings seeded once');

  // Every read runs.
  for (const cmd of Object.keys(reads)) ok(Array.isArray(await run(db, [cmd])), `read ${cmd}`);

  // Planned maintenance, by date and by run hours, whichever comes first.
  const plans = Object.fromEntries((await run(db, ['plans'])).map((p) => [p.code, p]));
  eq(n(plans['P-101'].hours_left), -120, 'U101 is 120 run hours past its 500 hour service');
  eq(n(plans['P-101'].days_left), 110, 'U101 is not due by date yet');
  eq(n(plans['P-103'].days_left), -10, 'U103 quarterly service 10 days late');
  eq(n(plans['P-201'].hours_left), 70, 'hours-only plan counts from its baseline');
  eq(plans['P-201'].next_due_on, null, 'hours-only plan has no due date');
  eq(n(plans['P-301'].hours_left), 2550, 'last visit resets the hours count');
  const pmDue = await run(db, ['pm-due']);
  ok(pmDue.some((p) => p.plan === 'P-302') && !pmDue.some((p) => p.plan === 'P-301'), 'pm-due lists overdue, not far-off');
  const unsched = await run(db, ['unscheduled-pm']);
  ok(unsched.some((p) => p.plan === 'P-302') && !unsched.some((p) => p.plan === 'P-103'), 'unscheduled-pm skips plans already booked');

  // Response times against each contract's promise.
  const resp = Object.fromEntries((await db.query('select code, response from job_response')).map((r) => [r.code, r.response]));
  eq(resp['J-1001'], 'missed, not on site', 'open breakdown past its 4 hours');
  eq(resp['J-1009'], 'missed', 'on site in 7 hours against 4');
  eq(resp['J-1010'], 'met', 'on site in 2 hours');
  eq(resp['J-1002'], 'no promise', 'planned maintenance contract makes no response promise');
  eq(resp['J-1003'], 'no promise', 'planned job is not on a response clock');
  const rt = Object.fromEntries((await run(db, ['response-times'])).map((r) => [r.contract, r]));
  eq(rt['K-RIVER'].missed, 1, 'K-RIVER one miss in 90 days');
  eq(rt['K-RIVER'].met, 1, 'K-RIVER one met');
  eq((await run(db, ['dispatch']))[0].code, 'J-1001', 'dispatch puts the urgent breakdown first');

  // Contracts: renewals, ended contracts and margin.
  const ren = await run(db, ['renewals-due']);
  ok(ren.some((r) => r.code === 'K-GREEN' && r.why === 'in the notice window'), 'K-GREEN inside its 60 day window');
  ok(ren.some((r) => r.code === 'K-ORCH' && r.why.startsWith('ended')), 'K-ORCH ended and still active');
  ok(!ren.some((r) => r.code === 'K-HARB'), 'K-HARB not due');
  const margin = Object.fromEntries((await run(db, ['contract-margin'])).map((m) => [m.code, m]));
  eq(n(margin['K-RIVER'].labour_cost_cents), 91000, 'K-RIVER labour: 13 hours at $70');
  eq(n(margin['K-RIVER'].parts_cost_cents), 441000, 'K-RIVER parts at cost, rejected claim counted');
  eq(n(margin['K-RIVER'].margin_cents), -52000, 'K-RIVER loses $520');
  eq(n(margin['K-NORTH'].parts_cost_cents), 0, 'parts not covered are not a contract cost');
  const unc = await run(db, ['uncovered']);
  eq(unc.find((u) => u.unit === 'U202').gap, 'customer has a contract, this unit is not on it', 'U202 is the easy sale');
  ok(unc.some((u) => u.unit === 'U303' && u.gap === 'no maintenance plan'), 'U303 has no plan');

  // Warranty money.
  const unclaimed = Object.fromEntries((await run(db, ['warranty-unclaimed'])).map((u) => [u.job, u]));
  eq(unclaimed['J-1005'].days_to_lodge, 5, 'Kestrel 30 day window: 5 days left');
  eq(unclaimed['J-1009'].days_to_lodge, 26, 'Brolga 45 day window: 26 days left');
  ok(unclaimed['J-1017'].days_to_lodge < 0, 'a closed window is still shown');
  ok(!unclaimed['J-1004'] && !unclaimed['J-1015'], 'claimed and out-of-warranty jobs are not listed');
  const rec = Object.fromEntries((await run(db, ['warranty-recovery'])).map((r) => [r.maker, r]));
  eq(n(rec['Brolga Compressors'].rejected_pct), 100, 'Brolga rejected its one decided claim');
  eq((await run(db, ['repeat-breakdowns']))[0].unit, 'U201', 'U201 breaks down most');
  ok((await run(db, ['repeat-breakdowns'])).some((r) => r.unit === 'U102' && r.warranty === 'in warranty'), 'U102 is a repeat failure still in warranty');

  // The rest of the service desk.
  eq((await run(db, ['first-time-fix']))[0].technician, 'Mia Lawson', 'first-time fix: lowest first');
  ok((await run(db, ['stuck-jobs'])).some((s) => s.code === 'J-1019' && s.days_open === 9), 'job waiting on parts 9 days');
  eq((await run(db, ['unbilled'])).map((u) => u.code).join(), 'J-1015', 'only the chargeable done job is unbilled');
  ok((await run(db, ['inspections-due'])).some((i) => i.unit === 'U302' && i.days_left === -12), 'receiver inspection 12 days overdue');
  ok((await run(db, ['tickets-due'])).some((t) => t.code === 'TK-PK-ARC' && t.days_left === -9), 'expired refrigerant licence listed');

  // The full compliance check names the rule and the source.
  const issues = await compliance(db);
  for (const rule of ['PM-OVERDUE', 'INSPECTION', 'METER-STALE', 'TICKET-FIT', 'TICKET-EXPIRED', 'EVIDENCE', 'COMMISSIONING', 'RESPONSE', 'CONTRACT-ENDED', 'RENEWAL', 'WARRANTY-WINDOW', 'CLAIM-STALE', 'UNBILLED']) {
    ok(issues.some((i) => i.rule === rule), `compliance finds ${rule}`);
  }
  ok(issues.every((i) => i.source), 'every finding cites a source');
  ok(issues.some((i) => i.rule === 'TICKET-FIT' && i.record === 'J-1013'), 'Priya booked on refrigeration with an expired licence');
  ok(!issues.some((i) => i.rule === 'TICKET-FIT' && i.record === 'J-1014'), 'a generator needs no ticket here');
  const rules = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'compliance.md'), 'utf8');
  for (const rule of new Set(issues.map((i) => i.rule))) ok(rules.includes(`**${rule}.**`), `docs/compliance.md documents ${rule}`);

  // Lookups.
  eq((await resolve(db, 'customers', 'rivermill bakery')).code, 'RIVERMILL', 'case-insensitive name');
  eq((await resolve(db, 'equipment', 'kl25-40377')).code, 'U102', 'serial lookup');
  const u102 = await resolve(db, 'equipment', 'U102');
  eq((await resolve(db, 'equipment', u102.id.slice(0, 8))).code, 'U102', 'id prefix');
  await rejects(() => resolve(db, 'equipment', 'U10'), /Ambiguous/);
  await rejects(() => resolve(db, 'customers', 'nobody here'), /No customers/);
  await rejects(() => run(db, ['units', 'extra']), /Wrong number/);
  await rejects(() => run(db, ['units', '--typo']), /Unknown option/);

  // Validation.
  await rejects(() => save(db, 'customers', { code: 'X', name: '' }), /blank/);
  await rejects(() => save(db, 'contracts', { ends_on: '2026-02-30' }, 'K-HARB'), /real/);
  await rejects(() => save(db, 'contracts', { annual_value_cents: 12.5 }, 'K-HARB'), /whole number/);
  await rejects(() => save(db, 'customers', { colour: 'red' }), /Unknown/);
  await rejects(() => save(db, 'jobs', { arrived_at: '2026-01-01T09:00:00' }, 'J-1002'), /time zone/);
  await rejects(() => save(db, 'customers', { code: 'CHANGED' }, 'HARBOUR'), /cannot change/);

  // Rules the database itself enforces.
  await rejects(() => save(db, 'equipment', { site_id: 'GRE-EPP' }, 'U101'), /different customer/);
  await rejects(() => save(db, 'equipment', { warranty_ends_on: '2020-01-01' }, 'U102'), /ends before/);
  const harb = await resolve(db, 'contracts', 'K-HARB'), u201 = await resolve(db, 'equipment', 'U201');
  await rejects(() => db.query('insert into contract_equipment (contract_id, equipment_id) values ($1, $2)', [harb.id, u201.id]), /different customer/);
  await rejects(() => save(db, 'jobs', { code: 'JX1', customer_id: 'HARBOUR', equipment_id: 'U201', kind: 'breakdown', reported_at: ago(1), description: 'x' }), /different customer/);
  await rejects(() => save(db, 'jobs', { code: 'JX2', customer_id: 'GREENLEAF', equipment_id: 'U202', contract_id: 'K-GREEN', kind: 'breakdown', reported_at: ago(1), description: 'x' }), /does not cover/);
  await rejects(() => save(db, 'jobs', { code: 'JX3', customer_id: 'HARBOUR', equipment_id: 'U102', plan_id: 'P-101', kind: 'planned', reported_at: ago(1), description: 'x' }), /different unit/);
  await rejects(() => save(db, 'jobs', { code: 'JX4', customer_id: 'HARBOUR', equipment_id: 'U101', kind: 'planned', reported_at: ago(1), description: 'x' }), /check constraint/);
  await rejects(() => save(db, 'jobs', { status: 'done' }, 'J-1002'), /check constraint/);
  await rejects(() => save(db, 'jobs', { status: 'done', completed_at: new Date().toISOString(), resolution: 'Serviced' }, 'J-1003'), /hour meter/);
  await rejects(() => save(db, 'jobs', { arrived_at: ago(100) }, 'J-1001'), /check constraint/);
  await rejects(() => save(db, 'warranty_claims', { code: 'WX1', job_id: 'J-1006', claim_cents: 100 }), /out of warranty/);
  await rejects(() => save(db, 'warranty_claims', { status: 'submitted' }, 'W-201'), /check constraint/);
  await rejects(() => run(db, ['meter', 'U101', '--hours=4000']), /backwards/);

  // A breakdown, start to finish, through the CLI.
  const raised = (await run(db, ['raise', 'U402', '--text=Horn not working', '--priority=high', '--at=' + ago(3)]))[0];
  const job = await resolve(db, 'jobs', raised.code);
  eq(job.contract_id, (await resolve(db, 'contracts', 'K-NORTH')).id, 'raise attaches the active contract');
  eq(job.chargeable, false, 'covered labour is not chargeable');
  await rejects(() => run(db, ['raise', 'U402', '--kind=planned', '--text=x']), /plan/);
  await rejects(() => run(db, ['raise', 'U402']), /--text/);
  await run(db, ['assign', raised.code, '--tech=Mia Lawson', '--on=' + new Date().toISOString().slice(0, 10)]);
  await run(db, ['arrive', raised.code, '--at=' + ago(1)]);
  eq((await db.query('select response from job_response where code = $1', [raised.code]))[0].response, 'met', 'on site in 2 hours meets 4');
  await rejects(() => run(db, ['arrive', raised.code]), /already/);
  await run(db, ['part', raised.code, '--part=KL-HORN-12', '--cost=42.10', '--text=Horn']);
  await rejects(() => run(db, ['part', raised.code, '--part=X', '--cost=abc']), /amount/);
  await rejects(() => run(db, ['complete', raised.code]), /--note/);
  await run(db, ['complete', raised.code, '--note=Replaced horn and checked wiring', '--minutes=45', '--hours=1660']);
  eq(n((await resolve(db, 'equipment', 'U402')).hour_meter), 1660, 'complete records the meter reading');
  eq(n((await run(db, ['plans'])).find((p) => p.code === 'P-402').hours_left), 40, 'reading moves the plan');
  ok((await run(db, ['warranty-unclaimed'])).some((u) => u.job === raised.code), 'repair in warranty shows as claimable');
  const claim = (await run(db, ['claim', raised.code]))[0];
  eq(n(claim.claim_cents), 4210 + Math.round(45 * 9500 / 60), 'claim: parts at cost plus labour at the maker rate');
  await rejects(() => run(db, ['claim', raised.code]), /already has claim/);
  await rejects(() => run(db, ['lodge', claim.code]), /--ref/);
  await run(db, ['lodge', claim.code, '--ref=KL-WC-90001']);
  await rejects(() => run(db, ['decide', claim.code, '--status=rejected']), /reason/);
  await run(db, ['decide', claim.code, '--status=paid', '--paid=110.00']);
  eq((await resolve(db, 'warranty_claims', claim.code)).status, 'paid', 'claim paid');
  await rejects(() => run(db, ['invoice', raised.code]), /not chargeable/);
  await run(db, ['invoice', 'J-1015']);
  eq((await run(db, ['unbilled'])).length, 0, 'invoiced job leaves the unbilled list');
  await rejects(() => run(db, ['invoice', 'J-1015']), /only a done job/);

  // Planned maintenance booked and closed resets the plan.
  const pm = (await run(db, ['raise', 'U302', '--plan=P-302', '--text=Six-monthly check', '--tech=BOKAFOR', '--on=' + new Date().toISOString().slice(0, 10)]))[0];
  eq(pm.kind, 'planned', 'raise --plan books planned work');
  await run(db, ['complete', pm.code, '--note=Receiver inspected, safety valve tested', '--minutes=60', '--checklist']);
  eq((await run(db, ['plans'])).find((p) => p.code === 'P-302').days_left, 182, 'closed visit resets the date count');
  ok(!(await compliance(db)).some((i) => i.rule === 'PM-OVERDUE' && i.record === 'U302'), 'PM-OVERDUE clears once done');

  // Records, notes and one-record views.
  await run(db, ['add', 'customers', '--data=' + file('c.json', { code: 'NEWCO', name: 'New Co' })]);
  await run(db, ['update', 'customers', 'NEWCO', '--data=' + file('u.json', { phone: '03 9000 9999' })]);
  eq((await resolve(db, 'customers', 'NEWCO')).phone, '03 9000 9999', 'add and update');
  await run(db, ['log', 'customers', 'NEWCO', '--author=Service', '--text=Asked for a quote on two forklifts', '--date=2026-11-01']);
  eq((await run(db, ['customer', 'NEWCO'])).notes.length, 1, 'customer history shows the note');
  await rejects(() => db.query("update notes set body = 'changed'"), /append-only/);
  ok((await run(db, ['unit', 'U102'])).claims.length === 2, 'unit view shows its claims');
  ok((await run(db, ['contract', 'K-RIVER'])).margin[0].margin_cents < 0, 'contract view shows the margin');
  ok((await run(db, ['technician', 'Priya Kaur'])).tickets.length === 2, 'technician view');
  ok((await run(db, ['job', 'J-1009'])).parts.length === 2, 'job view');
  const attention = await run(db, ['attention']);
  ok(attention.dispatch.some((d) => d.code === 'J-1001') && attention.compliance.length && attention.renewals.length, 'attention combines the lists');

  // Drafts, never sends.
  for (const args of [['weekly-review'], ['draft-weekly'], ['draft-renewal', 'K-GREEN'], ['draft-claim', 'W-201']]) {
    const out = (await run(db, args))[0].file;
    const text = fs.readFileSync(out, 'utf8');
    ok(text.startsWith('# DRAFT') && text.includes('Nothing has been sent'), `${args[0]} writes a draft only`);
  }
  ok(fs.readFileSync((await run(db, ['draft-claim', 'W-201']))[0].file, 'utf8').includes('KL25-40377'), 'claim draft names the serial');
  ok(fs.readFileSync((await run(db, ['draft-renewal', 'K-GREEN']))[0].file, 'utf8').includes('Hi Tony,'), 'renewal draft greets the contact');

  // Import from a Salesforce Data Export.
  const ex = (f) => path.join(REPO_ROOT, 'examples', f);
  eq((await importFile(db, 'accounts', ex('salesforce-accounts.csv'), { dryRun: true }))[0].created, 2, 'dry run counts accounts');
  ok(!(await db.query("select id from customers where code = 'ITS-01'")).length, 'dry run saves nothing');
  await rejects(() => importFile(db, 'assets', ex('salesforce-assets.csv')), /import that file first/);
  await run(db, ['import', 'salesforce', '--kind=accounts', '--file=' + ex('salesforce-accounts.csv')]);
  ok((await db.query("select id from customers where code = 'ITS-01'")).length === 1, 'account number becomes the code');
  await run(db, ['import', 'salesforce', '--kind=assets', '--file=' + ex('salesforce-assets.csv')]);
  await run(db, ['import', 'salesforce', '--kind=contracts', '--file=' + ex('salesforce-service-contracts.csv')]);
  await run(db, ['import', 'salesforce', '--kind=contract-lines', '--file=' + ex('salesforce-contract-line-items.csv')]);
  await run(db, ['import', 'salesforce', '--kind=work-orders', '--file=' + ex('salesforce-work-orders.csv')]);
  for (const [kind, f] of [['accounts', 'accounts'], ['assets', 'assets'], ['contracts', 'service-contracts'], ['contract-lines', 'contract-line-items'], ['work-orders', 'work-orders']]) {
    eq((await importFile(db, kind, ex(`salesforce-${f}.csv`)))[0].created, 0, `repeat ${kind} import changes nothing`);
  }
  eq((await resolve(db, 'contracts', '00000102')).status, 'ended', 'a past contract comes in as ended');
  const wo = await resolve(db, 'jobs', 'WO-00001001');
  eq(wo.status, 'done', 'Completed maps to done');
  eq(wo.chargeable, false, 'old completed work is not flagged as unbilled');
  eq((await resolve(db, 'jobs', 'WO-00001002')).status, 'in_progress', 'In Progress maps');
  eq((await resolve(db, 'equipment', 'IMP-KL-0001')).kind, 'forklift', 'asset kind from the added column');
  const raw = fs.readFileSync(ex('salesforce-assets.csv'), 'utf8');
  await rejects(() => importFile(db, 'assets', file('bad-status.csv', raw.replace('"Installed","forklift"', '"Lost","forklift"').replaceAll('ImpU', 'BadU'))), /unknown asset status/);
  await rejects(() => importFile(db, 'assets', file('changed.csv', raw.replace('IMP-KL-0001', 'IMP-KL-9999'))), /different serial/);
  await rejects(() => importFile(db, 'assets', file('dupe.csv', raw + raw.split(/\r?\n/)[1] + '\n')), /duplicate/);
  const renamed = raw.replace('"SerialNumber"', '"Serial_No__c"').replaceAll('ImpU', 'MapU').replaceAll('IMP-', 'MAP-');
  await importFile(db, 'assets', file('mapped.csv', renamed), { map: file('map.json', { serial: 'Serial_No__c' }) });
  ok((await db.query("select id from equipment where serial = 'MAP-KL-0001'")).length === 1, 'column mapping file');
  const rb = renamed.replaceAll('MapU', 'RbkU').replaceAll('MAP-', 'RBK-').replace('"Registered"', '"Lost"');
  await rejects(() => importFile(db, 'assets', file('rollback.csv', rb), { map: file('map2.json', { serial: 'Serial_No__c' }) }), /unknown asset status/);
  ok(!(await db.query("select id from equipment where serial like 'RBK-%'")).length, 'a failed import saves nothing');
  assert.throws(() => parseCsv('A,A\n1,2'), /unique/); checks++;
  eq(parseCsv('﻿A,B\r\n"x,y","say ""hi"""')[0].B, 'say "hi"', 'CSV quoting');

  // Export is a full snapshot and never overwrites.
  const out = path.join(temp, 'export.json');
  await run(db, ['export', '--out=' + out]);
  eq(Object.keys(JSON.parse(fs.readFileSync(out, 'utf8'))).length, 16, 'export holds every record type');
  await rejects(() => run(db, ['export', '--out=' + out]), /EEXIST/);

  // Row-level security: an ordinary role sees nothing.
  await db.exec('create role eq_reader; grant usage on schema public to eq_reader; grant select on customers to eq_reader; set role eq_reader');
  eq((await db.query('select * from customers')).length, 0, 'RLS denies an ordinary reader');
  await db.exec('reset role; drop owned by eq_reader; drop role eq_reader');

  await db.close(); db = null;

  // The CLI, the views and the documents, as a user runs them.
  ok(JSON.parse(cli('service.mjs', ['dispatch', '--json'])).length > 0, 'CLI --json');
  ok(cli('service.mjs', ['unit', 'U10'], 1).includes('Candidates'), 'CLI lists candidates and exits 1');
  ok(cli('service.mjs', ['unit', 'U10', '--json'], 1).includes('candidates'), 'CLI candidates as JSON');
  cli('service.mjs', ['nonsense'], 1);
  cli('view.mjs'); cli('docs.mjs');
  const weekHtml = fs.readFileSync(path.join(temp, 'views', 'week.html'), 'utf8');
  ok(weekHtml.includes('Example Equipment Services') && weekHtml.includes('J-1001'), 'branded weekly view');
  ok(fs.readFileSync(path.join(temp, 'views', 'contracts.html'), 'utf8').includes('K-RIVER'), 'contracts view');
  ok(fs.readdirSync(path.join(temp, 'docs-out', 'contract-schedule')).length >= 5, 'contract schedules rendered');
  ok(fs.readdirSync(path.join(temp, 'docs-out', 'unit-history')).length >= 12, 'unit histories rendered');
  ok(fs.readdirSync(path.join(temp, 'docs-out', 'service-report')).length >= 4, 'service reports rendered');

  const commands = fs.readdirSync(path.join(REPO_ROOT, '.claude', 'commands')).filter((f) => f.endsWith('.md') && f !== 'README.md');
  for (const c of commandList) ok(commands.includes(`${c}.md`), `slash command recipe for ${c}`);
  for (const c of commands) ok(/^---\ndescription: /.test(fs.readFileSync(path.join(REPO_ROOT, '.claude', 'commands', c), 'utf8')), `${c} has a description`);
  const questions = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'docs', 'questions.json'), 'utf8'));
  for (const q of questions) ok(commandList.includes(q.command), `question answered by a real command: ${q.command}`);
  console.log(`PASS: ${checks} checks; ${commands.length} slash commands; ${process.platform}; ${process.env.TEST_DATABASE_URL ? 'PostgreSQL' : 'PGlite'}`);
} catch (e) {
  console.error('FAIL:', e.message, e.stack?.split('\n').find((l) => l.includes('smoke.mjs')) || '');
  process.exitCode = 1;
} finally {
  if (db) await db.close();
  fs.rmSync(temp, { recursive: true, force: true });
}
