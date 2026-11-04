# API used by all four desktop apps

Base URL = `<server>/api` (default `http://10.0.2.2:5000` on an Android emulator, `http://localhost:63353` elsewhere).
Every call except login sends `Authorization: Bearer <token>`. JSON is camelCase.

| Screen | Call |
|---|---|
| Login | `POST /auth/login {username,password}` -> `{token,id,username,displayName,role,permissions[],tenantId,tenantName,branches}` |
| Refresh privileges | `GET /users/me` -> `{effectivePermissions[],displayName,role}` |
| Workflow tasks | `GET /tasks` ; `POST /tasks/{id}/complete {decision,formData,comment}` |
| Documents | `GET /instances` ; `GET /instances/{id}` ; `POST /instances/{id}/cancel` |
| New request | `GET /definitions` ; `POST /instances/start {definitionId,initialData}` |
| ERP approvals | `GET /erp/gov/records/approval` ; `POST /erp/gov/approvals/{id}/{approve\|reject}` `{note}` |
| ERP records | `GET /erp/{module}/records/{kind}?take=` ; `POST` ; `PUT /{id}` ; `DELETE /{id}` |
| ERP record body | `{code,company,branch,status,ref,parent,data:{...}}` |

The module/kind list and the privileges that open them are in `catalog.json`; texts (English / Arabic) in `i18n.json`.
A screen is shown only when the user holds the `view` privilege of its kind; New/Edit/Delete need `manage`.
Arabic switches the layout to right-to-left.

## Typed forms, notes, attachments and saved filters (all four desktop apps)

**Typed request / task forms.** A task returned by `GET /tasks` may carry `instanceId` and `form: {title, fields:[{key,label,type,required,readOnly,options:[{label,value}],placeholder}]}` (types `Text, Email, Number, Date, TextArea, Select, Checkbox`). The client pre-fills the form from `GET /instances/{instanceId}` → `data`, then completes with `POST /tasks/{id}/complete {decision, formData, comment}`; `formData` holds only the non-read-only fields. Required fields are enforced on the client except for negative decisions (reject, cancel, deny, return, out of stock, write off). After `POST /instances/start` the client looks in `GET /tasks` for a task of the new instance that has a form and shows it at once (the portal's Submit screen).

**Notes and files** (the portal's chatter; the server checks module privileges):

| Call | Body / result |
|---|---|
| `GET /collab/{module}/{kind}/{id}/notes` | `[{id,author,text,system,createdAt}]` |
| `POST /collab/{module}/{kind}/{id}/notes` | `{text, system:false}` |
| `DELETE /collab/notes/{noteId}` | |
| `GET /collab/{module}/{kind}/{id}/files` | `[{id,name,size,author,createdAt}]` |
| `POST /collab/{module}/{kind}/{id}/files` | `{name,type,content:<base64>}` (4 MB limit) |
| `GET /collab/files/{fileId}` | raw bytes |
| `DELETE /collab/files/{fileId}` | |

**Saved filters:** `GET /collab/configs/filter?view=<module>:<kind>` → `[{id,name,shared,mine,data:{q,status}}]`; `POST` the same URL with `{name,shared,data}`; `DELETE /collab/configs/filter/{id}`.

## Dashboard and reports (all four desktop apps)
No new endpoints for the numbers: `GET /instances` (each with `data`, `history` and `completedAt`) and `GET /tasks` are enough. A workflow instance becomes an ERP document by `data.docType` (or the workflow name), its stage comes from the last entered node (`dashboard.json` -> `nodeStage`, then `stageKeywords`), its module from the doc type (or `moduleKeywords`). KPIs, trend, stage counts, turnaround and top parties are computed client-side (see `bi.py`, `Bi.cpp`, `Bi.java`, `Bi.cs`).
Saved report layouts use the existing store: `GET|POST /collab/configs/report?view=<module>:<kind>` and `DELETE /collab/configs/report/{id}`; the layout is `{title, subtitle, header, footer, orientation, columns[], groupBy, totals, showDate, showUser, rowNumbers}`.

## Point of sale (all four desktop apps)
Everything is under `/api/pos`, checked on the server against the user's `pos.*` privileges:

* `GET records/{product|category|customer|promotion|register|setting|stock|shift|sale}?take=&from=` - lists (a `setting` row with code `pos` holds taxRate, pricesIncludeTax, pointValue, requireShift, allowNegativeStock, maxDiscountPct, receiptHeader/Footer).
* `POST sales/checkout` `{ lines:[{sku,qty,discountPct}], payments:[{method,amount}], customer?, register?, discountPct, redeemPoints, localId }` -> the sale record (`data.lines/total/change/earned`). A repeated `localId` returns the same sale.
* `POST sales/{id}/return` `{ lines:[{sku,qty}], method, reason }`, `POST sales/{id}/void`.
* `GET shifts/current` (null when none), `POST shifts/open` `{ register?, openingCash }`, `POST shifts/{id}/cash` `{ type: in|out, amount, reason }`, `POST shifts/{id}/close` `{ countedCash, note }`.

## Calendar and meetings (all four desktop apps)
`GET calendar/events?from=&to=` (ISO UTC; repeating events come back expanded with `occurrence: true`), `GET calendar/todos`, `GET calendar/people`, `POST calendar/events` and `PUT calendar/events/{id}` with `{kind: event|meeting|todo, title, start, end, notes, location, attendees[], guests[], repeat: none|daily|weekly|monthly, repeatUntil, remindMinutes, priority}` (answer `{ev, emailed}`), `DELETE calendar/events/{id}`, `POST calendar/events/{id}/done` (to-do toggle), `POST .../rsvp {response: accepted|maybe|declined}`, `POST .../join` (`{url, room, domain, title}`; meetings only), `GET .../ics` (raw `text/calendar`), `POST calendar/freebusy {users[], from, to}` (answer `{user: [{s, e}]}`), `POST calendar/meetings/instant {title, attendees[]}` (answer `{ev, url}`), `GET|PUT calendar/settings {jitsiDomain, workStart, workEnd}`.

## Hospital (all four desktop apps)
Every screen is described in `hospital.json`: a list of `sections`, each with `kind` (the record type behind `GET /api/hospital/records/{kind}?q=&status=&ref=&take=`), `columns` (`p` = dotted path into the record), optional `search`, `day` (filters `ref`, the appointment date) and `status` filter, an optional `create` and a list of `actions`.

An action runs against one selected row. Its target is one of: `get` (show the answer), `post` / `put` (a path, with `{id}`, `{code}`, `{parent}` filled from the row), `record: "create" | "update"` (`POST` / `PUT records/{kind}` with `{data}`; update merges the new values into the row's data), or `toggle` (flips `status` between two values). `when` limits the action to rows with those statuses, `confirm` asks first, `warn` means a `409` with `warnings` is shown and the call is repeated with `overrideReason`.

Fields: `k` is the key in the body (dots nest: `vitals.sys`; `items[].drug` builds a one-item list; `tests[]` builds a list of one value; fields with the same `join` are joined with `T`, e.g. date + time = `start`), `t` is `text`, `num`, `date`, `time`, `area`, `check`, `select` (static `opts` or `src` = another record kind) or `dx` (diagnoses, one per line `CODE | name`); `from` pre-fills from the row, `def` is a default (`$today` = today). Static `body` values may be `{path}` from the row, `$today`, or `@Status` (true when the row has that status).

Besides the records: `GET dashboard?today=&tz=`, `GET patients/{code}/file`, `POST visits`, `PUT visits/{id}`, `POST visits/{id}/close|prescriptions|labs|services`, `POST appointments`, `POST appointments/{id}/status`, `POST labrequests/{id}/result`, `POST prescriptions/{id}/dispense|cancel`, `POST drugs/{id}/stock`, `POST admissions`, `POST admissions/{id}/transfer|discharge`, `POST invoices/{id}/pay`.

## Assistant (chatbot)

`POST /api/assistant/chat` — needs the `assistant.use` privilege.

Request: `{ "message": "show purchase orders", "lang": "en" | "ar", "history": [{ "from": "user" | "ai", "text": "..." }] }` (history is optional, the last 6 turns).

Response: `{ "reply": "text (may contain line breaks)", "actions": [{ "label": "Purchase orders", "module": "proc", "kind": "po", "id": "optional record id" }], "suggestions": ["What is waiting for me?", "..."], "source": "rules" | "llm" }`.

The server answers only from what the signed-in user may see (the same privileges and branch limits as the screens). An action opens the list `module/kind` (`gov/approval` opens the Approvals screen). Without the `assistant.use` privilege the call returns 403.

## Workflow designer (all four desktop apps, the Ionic mobile app and the portal)

Spec shared by every client: `workflow.json` (22 node types with colour / icon / shape / category, the per-type property schema, form field types, default edge labels, node sizes, privileges). Each desktop app renders the property panel from it, so a new node property is added in one place.

| Screen | Call | Privilege |
|---|---|---|
| Flows list | `GET /definitions` | `wf.view` |
| Open | `GET /definitions/{id}` -> `{id,name,description,isPublished,version,nodes[],edges[]}` | `wf.view` |
| Save | `POST /definitions` or `PUT /definitions/{id}` with `{name,description,nodes,edges}` | `wf.design` |
| Publish | `POST /definitions/{id}/publish` (needs exactly one Start and at least one End) | `wf.publish` |
| Delete | `DELETE /definitions/{id}` | `wf.design` |
| Assignee picker | `GET /users` | |
| Condition tester | `POST /definitions/test-condition {expression,data}` -> `{result,clauses[{clause,result}]}` | |
| Run | `POST /instances/start {definitionId}` | `wf.instances.view` |
| Monitor | `GET /instances` ; `GET /instances/{id}` (poll every 3 s while Running) ; `GET /instances/{id}/activity-log` ; `POST /instances/{id}/cancel` | `wf.instances.view` |

Node: `{id,type,name,x,y,description,assignee("a,b"),priority,escalateAfterMinutes,escalationMode,useBusinessHours,escalateTo,timeoutDecision,form{id,title,fields[{id,key,label,type,required,readOnly,options[{label,value}]}]},conditionExpression,switchField,durationSeconds,email*,webhook*,soap*,scriptLanguage,scriptBody,defaultOutcome,...}`; edge: `{id,sourceNodeId,targetNodeId,label}`. Approval tasks show one button per outgoing edge label; a Condition's edges are `True` / `False`; a Switch matches the edge label to the field value (`Default` catches the rest).
