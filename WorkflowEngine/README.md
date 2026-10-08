# Workflow Engine (Skelta + n8n + Camunda style)

A self-hosted BPM/workflow engine built from scratch:

- **Backend**: ASP.NET Core 8 Web API (`backend/WorkflowEngine.Api`) — the process engine,
  REST endpoints, and **EF Core on SQL Server** for persistence.
- **Frontend**: Angular 17 standalone app (`frontend`) — visual flow **Designer** (drag nodes,
  connect them, like n8n/Camunda), a **dynamic form builder/renderer** (like Skelta InfoPath-style
  forms), a **Task Inbox** with Approve/Reject actions, and an **Instance** audit-trail/history view.

## Feature Map

| Feature | Inspired by | Where |
|---|---|---|
| Visual drag/connect flow designer | n8n / Camunda Modeler | `frontend/src/app/designer` |
| Start / End / Form Task / Approval Task nodes | Camunda BPMN + Skelta activities | `Models/WorkflowDefinition.cs`, designer palette |
| Exclusive gateway (Condition, e.g. `days > 5`) | Camunda XOR-gateway | `ConditionEvaluator.cs` |
| **Parallel Split / Parallel Join (fork-join)** | Camunda AND-gateway / Skelta parallel activity | `WorkflowEngineService.FollowEdge` (join-arrival counting) |
| **Timer node - really waits** | Skelta delay activity | `NodeType.Timer` (via hidden system task + `TaskEscalationHostedService`) |
| **Email node** | Skelta email activity | `NodeType.Email` |
| **Webhook Call node - really calls the URL** | n8n HTTP request node | `NodeType.WebhookCall`, `WorkflowEngineService.CallWebhookAsync` |
| Generic Automation / script node | n8n action node | `NodeType.Automation` |
| Dynamic forms attached to a task node (text, number, date, dropdown, checkbox, email…) | Skelta Web/InfoPath forms | `Models/FormDefinition.cs`, `form-renderer/`, `designer/form-editor.component.ts` |
| Approve / Reject with branching outcomes | Skelta approval activities | `WorkflowEngineService.CompleteTask`, `tasks/task-detail.component.ts` || **Task priority (Low/Normal/High/Urgent)** | Skelta task priority | `WorkflowNode.Priority`, task inbox badges |
| **Time-based escalation** (reassign if left pending too long) | Skelta escalation rules | `Services/TaskEscalationHostedService.cs` |
| Task inbox per assignee | Skelta My Tasks | `tasks/task-inbox.component.ts` |
| **Instances** shows every run with its live status and a full timeline (including Forked / Joined / Escalated / AutoCompleted entries) plus the collected data. | Camunda Cockpit | `instances/instance-detail.component.ts` |
| **Visual process map per instance** — highlights the exact nodes/edges an instance traveled, live-polls while Running | Camunda Cockpit diagram view | `instances/instance-diagram.component.ts` |
| Publish / draft lifecycle | Skelta workflow versions | `WorkflowDefinitionsController.Publish` |
| Persistence via EF Core → SQL Server | — | `Data/WorkflowDbContext.cs` |
| Real user accounts + JWT login | Skelta/Windows auth | `Models/User.cs`, `Controllers/AuthController.cs` |
| Per-user task inbox (matches on username OR role) | Skelta My Tasks | `WorkflowEngineService.GetTasksFor`, `tasks/task-inbox.component.ts` |
| **4 ready-made templates**: Leave Request, Clearance, Employee Transfer, New Start Work | Skelta's built-in workflow library | `Services/SeedData.cs` |
| **Arbitrary custom outcome buttons per task** (not fixed to Approve/Reject) | Skelta's configurable Task activity | `WorkflowTask.AvailableDecisions`, `tasks/task-detail.component.ts` |
| **Auto-outcome nodes** (Timer/Email/Webhook/Automation pick a labeled edge via `DefaultOutcome`) | Skelta's Invoke Web API / Script / Timer branching | `WorkflowNode.DefaultOutcome`, `WorkflowEngineService.AdvanceFrom` |
| **Timeout auto-complete** (a task can complete itself on timeout instead of just reassigning) | Skelta's "Timeout Warning - Action" pattern | `WorkflowNode.EscalationMode`/`TimeoutDecision`, `TaskEscalationHostedService` |
| **2 flows recreated from real Skelta exports** you provided | — | `Services/SeedData.cs` (`BuildCandidatesRequestFromSkelta`, `BuildAmbitiousTransferFromSkelta`) |
| **"Where this came from" page** — Skelta/Camunda/n8n attribution per feature, plus origin badges in the designer palette | — | `about/origins.component.ts`, `NODE_PALETTE` origin field |

## Run it

### 1. SQL Server

Easiest local option is Docker:
```bash
docker run -e "ACCEPT_EULA=Y" -e "MSSQL_SA_PASSWORD=YourStrong!Passw0rd" \
  -p 1433:1433 --name workflow-sql -d mcr.microsoft.com/mssql/server:2022-latest
```
Or point `ConnectionStrings:WorkflowDb` in `backend/WorkflowEngine.Api/appsettings.json`
at any existing SQL Server / Azure SQL instance. Default dev connection string:
```
Server=localhost,1433;Database=WorkflowEngine;User Id=sa;Password=YourStrong!Passw0rd;TrustServerCertificate=True;
```

### 2. Backend (requires .NET 8 SDK)
```bash
cd backend/WorkflowEngine.Api
dotnet restore
dotnet tool install --global dotnet-ef   # first time only
dotnet ef migrations add InitialCreate
dotnet run
```
The app applies migrations, seeds nine demo user accounts (see below) and, if the database
is empty, seeds **four ready-to-run workflow templates** on startup (`Program.cs` →
`db.Database.Migrate()` + `SeedData.SeedUsers` / `SeedData.SeedWorkflows`):

| Template | What it demonstrates |
|---|---|
| **Leave Request Approval** | Escalation, a Condition gateway, Parallel Split/Join fan-out into Email + Webhook |
| **Clearance Approval** | A sequential multi-department sign-off chain (IT → Finance → Admin/Stores → HR) with a shared rejection exit |
| **Employee Transfer Approval** | Two-manager approval chain, a Condition gateway (cross-location), conditional HR sign-off |
| **New Start Work Approval** | Department-head approval, then a 3-way Parallel Split (IT provisioning, welcome kit, facilities email) synced back at a Parallel Join |

**⚠️ Change the `Jwt:Key` in `appsettings.json` before deploying anywhere real** - the
checked-in value is a placeholder dev secret.

API listens on `http://localhost:5000`.

**Demo accounts** (username / password), one per role used across the four templates:
| Username | Password | Role |
|---|---|---|
| `employee` | `employee123` | employee |
| `manager` | `manager123` | manager |
| `senior-manager` | `senior-manager123` | senior-manager |
| `hr` | `hr123` | hr |
| `it` | `it123` | it |
| `finance` | `finance123` | finance |
| `admin-stores` | `admin-stores123` | admin-stores |
| `department-head` | `department-head123` | department-head |
| `admin` | `admin123` | admin (only role that can Publish/Delete a workflow) |

### 3. Frontend (requires Node 18+)
```bash
cd frontend
npm install
npm start
```
Opens on `http://localhost:4200` and talks to the API at `http://localhost:5000/api`
(see `src/environments/environment.ts`).

## How the engine works

1. **Sign in** (`/login`) with one of the seeded demo accounts above, or add real users to
   the `Users` table (hash passwords with `PasswordHasher.Hash` - see `SeedData.SeedUsers`
   for the pattern). The JWT is stored client-side and attached to every API call.
2. **Design** a flow in the Designer: drag nodes from the palette (Start, Form Task, Approval,
   Condition, Parallel Split/Join, Timer, Email, Webhook, Automation, End) onto the canvas,
   click "🔗 Connect" then click a source node then a target node to link them.
   - Approval nodes auto-label their two outgoing edges `Approve` / `Reject`.
   - Condition nodes auto-label `True` / `False`.
   - Parallel Split just fires every outgoing edge as its own concurrent branch — connect it
     to two or more nodes.
   - Parallel Join waits for every branch that targets it before continuing.
   - Form/Approval nodes get an **Assignee picker** (pulled from the real `Users` table -
     assign to a specific person, or to an entire role so anyone with that role can pick it
     up), a priority, and an escalation panel (minutes + reassign-to, also picked from Users).
3. **Save**, then **Publish** the flow (admin role only; requires exactly one Start and at
   least one End node).
4. **Start** an instance from the Workflows list, or hit **Test Run** in the designer.
   `StartedBy` is taken from your logged-in identity automatically. The engine walks the
   graph: it stops and creates a task at every `FormTask` / `ApprovalTask` node, forks at
   `ParallelSplit`, waits at `ParallelJoin` until every branch has arrived, and auto-advances
   straight through `Condition` / `Timer` / `Email` / `WebhookCall` / `Automation` nodes
   (these are stubs in the demo engine — see below).
5. **My Tasks** always shows *your* queue only — every task whose `AssignedTo` matches your
   username **or** your role. Fill in the form and click **Approve**, **Reject**, or
   **Submit** — the API double-checks server-side that the task really is assigned to you
   (by username or role) before letting you complete it, records the decision in the
   instance history, merges the submitted data into the running instance, and follows the
   matching outgoing edge.
6. A background `TaskEscalationHostedService` sweeps every minute; any Pending task whose
   `EscalateAfterMinutes` deadline has passed gets reassigned to `EscalateTo` and logged as
   an "Escalated" history entry.
7. **Instances** shows every run with its live status. Open one to see the **Process Map** —
   the actual flow diagram with the exact path this instance took highlighted (green =
   traveled, red = a Reject edge, dim = never reached), the currently-active node pulsing,
   and a checkmark/✕ on nodes it has already passed through. The page polls every 3 seconds
   while the instance is Running, so you can watch it move live as other people complete
   their tasks — plus the full text timeline (including Forked / Joined / Escalated /
   AutoCompleted entries) and the collected data underneath.

## Recreating flows from real Skelta exports

Two of the seeded templates - **"Candidates Request (from Skelta)"** and **"Ambitious Transfer
(from Skelta)"** - are rebuilt from real Skelta XML workflow exports rather than hand-designed.
Getting these faithful required generalizing the engine beyond a fixed Approve/Reject model,
because Skelta's Task activities support arbitrary custom outcome buttons and its Web
API/Script/Timer activities branch on multiple real outcomes:

- **`WorkflowTask.AvailableDecisions`** - the buttons shown to whoever owns a task are now
  computed from the *actual outgoing edge labels* of that task's node, not a fixed enum. A
  node can offer `["Approve","Reject"]`, or `["Suitable","Approved"]`, or
  `["Approved","Rejected","Canceled"]` - whatever you connect in the designer.
- **`WorkflowNode.DefaultOutcome`** - Timer/Email/WebhookCall/Automation nodes can now have
  more than one outgoing edge (e.g. `Successful` / `UnSuccessful` / `Error Encountered`,
  mirroring Skelta's Invoke Web API activity). Since this demo engine doesn't actually call a
  real HTTP endpoint or run a real script, the designer picks which labeled edge the node
  always takes - this keeps a recreated flow's *shape* (including retry loops) faithful even
  though the branching itself isn't really executed yet.
- **`WorkflowNode.EscalationMode` = `"AutoComplete"`** - instead of just reassigning a
  stalled task, it can complete itself with a designer-chosen outcome
  (`TimeoutDecision`) and follow that edge - this is what Skelta's "Timeout Warning - Action"
  pattern actually does.

Both recreated flows keep the original activity names as comments/labels and use placeholder
`https://TODO-...` webhook URLs where the export referenced a real internal API - open either
one in the Designer to fill in your real endpoints, assignees, and condition expressions.

## Where each piece came from

Open **"Where this came from"** in the app's sidebar for a full breakdown of which features
were modeled on Skelta, which on Camunda, which on n8n, and which were built specifically for
your stack (real Users table, SQL Server via EF Core, the `ExternalReferenceId` correlation
column proposed for the AmanaPortal integration). The designer's node palette also shows a
small colored badge on every node type naming its origin.

## Extending it

- **Timer nodes really wait** - they create a hidden system task (`AssignedTo = null`, so it
  never appears in anyone's inbox) that reuses the exact same escalation machinery
  (`EscalateAfterMinutes` + `EscalationMode = "AutoComplete"`). The background
  `TaskEscalationHostedService` sweep (every ~15s) is what actually resumes the instance once
  the real duration elapses - watch it happen live on an instance's Process Map.
- **WebhookCall nodes really call the configured URL** via `HttpClient` - GET/DELETE go out
  as-is, POST/PUT send the instance's collected data as a JSON body. The outcome
  (`Successful` / `UnSuccessful` / `Error Encountered`) comes from the real HTTP response, and
  any flat JSON object the endpoint returns gets merged into the instance's data (so a
  "GetNewManager"-style lookup can feed a later node/condition). A blank or still-placeholder
  (`TODO`-containing) URL skips the real call and falls back to `DefaultOutcome`, so a
  not-yet-configured flow can still be test-run end to end.
- **A built-in demo service** (`Controllers/DemoController.cs`, `/api/demo/lookup/{key}` and
  `/api/demo/action/{key}`) lets you exercise the real webhook path with zero external
  dependencies - the seeded templates' WebhookCall nodes are pointed at it out of the box.
  `/api/demo/lookup/{key}` is deliberately flaky (~25% simulated failure) so flows that route
  `Error Encountered`/`UnSuccessful` into a retry Timer (like the two Skelta-recreated flows)
  actually get exercised when you test them, instead of always taking the happy path. Swap
  these URLs for your real endpoints whenever you're ready - nothing else needs to change.
- **Conditions support `&&`/`||` chains** (not mixed in the same expression) and a live
  **"Test" button** right in the designer's Condition panel - paste sample JSON, see the
  overall True/False plus a per-clause breakdown, without starting a whole Test Run.
- **Task/Approval forms pre-fill from data collected earlier in the same request** - a
  read-only field like `employeeName` on a manager-approval form now actually shows the value
  captured on the original request form, instead of always starting blank.
- Email/Automation nodes are still stubs (auto-complete via `DefaultOutcome`, same pattern
  Timer/Webhook used to use) - wire a real mail sender (SendGrid, SMTP) or script host into
  their `case` in `WorkflowEngineService.FollowEdge` the same way Timer/Webhook were done.
- Add real auth (JWT / Azure AD) and replace the free-text `Assignee` string with role/user lookups.
- `WorkflowDbContext` stores `Nodes`/`Edges`/`Data`/`History` as JSON columns (see
  `Data/JsonColumn.cs`) rather than fully-relational tables — simple and matches how the
  objects are used everywhere else. Move individual fields to real relational mappings later
  if you need to query inside them with T-SQL.
- **SubWorkflow (Camunda Call Activity) is currently a stub** - it records which workflow it
  would invoke but auto-completes rather than actually starting and waiting on a real nested
  instance. Wiring this up live needs two small `WorkflowInstance` columns
  (`ParentInstanceId`, `ParentResumeNodeId`) - a real (if small) migration, deliberately not
  done yet given how much migration back-and-forth this project has already been through;
  ask for it explicitly when you're ready and I'll do the schema change carefully alongside it.

## This round's additions

- **Findings from inspecting `Skelta_HWS.dll` and `Skelta_BAM.dll`, applied**: the assemblies'
  metadata shows Skelta computes escalation/SLA deadlines against a **business-hours calendar**
  (`Calendar.BusinessHours.Timeout.GetActivityTimeoutDateTime`, BAM's `CalculateBusinessHours`)
  and keeps **reminder handlers separate from reassign handlers** (`EscalateReminderMessage` /
  `EscalateNotificaion` vs `EscalateWorkItemReassign`). Both are now in:
  - **`UseBusinessHours`** on any task node - `EscalateAfterMinutes` then counts only configured
    work hours/days (`BusinessHours` section of `appsettings.json`, default Sun-Thu 09:00-17:00
    **UTC**; one global calendar - no holidays, per-region calendars, or timezone conversion).
  - **`Notify` escalation mode** - a one-time reminder to `EscalateTo` (a user, or every user in
    a role), logged as "Reminded"; the task is not reassigned or completed. Emails need SMTP
    configured; the reminder is logged either way.
  - **Bug fixed while there**: the escalation sweep's history entries (Escalated/Reminded) were
    never being written to the `ActivityLogs` table or log file - only Start/Complete were.
    Now they are.
  - **No new migration** - everything is JSON-nested on the node or a new string value in an
    existing column. (The `ActivityLogs` table from the previous round is still required.)

- **Real execution logging, saved to both a DB table and a file** - every node action
  (Entered, Approved, Rejected, AutoCompleted, Escalated, Canceled, etc.) is now written to a
  new `ActivityLogs` table (plain relational columns, queryable with SQL across every instance
  at once - unlike `WorkflowInstance.History`, which lives inside that instance's own JSON
  blob) and mirrored to a plain-text file under `backend/WorkflowEngine.Api/Logs/` (one file
  per day, no new NuGet package - a small hand-rolled writer, not Serilog/NLog). Click into any
  instance and expand **"Persisted Activity Log"** near the bottom of the page to see it read
  straight from that table - proof it's a real, separate, durable record, not just a reflection
  of the instance's own history.

  **⚠️ This needs a schema change.** Given how much migration back-and-forth this project has
  already had, the fastest path is the manual script: run `add_activity_logs_table.sql`
  (repo root) directly against your database - it's idempotent, safe to run regardless of
  current state. If you'd rather use EF migrations, run `dotnet ef migrations add
  AddActivityLogs` **before** running the manual script (not after - matching the ordering
  that's caused problems here before), then `dotnet ef database update`.

- **Fixed a real hang bug**: the multi-assignee `<select multiple>` was bound via `[ngModel]`
  to a method call that returned a new array every change-detection cycle, so Angular's
  multi-select value accessor rebuilt every option's selection state constantly instead of
  only on real changes. Fixed by binding each `<option>`'s `[selected]` individually and
  reading the selection via a plain `(change)` event instead.
- **Click a node on the Process Map to see exactly what happened there** - a detail panel
  shows every history entry for that node (action, actor, timestamp, comment). Survives the
  3-second live-polling refresh without losing your selection.
- **More of the real Skelta taxonomy, mined from actual product screenshots**: a new
  **Security** category (`CancelWorkflow` - really cancels the running instance from within
  the flow itself, closing out any other pending tasks, same as the manual Cancel button);
  `Logger` in Engine Activities (really writes a message into the instance's timeline - no
  external system involved, so it's live by construction, no stub/real distinction needed);
  `DatabaseActivity` (Engine Activities) and `Notification`/`SendSms` (Communication) added as
  clearly-flagged stubs, same honest pattern as `SubWorkflow`/`FileOperations`.
- **Deliberately did not add**: List Activities, Microsoft SharePoint, Report Activities, SOA
  Activities, ArchestrA Events, SAP Activities, RabbitMQ, or Logic App node types, even though
  they're all real Skelta categories - each targets a specific external system this generic
  engine has no integration point for, and stub nodes for them would be clutter with no
  functional value. Ask for any of these specifically if you actually need them.
- **Deliberately deferred `Loop` (ForEach-Loop/For-Loop)** - genuine loop-iteration is a
  meaningfully complex engine feature (needs per-instance iteration-counter state, similar to
  the Parallel Join's arrival counter), and rushing a complex feature without enough scrutiny
  is exactly how the multi-select bug above happened. Ask for it explicitly and I'll build and
  reason through it properly rather than bolt it on quickly.

- **Designer palette now matches Skelta Process Designer's own layout**: a category dropdown
  (Human Activities, Integration Activities, Engine Activities, Scheduler Activities,
  Communication, BPMN Elements) exactly like the real product's Activities panel, plus proper
  shapes - circles for Start/End, diamonds for gateways (Condition/Switch/Parallel
  Split/Join) - instead of every node being a uniform rounded rectangle. The instance Process
  Map uses the same shapes for consistency.
- **Two new real Integration Activities**: `InvokeSoapService` (Skelta's "InvokeWebService")
  really POSTs a SOAP envelope with placeholder substitution and a `SOAPAction` header, and
  `ResultVariable` on both it and `WebhookCall` lets you explicitly store a call's raw
  response under a named variable (in addition to `WebhookCall`'s existing auto-flatten
  behavior) - bind it straight onto a later Task's form field with a matching key, or read it
  from a Script node.
- **Two new stub Integration Activities** rounding out the taxonomy from the real product:
  `FileOperations` and `XmlAction` (both record their intended config but don't touch a real
  file system or XML engine yet - flagged the same way Sub-Workflow is).
- **Instances now have 3 tabs** - Pending / Completed / Canceled or Failed - and you can
  actually **cancel** a running request (the person who started it, or an admin) via a button
  on the instance detail page. Uses the `InstanceStatus.Terminated` value that existed in the
  model from day one but was never reachable until now - no migration needed.
- **My Tasks has a second tab, "My Requests"** - every instance you personally started, with
  a derived outcome (Approved / Rejected / Pending / Canceled). Approved vs Rejected is a
  heuristic since the engine only tracks Running/Completed/Terminated: a Completed instance is
  labeled Rejected if any history entry's action is literally "Rejected", otherwise Approved.
- **Three more node types in the designer palette**: `Switch` (n8n/Camunda-style n-way branch
  on a single field's value - real, no schema change), `SubWorkflow` (Camunda Call Activity -
  stub, see above), `DocumentGeneration` (Skelta document activity - stub). All origin-badged
  like the rest of the palette.
- **Arabic/English toggle across the whole app** - `core/i18n/i18n.service.ts` is a small
  runtime dictionary (not Angular's build-time i18n, which needs a separate compiled build per
  locale) so the whole UI flips instantly, including `<html dir="rtl">` for proper
  right-to-left layout. Covers the app's chrome - nav, page headers, tabs, common buttons,
  login. It does **not** auto-translate content you author yourself (workflow names/
  descriptions, form field labels, custom task outcome buttons) - that would need a
  per-flow translation model, out of scope here. The designer's deep property-panel labels
  are also still English-only; the toolbar and palette origin-notes are translated.
- **Node property enhancements mined from the actual Skelta docs**: every node now has a
  `Description`/instructions field (shown to whoever gets a FormTask/ApprovalTask, shown as a
  designer-only note on every other type); `Assignee` accepts a **comma-separated list** for
  Skelta-style multi-user work items (whoever acts on it first completes it for everyone
  else); Email nodes have an `EmailIsHtml` toggle (Skelta 2017 R2 U2 added HTML subject/body
  support); Automation nodes have a real multi-line `ScriptBody` editor.
- **Real email sending** and **real script execution** - see the two dedicated sections below.
- **A standalone portal Angular app** (`/portal-app`) - a second, separate Angular project
  (own `package.json`/`angular.json`, port 4300) with a narrower purpose than the main app:
  Submit a Request, My Tasks (approve/reject), and My Requests with a live-updating timeline
  ("follow request") and Cancel. Proof that any client can drive the engine over the same REST
  API - it shares zero code with the main app on purpose. Has its own EN/AR toggle too. See
  "Running the portal" below.

## Mobile app (iOS + Android)

`/mobile-app` is an [Ionic](https://ionicframework.com)/Angular app wrapped with
[Capacitor](https://capacitorjs.com) - one codebase, native shells for both platforms. It's
the same feature set as the portal (Submit a Request, Tasks, Requests with a live-following
timeline and Cancel), built with Ionic's native-feeling components (bottom tab bar, modals,
segments, pull-to-refresh) instead of the portal's plain web layout.

**What I built**: the complete, correct Angular/Ionic source and Capacitor config.
**What I can't do here**: produce an actual installable `.ipa` or `.apk` — that needs Xcode
(Mac-only) for iOS and Android Studio for Android, neither of which exist in my sandbox. Both
tools generate the native `ios/`/`android/` project folders themselves; I'm not fabricating
those by hand.

### First-time setup
```bash
cd mobile-app
npm install
npx cap add ios       # generates ios/ - requires a Mac with Xcode installed
npx cap add android    # generates android/ - requires Android Studio + its SDK
```

### iOS (macOS + Xcode only)
```bash
npm run cap:ios
```
Builds the Angular app, syncs it into the generated `ios/` project, and opens it in Xcode.
Pick a simulator or your connected iPhone and hit Run. First real device build needs an Apple
Developer account for code signing, same as any iOS app.

### Android (Android Studio + SDK)
```bash
npm run cap:android
```
Same idea - builds, syncs into `android/`, opens Android Studio. Run on the built-in emulator
or a connected device with USB debugging enabled.

### Pointing the app at your backend
Edit `mobile-app/src/environments/environment.ts`. A couple of gotchas specific to mobile:
- **Android emulator** can't reach your computer via `localhost` - use `http://10.0.2.2:5000/api`
  (the emulator's special alias for the host machine) instead.
- **A physical device** (either platform) needs your computer's real LAN IP, e.g.
  `http://192.168.1.50:5000/api` - and the backend needs to actually be reachable on your
  network (check your firewall), since it's no longer localhost-to-localhost.
- **iOS Simulator** can use `localhost` fine, same as a browser.

## Running the portal

```bash
cd portal-app
npm install
npm start
```
Opens on `http://localhost:4300` (the main app stays on `4200`, so both can run at once) and
talks to the same backend at `http://localhost:5000/api`. Log in with any demo account.

## Sending real email

Email nodes now really send via SMTP (`Services/EmailSender.cs`, built on .NET's own
`System.Net.Mail` - no extra NuGet package needed). Fill in the `Smtp` section of
`appsettings.json`:
```json
"Smtp": {
  "Host": "smtp.yourprovider.com",
  "Port": "587",
  "Username": "you@example.com",
  "Password": "...",
  "FromAddress": "you@example.com",
  "FromName": "WorkflowEngine",
  "EnableSsl": "true"
}
```
Leave `Host` blank (the default) and Email nodes fall back to the old stub behavior
(auto-complete via `DefaultOutcome`), so nothing breaks if you haven't set this up yet.
`{{fieldName}}` placeholders in an Email node's To/Subject/Body are substituted against the
request's collected data before sending - the seeded templates already write things like
"Hi {{employeeName}}..." that only actually resolve now that this is real.

## Script execution (Automation node)

An Automation node with a `ScriptLanguage` set actually runs the script now
(`Services/ScriptRunner.cs`) instead of just picking `DefaultOutcome`. Two languages, two very
different trust levels - **read this before enabling either for anyone other than yourself**:

- **JavaScript (recommended)** runs on [Jint](https://github.com/sebastienros/jint), a pure C#
  JS interpreter with **no** file system, network, environment variable, or process access by
  default - the script can only touch the plain data values it's handed. Effectively sandboxed.
- **C#** runs on Roslyn's scripting API with **full .NET/CLR access** - file system, network,
  everything. **This is not sandboxed.** Enabling it for a script author is equivalent to
  giving them shell access to this server. The only real guardrail already in this project:
  a workflow can't run until an **admin publishes it**
  (`WorkflowDefinitionsController.Publish` is `[Authorize(Roles = "admin")]`), so a malicious
  or buggy C# script can only ever execute in practice if an admin approved that specific
  flow. Don't remove or loosen that gate without replacing it with something else.

Both languages: read a data field with `data['fieldName']` (JS) or `Data["fieldName"]` (C#),
write one the same way, and set `outcome`/`Outcome` (a string) to choose which outgoing edge
to follow. Both run under a hard 5-second timeout so a bad script can't hang a request thread
forever; a script that throws or times out falls back to `DefaultOutcome` rather than crashing
the instance. Leave `ScriptLanguage` unset and the node stays the old harmless stub.

I haven't been able to actually execute either language's runtime in my own sandbox (no .NET
SDK there), so this is carefully reasoned through rather than empirically tested - if Jint or
Roslyn's exact interop behavior (e.g. whether `data.fieldName` dot-notation works on a wrapped
dictionary vs needing bracket notation) surprises you, let me know what you see and I'll adjust.

## ERP experience (portal + mobile)

The portal (`/portal-app`) and mobile app (`/mobile-app`) now work like a cloud ERP on top of
the workflow engine: the engine still runs every process, while the apps present the result as
business modules, documents, KPIs and an assistant. Everything is computed from the same
instance data, so a step completed on the phone changes the dashboard on the web immediately.

**End-to-end flow** - instead of `Request → Excel → Email → Approval → Excel → Finance`:

```
Request → Approval → Procurement (PO) → Warehouse (GRN) → Invoice & Payment → Accounting (GL) → Reporting
```

Every open document is placed on that lifecycle (dashboard "End-to-end process flow"), and each
document page shows a step tracker with who did what and what it is waiting on.

| Area | Portal | Mobile |
|---|---|---|
| Management dashboard - sales booked, approved spend, receivables/payables, approvals waiting, approval rate, cycle time, stock movements, 6-month sales vs spend + forecast, bottlenecks, top customers/vendors | `/dashboard` | Home tab |
| Modules - Sales, Purchasing, Inventory, Finance, HR, Operations (document register, filters, "New" per process) | `/m/:module` | Modules tab → `/m/:module` |
| Request Center - start any process, fill the first step inline with required-field validation | `/submit` | `/submit` |
| Approvals inbox - priority-sorted, module filter, document summary + tracker, read-only fields pre-filled from the document | `/tasks` | Approvals tab |
| Document view - number (PR-/SO-/ST-/FN-/HR-), amount, party, branch, tracker, audit trail, print | `/requests/:id` | `/requests/:id` |
| Reports - by module / branch / status / stage / period, CSV export (opens in Excel, UTF-8 for Arabic) | `/reports` | (dashboard figures) |
| AI assistant - approvals, sales, spend, AR/AP, stock, bottlenecks, forecast, how-to; English & Arabic | `/assistant` + floating button | Assistant tab |
| Multi-company / multi-branch switcher, multi-currency (consolidated in SAR) | top bar | Home |

How documents are classified (all in `core/erp.ts`, shared verbatim by both apps):
- **Module** - from the process name (`purchas|procure|vendor` → Purchasing, `sales|customer` → Sales, `stock|warehouse` → Inventory, `expense|payment|invoice` → Finance, `leave|employee|hire|transfer` → HR, anything else → Operations).
- **Stage** - from the step names (`Submit…` → Request, `…Approval` → Approval, `Purchase Order` → Procurement, `Goods Receipt / Ship / Stock` → Warehouse, `Invoice / Payment` → Invoice & Pay, `Journal / GL` → Accounting).
- **Amount / party / company / branch / currency** - from the data keys `amount`, `customer`/`vendor`/`employeeName`, `company`, `branch`, `currency`. Use these keys in your own forms and new processes show up in the KPIs automatically.
- Managers and functional roles (manager, finance, procurement, warehouse, sales, hr, admin…) see every document; employees see their own (`canSeeAll` in `core/erp.ts`).
- FX rates for consolidation are indicative constants (`FX_TO_BASE`) - replace with a real rate feed for production.

The assistant (`core/erp-assistant.ts`) is a deterministic, on-device intent engine - every number
it quotes comes from the live documents, so it cannot invent figures. To put an LLM behind it,
send the question plus the computed KPIs to your model endpoint and keep `answer()` as the fallback.

### New ERP process templates (backend)

`Services/SeedData.Erp.cs` seeds five published, end-to-end processes on the next API start
(idempotent - existing databases just pick them up):

| Process | Steps |
|---|---|
| Purchase Requisition (Procure-to-Pay) | Requester → Manager → Department head if amount > 10,000 → Procurement creates PO → Warehouse GRN → Finance invoice & payment → GL journal → notify requester |
| Sales Order (Order-to-Cash) | Sales order → Sales manager if discount > 10% → Warehouse pick & ship → Finance invoice & collection → revenue journal |
| Stock Transfer Request | Request → Stores approval → Dispatch & receive → inventory journal |
| Expense Claim | Claim → Manager → Finance if > 5,000 → Reimbursement → expense journal |
| Vendor Registration | Registration → Procurement review → Finance bank/VAT verification → vendor master |

New demo users (password = username + `123`): `procurement`, `warehouse`, `sales`.

**`{{initiator}}` assignee** - a node's Assignee can now be `{{initiator}}` (alone or in a
comma-separated list, e.g. `{{initiator}},procurement`); it resolves to whoever started the
instance (`WorkflowEngineService.ResolveAssignee`). The ERP templates use it so the requester
fills in the first step themselves, from any role.

### Fixes made along the way
- `angular.json` budgets used the invalid type `initialBundleSize`, which made `ng build`
  (production) fail in both apps - now `initial`.
- Mobile: Ionic is bootstrapped with `provideIonicAngular` (the standalone components weren't
  initialized by `IonicModule.forRoot`), and the Ionic core CSS is imported.
- "Rejected" status: history records the decision label (`Reject`), so rejected requests were
  shown as approved - now matched on `Reject*`.
- Approvers now see the values collected earlier (read-only fields were empty before).

## 7 languages, Admin module, SaaS workspaces, Appearance

**Languages** (portal + mobile): English, Arabic, French, Spanish, Urdu, German, Italian. Arabic and Urdu switch the whole UI to RTL. Pick from the globe button; a missing key falls back to English. Files: `core/i18n/*`.

**Admin module** (`/admin`, mobile: More > Administration): add/edit/deactivate/delete users, reset passwords, and edit per-user privileges (null = role defaults). Role presets tab shows defaults. Privileges are checked server-side from the DB on every request, so changes apply immediately; a role change needs re-login. The last admin can't be locked out.

**SaaS workspaces**: `POST /api/tenants/signup` (toggle with `Signup:Enabled` in appsettings) creates a workspace + admin user + first company/branch. Plans: starter (5 users/1 company/3 branches), business (50/5/25), enterprise (unlimited); exceeding a limit returns HTTP 402. Users, companies/branches, instances and tasks are isolated per workspace. Existing data lives in the `default` workspace. Limitation: workflow definitions are shared templates, and a new workspace must create users with roles (manager, procurement, ...) for routing to work.

**Companies & branches**: Admin > Organization (`/api/org`) lets users with `org.manage` create, edit and delete companies and branches.

**Appearance tool**: palette button in the header (mobile: More > Appearance): light/dark/auto, 8 accent colors + custom, 10 fonts, text size, density, corner radius, sidebar style. Saved per browser/device.

**Database**: new tables/columns are created automatically at startup by `Services/SchemaUpgrade.cs` (idempotent SQL). If you later add a real EF migration containing them, remove the matching statements.

**Note**: the backend changes were written without a .NET SDK available, so they have not been compiled. Run `dotnet build` first and fix any typos.

### Designer app (`frontend/`)

The workflow designer / admin app (`frontend/`) now has the same features as the portal and mobile app: the 7 languages (language picker in the sidebar and on the login page; Arabic and Urdu flip the layout, flow diagrams stay left-to-right), the Administration page (users & privileges, role presets, companies & branches, workspace), workspace sign-up on the login page, and the Appearance panel (palette button in the sidebar). The default look is the original dark theme. Texts you author yourself (workflow names, form labels) are not translated, and the designer's long help texts in `designer.component.html` are still English.

## HR module (portal-app)

A full HR area at **Human Resources** in the sidebar, modelled on Dynamics 365 HR / Oracle Fusion HCM:
Overview (headcount, hires, turnover, absence, vacancies, rating distribution, headcount by department/nationality/location/gender, payroll),
Employees, Organization (Company › Division › Department › Section › Team + positions, jobs, grades, cost centers, locations, legal entities, business units, leave types),
Leave & absence (balances, requests, approve/reject/cancel), Performance (goals/KPIs, mid-year/final reviews, calibration, rating distribution),
Recruitment (vacancies, candidate pipeline, "Hire" turns a candidate into an employee) and **My HR** (employee self-service).

**Privileges (Admin > Users & Privileges > Human Resources)** - every page and button follows them, and the API re-checks them on each request:
`hr.reports.view`, `hr.employees.view|manage|import|salary`, `hr.org.view|manage`, `hr.leave.view|approve`, `hr.performance.view|manage`, `hr.recruitment.view|manage`, `hr.self`.
Without `hr.employees.salary` salaries are removed from API responses, not just hidden.

**Adding employees**: one at a time (New employee) or in bulk (Import from Excel / CSV): drop an .xlsx/.csv, columns are auto-matched
(English or Arabic headings), adjust the mapping, preview valid/invalid rows, import in chunks. Option to update existing employees by employee no.
"Download template" gives a ready .xlsx. Required: `empNo`, `fullName`.

**Self-service** links a login to an employee by `Username` (or by e-mail) on the employee record.

Notes: run `npm install` in `portal-app` (adds `read-excel-file`, `write-excel-file`). Tables `HrEmployees` and `HrRecords` are created at startup by SchemaUpgrade.
The backend HR code could not be compiled where it was written - build it once and report any compile error. Leave approval is done in the HR pages, not by the workflow engine.

---

## Finance module (portal-app: `/finance`)

Modelled on the Dynamics 365 Finance / Oracle Fusion Financials comparison: general ledger, payables with 3-way matching, receivables with credit limits and ageing, cash & bank reconciliation, budgets vs actual, fixed assets with depreciation, project profitability, multi-company consolidation with intercompany elimination, multi-currency, tax codes, and a CFO dashboard. Every page is guarded by its own privilege (Admin > Users > Privileges > Finance):

`finance.reports.view`, `finance.gl.view/manage/approve`, `finance.ap.view/manage/approve`, `finance.ar.view/manage`, `finance.bank.view/manage`, `finance.budget.view/manage`, `finance.assets.view/manage`, `finance.projects.view/manage`, `finance.setup`, `finance.audit.view`.

Controls enforced on the **server** (`FinanceController`): balanced journals only; posting only into open periods; posted journals are immutable (reverse instead); duplicate supplier invoice (same supplier + invoice no.) rejected; 3-way match (invoice <= min(PO, received) + tolerance) before approval, with an explicit override; paid invoices are locked; accounts in use cannot be deleted; full audit trail (`/finance/audit`). Optional segregation of duties: Finance > Setup > Controls (creator cannot post/approve, approver cannot pay).

First-time setup: Finance > General ledger > Chart of accounts > "Load starter chart", then Setup > Default accounts (receivables, payables, bank, revenue, expense, VAT, depreciation) so invoices/payments can create their journal drafts. Journal drafts still need `finance.gl.approve` before they post.

Backend: new tables `FinRecords` and `FinAudits` are created by `SchemaUpgrade` on startup; new files `Models/Finance.cs`, `Controllers/FinanceController.cs`; `WorkflowDbContext.cs`, `SchemaUpgrade.cs`, `PermissionService.cs` were patched. **The backend was not compiled here (no .NET SDK in the sandbox) - build it once and tell me about any error.** Mobile app and designer were not extended with Finance.

## AI assistant: customize screens and open edit screens

Ask the assistant (any of the 7 languages), for example: "make it dark", "use teal", "bigger text", "compact tables", "round corners", "use Cairo font", "switch to French", "hide the KPI cards", "show the trend chart", "hide Operations from the menu", "undo", "reset the look". Layout choices are personal (stored in this browser) and need no privilege. To edit data: "edit employee E1003", "new journal entry", "new supplier invoice", "new budget", "new asset" - the assistant opens the screen; the screen still checks your privileges.

Reminder: run `npm install` in `portal-app` once (adds `read-excel-file` and `write-excel-file`), then `npm start`.
