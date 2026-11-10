# The CLI

```bash
npm run service -- <command> [arguments] [--json]
```

Human tables by default, `--json` for machines. Names resolve by code or name (serial number, for units), case-insensitively, then by id prefix or partial match. More than one match lists the candidates and exits 1 (with `--json`, the candidates come back on stderr). Unknown options and extra arguments are refused. Money is stored in cents and shown in dollars.

## Reads

Lists: `customers`, `units`, `contracts`, `technicians`, `plans`, `open-jobs`.

The service desk: `dispatch`, `pm-due`, `unscheduled-pm`, `stuck-jobs`, `technician-load`, `inspections-due`, `tickets-due`, `unbilled`, `service-history`.

Contracts: `response-times`, `missed-response`, `renewals-due`, `contract-margin`, `uncovered`.

Warranty: `warranty-claims`, `warranty-unclaimed`, `warranty-recovery`.

Equipment and people: `repeat-breakdowns`, `first-time-fix`.

One record: `customer <ref>`, `unit <ref>`, `contract <ref>`, `technician <ref>`, `job <ref>`.

Checks: `compliance`, `attention`.

## Writes

| Command | What it does |
|---|---|
| `add <type> --data=<file.json>` | Insert one record. Types: customers, sites, makers, equipment, contracts, pm_plans, technicians, tickets, jobs, parts_used, warranty_claims |
| `update <type> <ref> --data=<file.json>` | Change fields; `code` never changes |
| `log <customers\|equipment\|contracts\|technicians> <ref> --author= --text= --date=YYYY-MM-DD` | Append a note |
| `raise <unit> --text= [--kind=breakdown\|install\|inspection\|warranty\|other] [--priority=urgent\|high\|normal\|low] [--at=<ISO time>] [--plan=<plan>] [--tech=] [--on=YYYY-MM-DD] [--charge]` | Open a job. The unit's active contract is attached; a breakdown under a contract that covers labour is not chargeable unless `--charge`. `--plan` books planned maintenance |
| `assign <job> --tech= [--on=YYYY-MM-DD]` | Book a technician |
| `arrive <job> [--at=<ISO time>]` | The technician is on site: starts the response time record |
| `complete <job> --note= [--minutes=] [--hours=<meter>] [--at=] [--not-first-visit] [--checklist] [--no-charge]` | Close the job; a meter reading also goes into the hour meter history |
| `part <job> --part= --cost=<dollars> [--qty=1] [--price=<dollars>] [--text=]` | Record a part fitted |
| `meter <unit> --hours= [--date=] [--source=]` | Record an hour meter reading; never goes backwards |
| `invoice <job> [--date=]` | Mark a done, chargeable job invoiced |
| `claim <job> [--amount=<dollars>]` | Raise a draft warranty claim; by default parts at cost plus labour at the maker's rate |
| `lodge <claim> --ref= [--date=]` | The claim went to the maker, with the maker's reference |
| `decide <claim> --status=approved\|rejected\|paid [--paid=<dollars>] [--reason=] [--date=]` | Record the maker's decision |
| `import salesforce --kind=accounts\|assets\|contracts\|contract-lines\|work-orders --file= [--map=] [--dry-run]` | Bring records across |
| `export --out=<new file>` | Every record to JSON; never overwrites |

Drafts (written to `drafts/`, never sent): `weekly-review`, `draft-weekly`, `draft-renewal <contract>`, `draft-claim <claim>`.

## Times

Job times are stored as timestamps with a time zone and shown in UTC. Pass local times with their offset, for example `--at=2026-11-10T08:30:00+11:00`.
