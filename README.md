<h1 align="center">Equipment Service for Claude Code</h1>

<p align="center">
  <strong>The open-source equipment service system that is just a database and Claude Code.</strong>
</p>

<p align="center">
  Created by <a href="https://www.enterprisedna.co"><strong>Enterprise DNA</strong></a>. Free and open source. Works with Claude Code, Codex, OpenCode or Cursor.
</p>

<!-- three-doors -->
<table align="center">
  <tr>
    <td align="center"><strong>Do it yourself</strong><br/>Clone it, run it, own it. Free, MIT.<br/><a href="#quick-start">Quick start</a></td>
    <td align="center"><strong>We customise it</strong><br/>Your fields, your rules, your Salesforce Field Service data brought across.<br/><a href="https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=salesforce-field-service">Book a call</a></td>
    <td align="center"><strong>We run it for you</strong><br/>Installed, connected and operated inside Omni. Setup fee, then a retainer.<br/><a href="https://enterprisedna.co/omni/instead-of/salesforce-field-service?utm_source=github&utm_medium=readme&utm_campaign=salesforce-field-service">How it works</a></td>
  </tr>
</table>

<p align="center">
  <a href="#what-is-this">What is this</a> &bull;
  <a href="#why-no-front-end">Why no front end</a> &bull;
  <a href="#quick-start">Quick start</a> &bull;
  <a href="#ten-questions-to-ask">Ten questions</a> &bull;
  <a href="#the-commands">Commands</a> &bull;
  <a href="#the-rules-it-checks">Rules</a> &bull;
  <a href="#instead-of-salesforce-field-service">Instead of Salesforce Field Service</a> &bull;
  <a href="#want-it-installed-and-run-for-you">Installed for you</a> &bull;
  <a href="#license">License</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node-20+-339933?style=flat-square" alt="Node 20+" />
  <img src="https://img.shields.io/badge/PostgreSQL-any-336791?style=flat-square" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/PGlite-embedded-3ecf8e?style=flat-square" alt="PGlite" />
  <img src="https://img.shields.io/badge/License-MIT-yellow?style=flat-square" alt="MIT License" />
</p>

---

## What is this

Equipment Service for Claude Code keeps the records an equipment dealer or distributor runs its service department on: the machines it has sold and installed at each customer's site, the service contracts that cover them, planned maintenance by date and by run hours, breakdowns against the response time each contract promises, technicians and their tickets, parts fitted, and warranty claims back to the maker. It is a Postgres database and a set of agent commands. There is no web front end. You open the folder in [Claude Code](https://claude.com/claude-code) (or Codex, OpenCode, Cursor: see `AGENTS.md`) and ask in plain English.

Salesforce lists Field Service Dispatcher and Technician licences at AU$245 (US$175) per user per month, billed annually, on an annual contract, and it needs at least one Service Cloud licence beside them ([salesforce.com/service/field-service-management/pricing](https://www.salesforce.com/service/field-service-management/pricing/), checked 10 November 2026). A dealer with 20 technicians and 3 dispatchers pays AU$5,635 a month, AU$67,620 a year, before Service Cloud. This holds the same service records in a database you own, with no charge per person.

It is for dealers and distributors of forklifts, compressors, generators, refrigeration, pumps, access equipment, commercial kitchen and dairy equipment who service what they sell: the service manager who answers for the contracts, the dispatcher who books the work, and the owner who wants to know which contracts make money. It is not trades job management: the work here is the dealer's own installed base.

Want it with a technician phone app, a web front end, or on a different stack? That is a customisation, and it is what Enterprise DNA does: [book a call](https://enterprisedna.co/omni/book/?utm_source=github&utm_medium=readme&utm_campaign=salesforce-field-service).

## Why no front end

The dispatch console and the dashboards are what the per-seat licence pays for. The questions a service manager is paid to answer (which contracts lose money, which warranty repairs nobody claimed, which customer keeps getting the late visit) are rarely on them. Here you ask, and the answer comes from your own records. What a screen gives that this does not (a technician app, offline working, a drag-and-drop board, photos and signatures) is listed honestly in [docs/why-no-front-end.md](docs/why-no-front-end.md).

## Quick start

Sixty seconds, no database install (an embedded Postgres runs inside Node):

```bash
git clone https://github.com/Enterprise-DNA-OS/equipment-service-for-claude-code.git
cd equipment-service-for-claude-code
npm install
npm run demo        # fictional dealer: 5 customers, 12 units, 5 contracts, 4 technicians
npm test            # disposable database, every command, PASS or FAIL
npm run service -- attention
npm run view        # read-only pages in views/
npm run docs        # service reports, contract schedules, unit histories in docs-out/
```

Then open the folder in Claude Code and type `/attention`.

### Use it with your own Postgres or Supabase

Copy `.env.example` to `.env`, set `DATABASE_URL`, then `npm run migrate`. Same commands, shared data, no per-seat fee. One dealer per database. Row-level security is on with no public policies: connect with a trusted role. Never run `npm run demo` against your working database.

## Ten questions to ask

Each is answered today by one command on your own records.

1. Which service contracts cost us more in labour and parts this year than the customer pays? (`contract-margin`)
2. Which repairs on machines still under the maker's warranty have no claim lodged, and how many days are left to lodge each? (`warranty-unclaimed`)
3. Which breakdowns did we reach after the response time the contract promises, and which customers keep getting the late visits? (`response-times`, `missed-response`)
4. Which machines are past their planned service by date or by run hours, and which of those has nobody booked? (`pm-due`, `unscheduled-pm`)
5. Which customers have a contract with us but own machines that are not on it? (`uncovered`)
6. Which machines have broken down three or more times in a year, and which of those are still in warranty? (`repeat-breakdowns`)
7. Which technicians are booked on work their licence or ticket no longer covers? (`compliance`, `tickets-due`)
8. What share of each maker's warranty claims gets rejected, and why? (`warranty-recovery`)
9. Which contracts end inside their renewal notice window, and which ended but are still being serviced? (`renewals-due`)
10. Which chargeable jobs are done and still not invoiced? (`unbilled`)

## The commands

55 recipes live in `.claude/commands`. The weekly rituals:

| Command | What it does |
|---|---|
| `/attention` | Everything that needs a decision today: breakdowns past their response time, compliance findings, maintenance not booked, stuck jobs, renewals |
| `/weekly-review` | The Monday service review, written to `drafts/` |
| `/dispatch` | Open jobs in the order they should go out, with the minutes left on each response promise |
| `/raise`, `/assign`, `/arrive`, `/complete`, `/part` | A job from the phone call to the work done: the contract is attached and the response clock starts when it is raised |
| `/pm-due`, `/unscheduled-pm` | Planned maintenance by date and run hours, whichever comes first, and what is not booked |
| `/meter` | Record an hour meter reading; never goes backwards |
| `/response-times`, `/missed-response` | Breakdowns met and missed against each contract's promise |
| `/renewals-due`, `/draft-renewal` | Contracts to renew, with the year's record, drafted; never sent |
| `/contract-margin` | What each contract earns against what it cost to service |
| `/uncovered` | Units with no contract or no maintenance plan |
| `/warranty-unclaimed`, `/claim`, `/draft-claim`, `/lodge`, `/decide` | Warranty money from repair to the maker's payment |
| `/warranty-claims`, `/warranty-recovery` | Claims open with each maker, and what each maker pays and rejects |
| `/repeat-breakdowns`, `/first-time-fix` | Machines that keep failing, and fixes on the first visit by technician |
| `/inspections-due`, `/tickets-due` | Statutory inspections and technician tickets coming up or expired |
| `/stuck-jobs`, `/unbilled`, `/invoice` | Jobs waiting on parts or a technician, and done work not yet invoiced |
| `/compliance` | Every rule in `docs/compliance.md` checked against the records, with the source cited |
| `/customer`, `/unit`, `/contract`, `/technician`, `/job` | One record, its history and notes |
| `/add`, `/update`, `/log` | Record what the operator tells you |
| `/import` | Accounts, assets, service contracts, contract lines and work orders from a Salesforce Data Export |
| `/export` | Every record to one JSON file |
| `/documents`, `/views`, `/new-view` | Paperwork and read-only pages in your brand |
| `/customise` | Add a field, change a rule, rename a stage |

Every recipe drives one CLI: `npm run service -- help`. Fields and flags are in [docs/cli.md](docs/cli.md).

## The rules it checks

Each check cites its source in [docs/compliance.md](docs/compliance.md): maintenance, inspection and testing of plant as the manufacturer recommends and by a competent person (WHS Regulations 2011 r 213), the major inspection of registrable cranes (r 235), high risk work licences (Part 4.5), the duty of whoever installs and commissions plant (WHS Act 2011 s 26; Health and Safety at Work Act 2015 (NZ) s 43), plus the terms of your own contracts and each maker's warranty claim window. Victoria runs its own OHS laws: change the source text with `/customise`.

The database refuses the mistakes that cost money: a job on a contract that does not cover the unit, a warranty claim for a unit that was out of warranty, a planned service closed with no hour meter reading, a meter reading that goes backwards.

This is a record check, not a safety sign-off on any machine and not legal advice.

## Documents and views

`npm run docs` renders, in your brand (`brand.json`):

- a service report for each job done in the last 30 days (the fault, the work, the parts, the hours)
- a service agreement schedule for each contract (the units covered, the response time, the maintenance schedule)
- a service history for each unit, for the customer or the auditor

`npm run view` renders three read-only pages: the Monday service review, service contracts (renewals, margin, response times, units not covered), and warranty money. Static HTML files: open them, print them, attach them.

## Your first hour: ten things to ask for

1. "Put our business name and logo on the service reports."
2. "Import our accounts, assets and service contracts from this Salesforce export."
3. "Northgate just rang: U402 won't lift. Raise it as urgent."
4. "Who can get to Laverton in the next two hours?"
5. "Mia's on site at Northgate. Log her arrival at 9:40."
6. "Close J-1001: replaced the mast hose, 90 minutes, 1,655 hours, and record the hose at $86 cost."
7. "Which warranty repairs have we not claimed, and draft the Kestrel claim."
8. "Is the Rivermill contract making money? What should the renewal be?"
9. "Our response time for the Northgate contract is now 3 hours. Change it."
10. "Write Monday's service review."

## Instead of Salesforce Field Service

Export Account, Asset, ServiceContract, ContractLineItem and WorkOrder from Salesforce Data Export, dry run each import in that order, map any column names that differ, then import for real. Each record keeps its Salesforce Id, so a later export can be brought in again without duplicates. Full steps, what maps and what does not carry over (on-site times, maintenance plans, attachments): [docs/replace-salesforce-field-service.md](docs/replace-salesforce-field-service.md).

## Architecture

```
equipment-service-for-claude-code/
  CLAUDE.md                 how the operator wants this run (routing table + house rules)
  AGENTS.md                 the same, for Codex / OpenCode / Cursor / Gemini CLI
  .claude/commands/         the slash commands
  scripts/service.mjs       the one CLI the commands drive
  scripts/lib/db.mjs        one adapter: DATABASE_URL (pg) or embedded PGlite
  supabase/migrations/      plain SQL schema, guards and views
  supabase/seed.sql         fictional demo dealer
  examples/                 Salesforce Data Export files to practise the import on
  views.json, documents.json  the pages and paperwork
  docs/                     rules, CLI contract, replacement guide
```

## Testing

`npm test` builds a disposable database and checks every command, planned maintenance by date and by hours, response times against each contract, contract margin, warranty claim windows, every database guard, a breakdown from raise to paid claim, imports (dry run, order, repeat, mapped columns, rollback on a bad row), drafts, export, row-level security and the rendered documents. It ignores `DATABASE_URL`; set `TEST_DATABASE_URL` only to a disposable Postgres. Verified on Linux with PGlite and PostgreSQL 17. The Windows and Linux workflow in `.github/workflows` runs on demand.

## Contributing

Issues and pull requests are welcome. Keep the shape: plain SQL, one small CLI, a slash command per recurring job, no front end.

## Want it installed and run for you?

Enterprise DNA installs Equipment Service for Claude Code for your business, brings your Salesforce Field Service records across, connects it to your accounts system and parts stock, builds a technician app if you want one, and runs it for you as part of **Omni**, our managed Command Center. One setup fee, then a monthly retainer.

- Book a call: [enterprisedna.co/omni/book](https://enterprisedna.co/omni/book/?offer=replace-software&utm_source=github&utm_medium=readme&utm_campaign=salesforce-field-service)
- Read more: [enterprisedna.co/omni/instead-of/salesforce-field-service](https://enterprisedna.co/omni/instead-of/salesforce-field-service?utm_source=github&utm_medium=readme&utm_campaign=salesforce-field-service)

## License

MIT. Copyright (c) 2026 Enterprise DNA. Independent project: Salesforce and Field Service are products of Salesforce, Inc., which is not affiliated with this project.
