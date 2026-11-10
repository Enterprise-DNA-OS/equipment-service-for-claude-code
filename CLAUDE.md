# Equipment Service for Claude Code: operating instructions

This file is the brain. Claude Code reads it at the start of every session. It says who this is for, how work gets done, and the one right way to do each recurring job.

## Who this is for

- **Business:** [YOUR BUSINESS]
- **Operator:** [YOUR NAME], [your role]
- **What matters most:** [the one or two outcomes you care about]

Fill this in once. A worker with context knows. A worker without it guesses.

## How to work

1. **Take a brief, not a script.** The operator describes the outcome. You run the right command and present the answer.
2. **Read before you write.** Before drafting anything about a record, read its full history first.
3. **Plain language.** Short sentences. No filler. Numbers in tables.
4. **Silent success, loud problems.** No play-by-play. Say what broke and what you did about it.
5. **Stop at the line.** Anything that sends, deletes, or faces a customer waits for a yes in this session.

## Routing table: one right way for each recurring job

| When the operator asks for... | Use this |
|---|---|
| What needs doing today | `/attention` |
| The Monday review | `/weekly-review`, `/draft-weekly` |
| What goes out next? Who is late? | `/dispatch`, `/technician-load` |
| A customer rang with a breakdown | `/raise` |
| Book a technician | `/assign` |
| The technician is on site | `/arrive` |
| A job is finished | `/part`, then `/complete` |
| An hour meter reading | `/meter` |
| What maintenance is due? | `/pm-due`, `/unscheduled-pm` |
| Did we meet our response times? | `/response-times`, `/missed-response` |
| Contracts to renew | `/renewals-due`, `/draft-renewal` |
| Is this contract making money? | `/contract-margin`, `/contract` |
| Machines with no contract or no plan | `/uncovered` |
| Warranty money to claim | `/warranty-unclaimed`, `/claim`, `/draft-claim` |
| A claim went to the maker, or came back | `/lodge`, `/decide` |
| Claims open, makers that reject | `/warranty-claims`, `/warranty-recovery` |
| Machines that keep breaking down | `/repeat-breakdowns` |
| Fixed on the first visit? | `/first-time-fix` |
| Jobs going nowhere | `/stuck-jobs` |
| Done work to invoice | `/unbilled`, `/invoice` |
| Statutory inspections coming up | `/inspections-due` |
| Licences and tickets expiring | `/tickets-due` |
| Are we compliant? | `/compliance` |
| Everything about one customer, unit, contract, technician or job | `/customer`, `/unit`, `/contract`, `/technician`, `/job` |
| Lists | `/customers`, `/units`, `/contracts`, `/technicians`, `/plans`, `/open-jobs`, `/service-history` |
| Record something new or changed | `/add`, `/update`, `/log` |
| Bring records across from Salesforce | `/import` |
| Paperwork for a customer or an auditor | `/documents` |
| A page to look at or print | `/views`, `/new-view` |
| Change a field or a rule | `/customise` |
| A full copy of the data | `/export` |

If an ask fits nothing here, run the CLI directly (`npm run service -- help`) and then propose a new command for it.

## Hard rules

- Never send email or messages from here. Draft to `drafts/`, a person sends.
- Never delete records without an explicit yes in this session. Prefer marking closed or archived.
- Never invent a record. If a name is ambiguous, list the candidates and ask.
- The database is the source of truth. If the answer is not in it, say so.
- A clear check is never a safety sign-off on a machine. Say what was checked and what was not (docs/compliance.md).
- Never book a technician, close a job, mark a job invoiced or lodge a claim without the operator saying so in this session.
- Never change a contract's price, term or response time without the operator saying so; renewal drafts leave the price for them.
- Times display in UTC. Convert to the customer's local time before quoting an arrival or a deadline.
- Before changing a rule, read docs/compliance.md and confirm the change with the operator; the doc and the check change together.

## Where things live

- `scripts/` the CLI. `scripts/lib/db.mjs` picks `DATABASE_URL` (Postgres, Supabase) or the embedded database in `.data/`.
- `supabase/migrations/` the schema, plain SQL. `npm run migrate` applies it.
- `.claude/commands/` the slash commands. Add one every time the same ask comes twice.
- `docs/` the thesis and the guide for moving off Salesforce Field Service.

Built by Enterprise DNA. Installed and run for you as part of Omni: https://enterprisedna.co/omni/instead-of/salesforce-field-service
