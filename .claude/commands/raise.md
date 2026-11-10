---
description: "Open a job: a breakdown the customer rang in, an install, an inspection, or planned maintenance."
---

# Raise

Find the unit (`/unit`), then `npm run service -- raise <unit> --text="<what they reported>" --priority=<urgent|high|normal|low>`. Use `--kind=` for anything that is not a breakdown and `--plan=<plan>` for planned maintenance. The unit's active contract is attached and the response clock starts at `--at` (default now). Then show `/dispatch`.
