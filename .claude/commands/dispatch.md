---
description: "Open jobs in the order they should go out: priority, then response deadline."
---

# Dispatch

Run `npm run service -- dispatch`. Call out anything unassigned or with a negative minutes to due first. Suggest a technician by region from `npm run service -- technician-load`, but book nothing until the operator says so (`/assign`).
