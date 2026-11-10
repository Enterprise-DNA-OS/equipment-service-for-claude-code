---
description: "Close a job with what was done."
---

# Complete

Ask for: what was found and done, labour minutes, the hour meter reading (needed for plans counted on hours), whether it was fixed on the first visit, and for installs or inspections whether the checklist was completed and filed. Record parts first with `/part`. Then `npm run service -- complete <job> --note="<work done>" --minutes=<n> --hours=<meter>`, adding `--not-first-visit`, `--checklist` or `--no-charge` as told. If the unit is in warranty, offer `/claim`.
