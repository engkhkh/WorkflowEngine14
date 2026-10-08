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

## Cross-module collaboration (notes, attachments, saved filters, report designer)
- **Chatter**: every record dialog (ERP modules, Finance lists, POS lists, HR employees) has Notes + Attachments; edits are written to the log automatically ("field: old -> new").
- **Saved filters**: on every list, save the current search/status filter under a name, optionally shared with the workspace.
- **Report designer** (printer button on each list): choose columns and order, title, header/footer, orientation, grouping, totals; preview and **Print / Save as PDF**; layouts can be saved and shared. RTL languages print right-to-left.
- Backend: `Controllers/CollabController.cs` (`api/collab/...`), stored in `ErpRecords` with `Module = "collab"` (no new table). Attachments are stored as base64 in the database (max 4 MB each, 25 per record); needs a non self-service privilege of the record's module. Deleting someone else's note/file/shared item needs `admin.users`.
- Not yet wired: the AP/AR invoice lists, HR leave/performance/recruitment tables and POS sales (they use their own tables).

## Access layer (backend) and API layer (front end)
**Backend** `Security/Security.cs`, wired in `Program.cs` by `backend-sec/patch.py`:
`Controller -> ICurrentUser / [RequirePermission] / ISecureData -> services -> database`
- `ICurrentUser`: username, role, workspace and privileges of the caller (privileges read from the DB once per request).
- `[RequirePermission("a","b")]`: declarative privilege check on a controller/action (any-of inside one attribute, all attributes must pass; refusals are logged).
- `ISecureData`: workspace-scoped reads and writes (`ReadAsync<T>()`, `AddAsync(x)` stamps the caller's workspace). Entities opt in with `ITenantOwned` (ErpRecord and PosRecord done).
- `SessionValidationMiddleware`: after the token is valid, the account must still exist and be active (cached 20 s), so a deactivated user is cut off at once.
- `SecurityErrorMiddleware`: `AccessDeniedException` -> 403 JSON.
`CollabController` is the pilot that already uses it; other controllers still use the old checks and can be moved one by one.

**Front end** `core/api/` (portal and mobile):
- `ApiClient`: single door for API calls (`api.get('erp/crm/records/lead')`): base URL, params, `ApiError`, shared identical GETs, optional cache, cache cleared after writes.
- `apiInterceptor` (replaces `authInterceptor`): token, `Accept-Language`, `X-Correlation-Id`, retry of failed GETs (network / 502-504), 401 -> sign out once, notices for 403 / offline / 5xx on user actions.
- `<app-api-status>`: progress bar and notice toast. `CollabService` is the pilot that uses `ApiClient`; the other services still use HttpClient (they also benefit from the interceptor).
