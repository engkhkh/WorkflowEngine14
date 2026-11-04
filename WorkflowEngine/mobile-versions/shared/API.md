# API used by all four mobile apps

Base URL = `<server>/api` (default `http://10.0.2.2:5000` on an Android emulator, `http://localhost:5000` elsewhere).
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

## Assistant (chatbot)

`POST /api/assistant/chat` — needs the `assistant.use` privilege.

Request: `{ "message": "show purchase orders", "lang": "en" | "ar", "history": [{ "from": "user" | "ai", "text": "..." }] }` (history is optional, the last 6 turns).

Response: `{ "reply": "text (may contain line breaks)", "actions": [{ "label": "Purchase orders", "module": "proc", "kind": "po", "id": "optional record id" }], "suggestions": ["What is waiting for me?", "..."], "source": "rules" | "llm" }`.

The server answers only from what the signed-in user may see (the same privileges and branch limits as the screens). An action opens the list `module/kind` (`gov/approval` opens the Approvals screen). Without the `assistant.use` privilege the call returns 403.
