# Why there is no front end

Salesforce Field Service is a database with a subscription. Underneath it are ordinary records: customers, sites, the machines you look after, service contracts, maintenance plans, work orders, parts and warranty claims. What you pay for per technician and per dispatcher is the layer on top: the dispatch console, the mobile app, the dashboards.

The service manager's real questions rarely live on those screens. Which contracts lost money this year? Which repairs could still be claimed from the maker? Which forklift keeps coming back? Here you ask them in plain words and Claude Code answers from your own records.

## What you gain

- **Answers the console never charted.** Contract margin, warranty money left unclaimed, repeat breakdowns, response times against each promise, technicians booked on work their ticket does not cover.
- **No seats.** Every technician, dispatcher and manager can look. The bill does not grow with headcount.
- **Your data in a database you own.** Plain Postgres tables. Back them up, query them from anything, leave any time.
- **Your rules.** Change a response time, a claim window or a renewal notice period by asking.

## What a screen gives that this does not

Be honest with your team about these before you switch:

- **A technician phone app.** Technicians in the field want to see their day, the unit's history and the site notes on a phone, often with no signal. This has no app. They can call or message the office, or you can have one built (see below).
- **Offline working.** Nothing here works without the machine it runs on.
- **A drag-and-drop dispatch board.** Here the dispatcher asks "who is free in the West tomorrow?" and books it in words. A visual board is faster for a busy dispatcher moving twenty jobs at once.
- **Photos, signatures and checklists on site.** The records hold what was done and whether the checklist was filed. They do not capture a customer signature or a photo.
- **Route optimisation and live location.** Not here.

## Who this fits

An equipment dealer or distributor whose office runs the service department: a service manager, a dispatcher or two, and technicians who already ring in. If your technicians live in a phone app all day, keep that part, or have Enterprise DNA build a small app on top of this database so you stop paying per seat for the rest.

Installed and run for you, with a technician app if you want one: https://enterprisedna.co/omni/instead-of/salesforce-field-service
