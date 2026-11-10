---
description: "Raise a draft warranty claim for a repair on a unit under warranty."
---

# Claim

Run `npm run service -- claim <job>` (parts at cost plus labour at the maker's rate) or with `--amount=<dollars>`. Then offer `/draft-claim`. The database refuses a claim for a unit out of warranty when the job came in.
