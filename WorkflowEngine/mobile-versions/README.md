# Workflow ERP - four mobile versions

| Folder | Stack | Status here |
|---|---|---|
| `ionic-capacitor` | Ionic 8 + Angular 17 + Capacitor 6 | the full app (builds clean) |
| `react-native` | Expo 51 / React Native 0.74, TypeScript | type-checks clean |
| `flutter` | Flutter 3 / Dart 3 | written, not compiled (no Flutter SDK in the build sandbox) |
| `dotnet-maui` | .NET 8 MAUI (C# UI, no XAML) | written, not compiled (no .NET SDK in the build sandbox) |

The three native versions have the same scope: sign in (server address, username, password), home with counts, approvals
(workflow tasks and ERP approvals), my documents (list, history, cancel, start a new request), a generic ERP browser
(every module and record type the user may see: search, open, create, edit, delete) and settings (English / Arabic with
right-to-left, sign out). They call the same backend as the Ionic app. `shared/` holds the common contract:
`API.md`, `catalog.json` (modules, record types, privileges) and `i18n.json` (texts).

Not in the three native versions (the Ionic app has them): HR, POS, Finance screens, workflow forms with typed fields,
ZATCA invoices, charts. Starting a request sends no form fields, so a service that requires fields will refuse it.

## Chatbot

Every app has an **Assistant** tab/page. It talks to one server brain, `POST /api/assistant/chat` (see `shared/API.md`): what is waiting for me, count/list any record type, find a record by number (PO-0001), lots near expiry, the CRM pipeline, recent changes, a summary. It only answers from what the signed-in user may see. Set the environment variable `ANTHROPIC_API_KEY` on the server to let it answer free-form questions it has no rule for (the model gets no company data in that mode). `tools/mock_server.py` has a small version of the endpoint for trying the apps without the real backend.
