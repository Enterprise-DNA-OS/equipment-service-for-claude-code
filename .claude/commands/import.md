---
description: "Bring accounts, assets, service contracts, contract lines and work orders across from a Salesforce Data Export."
---

# Import

Read docs/replace-salesforce-field-service.md. Import in order: accounts, assets, contracts, contract-lines, work-orders. Always dry run first: `npm run service -- import salesforce --kind=<kind> --file=<csv> --dry-run`. If the columns differ, write a mapping JSON (`{"kind":"Product_Family__c"}`) and pass `--map=<file>`. Then run it without --dry-run. Repeat imports change nothing; a changed record stops the import for reconciliation.
