# Moving off Salesforce Field Service

Salesforce lets an administrator export the org's records as CSV files, one file per object, through Data Export in Setup (Export Now, or a scheduled export on the editions that have one). The column headers are the fields' API names. Bring the files in here in the order below, then run both systems side by side for a few weeks before you stop paying for seats.

## 1. Export these objects

| Object (file) | Columns the importer reads by default |
|---|---|
| Account | Id, Name, AccountNumber, Phone, BillingCity |
| Asset | Id, Name, SerialNumber, AccountId, InstallDate, Status, plus two you add: Kind, WarrantyEndDate |
| ServiceContract | Id, Name, ContractNumber, AccountId, StartDate, EndDate, plus Kind if you add it |
| ContractLineItem | ServiceContractId, AssetId |
| WorkOrder | Id, WorkOrderNumber, AccountId, AssetId, ServiceContractId, Subject, Description, Priority, Status, CreatedDate, EndDate, plus Kind if you add it |

Examples of each file are in `examples/`.

Three columns are not standard Salesforce fields, so add them to the file before importing (or ask Claude Code to work them out from another column):

- **Kind** on assets: forklift, compressor, generator, refrigeration, pump, boiler, crane, elevating_work_platform, kitchen, dairy or other. Your product family usually says it.
- **WarrantyEndDate** on assets: if you use Asset Warranty records, take each asset's warranty end date from that export. Without it, warranty claims cannot be checked.
- **Kind** on work orders: breakdown, planned, install, inspection, warranty or other. Your work types usually say it. Without it, imported work orders come in as `other` and are left out of response times.

## 2. Dry run, then import, in this order

```bash
npm run service -- import salesforce --kind=accounts --file=Account.csv --dry-run
npm run service -- import salesforce --kind=accounts --file=Account.csv
npm run service -- import salesforce --kind=assets --file=Asset.csv
npm run service -- import salesforce --kind=contracts --file=ServiceContract.csv
npm run service -- import salesforce --kind=contract-lines --file=ContractLineItem.csv
npm run service -- import salesforce --kind=work-orders --file=WorkOrder.csv
```

Each file links to the ones before it by Salesforce Id, so the order matters. If a column is named differently, write a mapping file and pass it:

```json
{ "kind": "Product_Family__c", "warranty_ends_on": "Warranty_End__c" }
```

```bash
npm run service -- import salesforce --kind=assets --file=Asset.csv --map=map.json --dry-run
```

Or ask Claude Code: "map this Salesforce export to the importer and dry run it".

## 3. What maps

- Each record keeps its Salesforce Id, so a repeat import changes nothing and a later export can be brought in again.
- Asset status: Purchased, Shipped, Installed and Registered come in as in service; Obsolete as removed. Anything else stops the import with the row number.
- Contracts whose end date has passed come in as ended.
- Work order status: New, In Progress, On Hold, Completed, Cannot Complete, Closed and Canceled map to open, in progress, waiting on parts, done and cancelled. Priority: Critical, High, Medium and Low map to urgent, high, normal and low. Completed work orders come in as done and not chargeable, so the invoicing check does not flag years of old work.
- A record already imported with a different name, serial or end date stops the import so you can decide which is right. A failed import saves nothing.

## 4. What does not carry over automatically

- **Response times on old work.** On-site times live on Service Appointments, not work orders. Export ServiceAppointment (ActualStartTime) and have Claude Code map it if you want last year's response record; otherwise response times count from the day you switch.
- **Maintenance plans.** Recreate each plan here with its interval in days, run hours or both (`/add`), counted from the last visit. Claude Code can draft them from a MaintenancePlan and MaintenanceAsset export.
- **Parts, technicians, tickets and makers.** Add them here, or import a product consumed export by asking Claude Code to map it.
- **Contract value and response time.** Not on the standard ServiceContract export; add them per contract (`/update`).
- **Attachments, photos and signatures.** Keep them in Salesforce or your file store for the period you must keep them.
- **Scheduling, routes and the mobile app.** There is no dispatch board or technician app here: see `docs/why-no-front-end.md`.

## 5. Check before you switch

1. Run `/units` and `/contracts` and compare the counts with Salesforce.
2. Run `/pm-due` and check it against what the dispatcher expects this month.
3. Run `/compliance` and work through what it finds.
4. Keep both running for a few weeks. When the Monday review here is the one the service manager reads, stop renewing the seats.
