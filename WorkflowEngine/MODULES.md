# ERP modules added (POS + 12 business modules)

Portal (`portal-app`) and mobile (`mobile-app`) share the same screens: the mobile app hosts the portal's HR / Finance / POS / ERP pages inside an Ionic shell (`workspaces.routes.ts` + `WorkspaceHostPage`), so every portal feature is also in the mobile app (Modules list under **More**).

## Modules
POS (optional branches), Manufacturing, Projects, CRM, Procurement, Supply Chain, Warehouse & Inventory, Asset Management & Maintenance, Payroll, EPM/Budgeting & Planning, Workflow/BPM, Integration/API, BI/Analytics/AI.
Records live in the generic `ErpRecords` table (`api/erp/{module}/records/{kind}`), POS in its own tables; all created at startup by SchemaUpgrade.

## Privileges stored in the database
Pages and privileges are rows (`PermissionDefs`, `RoleDefs`) managed in **Admin > Roles & privileges** (portal and mobile): edit the role matrix, create/copy/delete roles, enable/disable a page, add/delete custom privileges. The API re-checks privileges on every request; the UI only hides things.

## Integration
- API keys (hash stored, secret shown once) and HMAC-signed webhooks in the Integration module.
- Read-only public API: `GET api/integration/v1/{module}/{kind}` with header `X-Api-Key`.
- `api/erp/mfg/lookups/users` provides the user directory for assignment pickers.

## Backend
Folders `backend-pos` and `backend-mod` hold the C# sources plus `patch.py` (apply order: POS patch, then modules patch) as well as `backend-hr` / `backend-fin` from earlier work.
**The backend was never compiled where it was written (no .NET SDK there). Only a syntax check passed. Build once and fix any compile errors.**

## Setup
Run `npm install` in `portal-app` and `mobile-app` (adds `read-excel-file`, `write-excel-file`). Languages: ar, en, fr, es, ur, de, it.
