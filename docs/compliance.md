# The rules this system checks

`npm run service -- compliance` checks the records against the rules below. Each has an id (the `rule` column in the output), the source, what a breach looks like in the data, and the scope. Rules change, and the duty often sits with your customer as the person who manages or controls the plant: confirm the current text with the regulator in each state or country you work in before relying on a check. Nothing here is legal advice, and a clear result is never a safety sign-off on any machine.

The statutory rules quoted are the model Work Health and Safety (WHS) laws as adopted in most Australian states and territories, and the New Zealand Health and Safety at Work Act 2015. Victoria runs its own Occupational Health and Safety laws: if you work there, tell Claude Code which rules apply and use `/customise` to change the source text.

## Maintenance and inspection of plant

- **PM-OVERDUE.** Source: Work Health and Safety Regulations 2011, r 213 (maintenance and inspection of plant): the person with management or control of plant at a workplace must make sure its maintenance, inspection and testing is done by a competent person, as the manufacturer recommends (or, if there are none, as a competent person recommends, or annually). Federal text: https://www.legislation.gov.au/F2011L02664. Breach in the data: an active maintenance plan whose next visit is past due by date (`days_left < 0`) or by run hours (`hours_left < 0`), whichever comes first. The finding says whether a job is already booked.
- **INSPECTION.** Source: as above, r 213; r 235 for the major inspection of registrable mobile and tower cranes; and the conditions of any plant registration or certificate of inspection (for example a pressure vessel). Breach in the data: a unit with an `inspection_kind` and an `inspection_due` in the past, or no due date at all.
- **METER-STALE.** Source: r 213, as above. A plan counted on run hours cannot be followed without readings. Breach in the data: a unit on an hours-based plan with no hour meter reading, or none in the last 60 days. Operator setting: the 60 days.

## Competent person

- **TICKET-FIT.** Source: r 213 (maintenance by a competent person), and the state or national licensing for the work. Breach in the data: an open job on a unit of a kind that some ticket in the system covers (`tickets.covers_kind`, for example `refrigeration` or `elevating_work_platform`), booked to a technician who holds no current ticket for that kind. You decide which kinds need a ticket by recording `covers_kind` on the tickets that cover them.
- **TICKET-EXPIRED.** Source: for a high risk work licence, WHS Regulations 2011 Part 4.5 (high risk work); otherwise the licensing scheme for that work (for example an Australian refrigerant handling licence, or an electrical licence). Breach in the data: a ticket whose `expires_on` has passed.
- **EVIDENCE.** Source: operator policy. Breach in the data: a ticket with no note of where the copy is kept.

## Installing and commissioning

- **COMMISSIONING.** Source: Work Health and Safety Act 2011 s 26 (duty of a business that installs, constructs or commissions plant) and the Health and Safety at Work Act 2015 (NZ) s 43 (the same duty). NZ text: https://www.legislation.govt.nz/act/public/2015/0070/latest/. Breach in the data: an `install` job closed as done or invoiced with `checklist_done` false: there is no record that the commissioning checks were done and filed.

## Contracts

- **RESPONSE.** Source: the response time in your service agreement (`contracts.response_hours`). Breach in the data: a breakdown on a contract with a response time where the technician arrived after the deadline, or has not arrived and the deadline has passed, in the last 30 days. Clock hours from when the job was reported, not business hours: if your agreements count business hours, ask for that change with `/customise`.
- **CONTRACT-ENDED.** Source: the term of your service agreement. Breach in the data: a contract still marked active after its end date, with the count of open jobs booked against it (work you may be doing for free).
- **RENEWAL.** Source: operator policy (`contracts.renewal_notice_days`, 60 by default). Breach in the data: an active contract ending within its renewal notice window.

## Warranty and billing

- **WARRANTY-WINDOW.** Source: each maker's warranty policy (`makers.claim_window_days`). Breach in the data: a breakdown or warranty job, done on a unit that was under the maker's warranty when it was reported, with no claim raised, or a draft claim with 7 days or fewer left to lodge. Past the window, the finding says how long ago it closed.
- **CLAIM-STALE.** Source: operator policy. Breach in the data: a claim submitted more than 30 days ago with no decision.
- **UNBILLED.** Source: operator policy. Breach in the data: a chargeable job done more than 3 days ago and not marked invoiced.

## What the database itself refuses

These are enforced on every write, not just reported:

- A unit's site must belong to the unit's customer, and a warranty cannot end before the unit was installed.
- A unit can only go on a contract of its own customer, and never once removed.
- A job's unit, site, contract and maintenance plan must all belong to the job's customer, and a contract on a job must cover the job's unit.
- A job closed as done needs a completion time and a note of the work done; an invoiced job needs its invoice date; a planned job needs its plan; a plan counted in run hours needs the hour meter reading before the job closes.
- A warranty claim is refused for a unit that was out of warranty when the job came in.
- An hour meter reading below the last one is refused.
- Notes are append-only.

## Not checked here

Electrical safety testing and tagging intervals, gas fitting and pressure equipment design registration, refrigerant record keeping and leak testing, the high risk work licence class needed for each machine, plant registration itself, and the Australian Consumer Law guarantees on repairs. Add any of them with `/customise`: name the rule and its source, and the doc and the check change together.
