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

## Sign-up and team onboarding (Odoo style)
1. **Sign up** (`/login` -> Create account): creates the workspace, ONE company (starter plan `maxCompanies = 1`), the first branch, and the user as `admin`. The workspace starts with `setupDone = false`.
2. **Setup wizard** `/setup` (admin only): Company (name, Arabic name, currency, country, tax no) -> Branches (add / remove) -> Team (invite employees) -> Finish (`POST api/org/setup/complete`). A banner reminds the admin until it is finished.
3. **Invitations**: the admin creates a user with "Send an invitation" (no password). The API returns a 7-day signed link `/accept-invite?token=...` (also e-mailed when SMTP is configured). The employee opens it, chooses a password and is signed in; the link only works while the account has no password. "Invited" badge + "new invitation" button in Admin > Users.
4. **Access per employee**: role + privilege editor (existing), plus **branch access** (like Odoo's allowed companies). Empty = every branch. The server enforces it (`ICurrentUser.AllowedBranchesAsync / CanUseBranchAsync`) in the ERP and POS lists and writes; the branch pickers in the apps only show the allowed branches.
5. **One company**: the "Add company" button disappears when the plan limit is reached; more branches are allowed up to `maxBranches`.
Backend files: `InviteTokens.cs`, `AuthController` (`auth/invite`, `auth/accept-invite`), `UsersController` (invite / reissue), `TenantsController` (signup), `OrgController` (`org/setup/complete`), `Security.cs`, `ModulesController`, `PosController`; new columns `Users.Branches`, `Tenants.SetupDone`, `OrgCompanies.Country` are added by `SchemaUpgrade`.

## Subscription billing (Visa / mada)
- **Price**: every ACTIVE user = **5 USD / month**; a workspace with **more than 100 users** pays **3 USD for every user**. Invoice per workspace (company + its branches): lines per branch, a user is counted once (under the first branch he is limited to, or "All branches").
- **Monthly invoice**: `BillingHostedService` creates it on the 1st (checks hourly, so a server that was off catches up); the admin's Billing tab also creates the current month's invoice on first look. One invoice per workspace and month (unique index). Table `BillingInvoices` is created by `SchemaUpgrade`.
- **Where**: Admin > **Billing** (needs `org.manage`, i.e. the workspace admin): price, estimate, balance, users by branch, invoices, Pay now, print. Mobile: Admin > Billing.
- **Paying**: card data never touches our servers. `POST api/billing/invoices/{id}/pay` returns the provider's hosted page (Visa, Mastercard, **mada**); on return the portal calls `.../confirm`, which asks the provider if it is paid (the redirect is not trusted). `POST api/billing/webhook?s=<secret>` re-checks an invoice too. mada works only in SAR, so the card is charged `total x SarPerUsd` (3.75, stored on each invoice).
- **Provider**: `Billing:Provider` = `sandbox` (default, test button, no card) or `moyasar`.
```json
"Billing": {
  "Provider": "moyasar",
  "PricePerUser": 5, "VolumePrice": 3, "VolumeFrom": 100, "SarPerUsd": 3.75, "DueDays": 7,
  "Moyasar": { "SecretKey": "sk_live_..." },
  "WebhookUrl": "https://api.yourdomain.com/api/billing/webhook?s=LONG_RANDOM",
  "WebhookSecret": "LONG_RANDOM",
  "AllowedReturnHosts": [ "app.yourdomain.com" ]
}
```
Keep the secret key in environment variables / user-secrets (`Billing__Moyasar__SecretKey`), never in the repository. Another provider (HyperPay, Tap, ...) = one class implementing `IPaymentGateway`.

## Website module (design, shop, download, publish)
Portal > **Website** (sidebar). Privileges (Admin > Roles): `web.view` see, `web.edit` design, `web.publish` publish / delete, `web.orders.manage` orders and messages (admin has all; they are added to the database at startup).
- **Sites list**: create from a template (Blank, Business, Online shop), open the designer, live / draft status, public address.
- **Designer** (`/website/:id`): left tabs Add (14 blocks: menu bar, hero, text, image, features, products, gallery, testimonials, FAQ, call to action, contact form, map/video, spacer, footer), Layers (drag to reorder, duplicate, delete), Pages (add, rename, order), Theme (colors, font, corners, dark mode, English LTR / Arabic RTL), Shop (sync products from the POS catalogue). Centre = the real rendered site in an iframe (click a section to edit it; desktop / tablet / mobile width). Right = properties of the selected block (text, images with upload, colors, repeatable items). Undo / redo (Ctrl+Z), autosave, Ctrl+S.
- **Download**: one self-contained `.html` file (all pages, menu, cart). **Preview** opens it in a new tab.
- **Publish**: the portal renders the site to one HTML page and stores it (`WebSites.PublishedHtml`); it is served at `https://<api-host>/s/<slug>` (no sign-in). "Take offline" hides it. A reverse proxy / custom domain can point to that address.
- **Shop**: products come from POS (`api/pos/records/product`); prices are frozen at publish time. The cart posts to `POST api/public/sites/{slug}/orders`; the server recomputes the total from the frozen price list, limits requests per address and stores the order in `WebSubmissions` (Orders & messages tab: set status new / confirmed / shipped / done / cancelled). The contact form posts to `.../messages`. Online card payment of shop orders is NOT included (orders are paid on delivery / by agreement); the Moyasar gateway used for billing could be reused.
- **Security**: published pages are customer-authored HTML, so they are served with a CSP `sandbox` (no access to the server's origin / storage), all text is escaped, links are limited to http(s), mailto, tel and in-site pages, embeds to YouTube / Google Maps / OpenStreetMap.
- Backend: `Models/Website.cs`, `Controllers/WebsiteController.cs` (admin API + public controller), tables created by `SchemaUpgrade`. Front end: `portal-app/src/app/website/` (`site-renderer.ts` is the single renderer used by preview, download and publish). The designer is portal-only (desktop); the mobile app does not include it.

---

## Modules per company, Workflow designer and Hospital

### Choosing the modules a company uses
- **Admin → Modules** (privilege `org.manage`; also shown at the end of the setup wizard). The workspace admin ticks the modules the company uses:
  HR, Finance, POS, Manufacturing, Projects, CRM, Procurement, Supply chain, Warehouse, Assets, Payroll, Planning, BPM, Integration, BI, Website, Workflow designer, Hospital.
- API: `GET api/org/modules` → `{ all, enabled, restricted }`, `PUT api/org/modules` `{ enabled: [...] }`. Stored in `Tenants.Modules` (JSON, `NULL` = every module, so existing workspaces keep working).
- Enforcement is central (`RbacStore.IsOn / DefsFor / ModuleOn`, `ModuleCatalog`): a privilege belongs to a module by its prefix (`hos.*` → hospital, `wf.*` → workflow …). A module that is switched off removes its privileges from the privilege editor, from every user's effective privileges and from the menu, and every controller check (`Has`, `RequireAsync`) fails for it. Core privileges (dashboard, tasks, documents, reports, assistant, org, admin) are always on.
- **Privileges per user and per module**: Admin → Users → privilege editor groups the privileges by module (`perm.group.*`). Hospital staff presets exist as roles: `doctor`, `nurse`, `pharmacist`, `lab-technician`, `receptionist` (an admin can still tailor every user one by one).

### Workflow designer (moved from the old `frontend` project into the portal)
- Portal routes `/workflow` (flows), `/workflow/designer[/:id]`, `/workflow/instances[/:id]`; privileges `wf.view`, `wf.design`, `wf.publish`, `wf.instances.view`.
- Flows are now **per workspace** (`Definitions.TenantId`). Published flows of the platform ("default" workspace) are shared read-only **templates**: a company can open one and "Duplicate to my workflows". Start/instances only accept the workspace's own flows or those templates.
- Publishing/deleting needs `wf.publish` (was: role admin).

### Hospital (`hos.*`)
Backend: `Controllers/HospitalController.cs` (`api/hospital`), table `HosRecords` (created at startup by SchemaUpgrade, same generic shape as `PosRecords`). Portal: `/hospital/*` (Overview, Patients + patient file, Appointments, Visits, Laboratory, Pharmacy, Wards & beds, Billing, Setup).

Rules enforced on the server (not in the screens):
- **Patients**: MRN generated, duplicate national id refused, allergies/chronic conditions/insurance on the file. Opening a patient file is written to an access log (visible with `hos.setup`). Clinical data needs `hos.clinical.view`. Patients, clinical and billing records are never deleted.
- **Appointments**: inside the doctor's working days/hours, no overlap for the doctor or for the same patient; free slots are offered in the booking dialog; check-in opens a visit with a queue number; cancel / no-show.
- **Visits**: vitals with plausibility limits, SOAP notes, diagnoses (a visit cannot be closed without one), priced services from the price list, closed visits are read-only.
- **Prescriptions** (`hos.prescribe`): checked against the patient's allergies, against other medicines in the same prescription and those taken in the last 30 days (interactions) and against chronic-condition contraindications. A warning blocks saving unless a written reason is given; the reason and warnings stay on the prescription.
- **Pharmacy**: dispense only what is in stock (or partial on request), every stock change leaves a movement (`drugmove`), stock cannot go negative, low-stock list on the overview.
- **Laboratory**: ordered per visit, result is flagged Low / High / Critical from the test's reference range; a released result is amended (history kept), never overwritten.
- **Wards & beds**: one patient per bed, admit / transfer / discharge (discharge needs a summary; "Deceased" closes the file), maintenance state.
- **Billing**: the invoice is built from the visit (consultation fee, services, lab, dispensed medicines, bed days at the ward rate with transfers priced per stay), insurance covers its percentage only while the policy is valid, payments (cash / card / mada / transfer) cannot exceed the balance; status Unpaid / Partial / Paid.
- **Setup**: departments, doctors, wards, beds, price list, lab catalogue, formulary; "Load sample setup" fills an empty hospital with a working example.

Not included yet: ICD-10 catalogue lookup (free text + code), DICOM/imaging, insurance claim submission, mobile hospital screens (the mobile app only gets the privilege labels).

### Hospital: works in any country (settings, not hard-coded)
- **Setup → General**: hospital name, currency, tax name and rate (VAT / GST / none = 0), line types that carry no tax, payment methods offered at the cashier, and the weekend days. The sample setup takes the currency of the company and the weekend of the user's browser region.
- **Time zones**: "today", the 7-day charts, the revenue of the day, queue numbers and insurance validity use the calendar day of the person using the screen (the browser sends its day and offset); appointment times are plain local clock times of the hospital.
- **Money**: invoices show the tax as its own line, insurance covers its percentage of the total; no currency or payment brand is built in (the platform subscription in Admin → Billing is separate).
- Dates, numbers, language and right-to-left layout follow the user's language setting (8 languages). ID fields are free text ("ID / passport number"), phone numbers are not format-checked. Units are metric (kg, cm, °C); lab units are whatever the test catalogue says (mg/dL, mmol/L ...).

### Works in any country (all modules)
- **Region defaults** (`core/region.ts`, portal and mobile): a new workspace pre-fills country, currency and the default tax rate from the user's browser region (about 90 countries; USD / 0 % when unknown). Every value stays editable (Admin → Organization, POS setup, Hospital → Setup → General). No currency, tax rate, branch or demo company is fixed to one country any more; the currency list has ~70 currencies.
- **Money display**: the `money` pipe uses the company's currency (else the region's); numbers and dates follow the UI language.
- **Time zones**: every request carries `X-Tz-Offset` (minutes); the backend's `ClientClock.Today` (POS reports, finance overdue/aging, module summaries, hospital) uses the caller's own calendar day, UTC for integrations that send nothing.

## Sales orders, helpdesk, subscriptions, expenses, quality and fleet

Six modules added to close the gap with Oracle Fusion, SAP, Dynamics and Odoo. They sit on the generic ERP records engine (`api/erp/{module}/records/{kind}`) and are switchable per workspace like every other module.

| Module | Screens | Actions (`POST .../bizact/{kind}/{id}/{op}`) |
|---|---|---|
| Sales orders (`so`) | Orders, Deliveries, Price lists | confirm, deliver (full or partial), invoice, cancel |
| Helpdesk & field service (`hd`) | Tickets, Visits, Service contracts, SLA policies | assign, start, wait, resolve, close, reopen, cancel; visit start/complete/cancel. SLA due dates and breach flag are calculated |
| Subscriptions (`sub`) | Subscriptions, Invoices, Plans | activate, pause, resume, cancel, generate next invoice, mark invoice paid/void |
| Expenses (`exp`) | Claims, Categories | submit, approve, reject, pay (employees see only their own claims) |
| Quality (`qa`) | Inspections, NCRs, Inspection plans | record inspection result (a failure opens an NCR), investigate, correct, close |
| Fleet (`flt`) | Vehicles, Drivers, Fuel logs, Service | service start/complete; fuel logs update the odometer |

Privileges (`so.*`, `hd.*`, `sub.*`, `exp.*`, `qa.*`, `flt.*`) are seeded on start; assign them in Admin > Roles. Presets: sales-orders, support-agent, quality-inspector, fleet-manager; employees get `exp.view` and `exp.claims.manage`.

**Where:** web portal and mobile app have full screens including the action buttons. The four desktop apps (Python, Java, C++/Qt, C#/WPF) list, create and edit these records through the generic catalog screens and have an **Actions** menu on the selected row (confirm, deliver, approve, resolve ...; defined per record type under `actions` in `shared/catalog.json`). The mobile-versions apps (Ionic, React Native, Flutter, MAUI) carry the same catalog but have no action menu yet.

**Working-core limits:** no automatic stock movement or general-ledger posting from orders, deliveries, claims or subscription invoices, and no payroll link for expense payments.

## Calendar & Meetings, and Muslim (prayer times and Quran)

Both are optional modules: the admin switches them on per company (Admin > Modules, or the last setup step) and gives them to users one by one
(Admin > Users & Privileges: groups "Calendar & Meetings" and "Muslim"). Employees get the basic ones by default.

**Calendar & Meetings** (`/calendar`, privileges `cal.*`, table `CalEvents`, API `api/calendar`)
- Month / week / agenda views; events, to-dos (with priority and due time), repeat daily / weekly / monthly, reminders while the portal is open.
- Video meetings: pick people of the company and outside guests (e-mail). The meeting gets a private, unguessable room; only the owner and the invited people can get the link
  (opens 15 minutes before the start). The video itself runs on Jitsi Meet (camera, microphone, chat, screen sharing). The free public server meet.jit.si opens in its own tab;
  a company Jitsi server set in Calendar > Settings is embedded inside the page. "Meet now" starts an instant meeting.
- Scheduling assistant: shows who is busy at a time and suggests common free slots inside working hours (it only receives busy/free blocks, never other people's titles).
- Rules on the server: you see only your own and invited entries; only the owner (or a calendar administrator) edits or deletes; invited people answer yes / maybe / no;
  cancelling a meeting tells the invited people; invitations by e-mail need the existing Smtp settings; each entry downloads as .ics.
- Your pending workflow tasks are listed beside the calendar.

**Muslim** (`/muslim`, privilege `mus.view`, no server table: settings are per user in the browser)
- Prayer times for any place on earth, calculated offline by the astronomical method and checked against the `adhan` reference library (within about 1 to 2 minutes).
  Country and city list (74 countries), your own coordinates, or the browser location; 15 calculation methods (pre-selected from the country), Asr Shafi'i/Hanafi,
  rule for far-north places, minute adjustment per prayer, Hijri date, Qibla direction and distance, month table, 12/24 h clock. Daylight saving follows the time zone.
- Reminders per prayer (at the time or N minutes before), soft chime or your own Adhan audio link, browser notifications, each reminder can carry a verse with its explanation,
  plus an optional daily verse time. Reminders run while the portal is open in a browser tab.
- Holy Quran: all 114 surahs in Arabic, a translation in your language (and any other), explanation (Tafsir) per verse, verse-by-verse audio, bookmarks and "continue reading".
  The text comes from the public service api.alquran.cloud and the audio from cdn.islamic.network; what you open is kept on the device. The address can be changed to a copy of your own in `quran.service.ts`.

## Custom modules and the offline assistant

**What it is.** Users build their own modules (e.g. Fleet, Visitors) from the sidebar *Custom modules* designer or by typing to the AI assistant. No AI model or internet is needed: `core/assistant-build.ts` (`BuildEngine`) is a built-in command engine (en/ar full; fr/es/de/it/ur basic).

**Example commands**
- `create module Fleet with fields plate, model, year` / `create module visitors` (template) / Arabic equivalents
- `add field Status to Fleet`, `remove field Year`, `rename field Plate to Number`, `make Plate required`
- `rename module Fleet to Vehicles`, `list modules`, `delete module Fleet` (asks yes/no)
- `rename Dashboard to Home` (label rename, per device), `reset names`
- Theme / layout / menu hide-show commands from `assistant-customize.ts` (per user)

**Data.** Table `CustRecords` (created idempotently at startup by `SchemaUpgrade`). A `Kind="_def"` row holds the module definition (title, icon, fields); other rows are records (`Kind` = module key). Field keys are stable, labels can change; removing a field keeps stored values. Server validates records against fields.

**API.** `api/custom/modules` (GET/POST/PUT/DELETE `{key}`), `api/custom/records/{key}` (GET/POST/PUT/DELETE `{id}`).

**Privileges.** `cus.view` (employees), `cus.manage`, `cus.design` (managers). Enable per company with the *Custom modules* module toggle.

**Limits.** One `cus.*` privilege set for all custom modules; label renames are stored per device (localStorage `portal_labels`); no menu reordering; no mobile screens for custom modules.
