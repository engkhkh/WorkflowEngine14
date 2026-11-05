# WorkflowDb - demo database script

`WorkflowDb.sql` is a SQL Server script (schema + data, generated with *Script Database -> Schema and data*, SQL Server 2016 / compatibility level 130) of the WorkflowEngine demo database: five years of demo data in every module (finance, procurement, warehouse, manufacturing, CRM, sales, POS, website, projects, hospital, HR, payroll, assets, workflow, BPM, integration, BI, governance ...).

## Restore
1. Open the file in SSMS (or run `sqlcmd -S <server> -i WorkflowDb.sql`).
2. Edit the two `FILENAME = N'D:\...'` paths at the top to folders that exist on your server.
3. Run it. It creates the database `WorkflowDb`; point `ConnectionStrings:Default` of the backend at it.

## Not included on purpose
This script is in a public repository, so credentials were removed:
- every user's `PasswordHash` / `PasswordSalt` is empty - set passwords again (create the users from the app's *Users & Privileges*, or re-run `uat/seed.js`);
- API-key hashes are empty (create new keys in *Integration*);
- real e-mail addresses were replaced by `masked@example.com`.

The data is test data; do not use it as a production backup.
