---
description: "Record something new: a customer, site, unit, contract, plan, technician, ticket or maker."
---

# Add

Write the record as JSON to a temp file with only the fields the operator gave (fields: docs/cli.md), then `npm run service -- add <type> --data=<file>`. Covering a unit with a contract is a `contract_equipment` row: ask Claude Code to insert it with the unit and contract codes. Show what was saved.
