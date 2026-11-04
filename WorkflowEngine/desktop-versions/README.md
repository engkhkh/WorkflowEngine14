# Workflow ERP - four desktop versions

| Folder | Stack | Status here |
|---|---|---|
| `python-pyside6` | Python 3 + PySide6 (Qt) | runs; driven headless against the fake API (sign-in, tables, edit, create, approve) |
| `java-swing` | Java 17+ Swing, no dependencies | compiles with `javac`; opened headless in a virtual display against the fake API |
| `cpp-qt` | C++17 + Qt 6 Widgets, CMake | builds; headless smoke test (`-DWF_SMOKE_TEST=ON`) passes against the fake API |
| `csharp-wpf` | C# / .NET 8 WPF, UI built in code | written, not compiled (no .NET SDK in the build sandbox) |

All four have the same scope and look: a dark left menu (Home, Approvals, Documents, ERP, Settings) and a page on the right.
Sign in with the server address, username and password. Home shows counts; Approvals handles workflow tasks and ERP approvals;
Documents lists requests (history, cancel, start a new one); ERP is a module tree with a searchable table and a record editor
(create, edit, delete; numbers and yes/no keep their type); Settings switches English / Arabic (right-to-left) and signs out.
They call the same backend API as the web app (`shared/API.md`); `shared/catalog.json` lists the modules, record types and privileges,
`shared/i18n.json` the texts.

`tools/mock_server.py` is a small fake of the API (`python3 tools/mock_server.py 5055`, login admin / admin) for trying any of them
without the real backend.

Still only in the web app: drag-and-drop page design for the website builder, picture upload, per-user privilege editing, the e-invoice QR drawing, month grid and reminder pop-ups in the calendar, supplier-invoice approve / hold / pay, and consolidation reports.
Starting a request sends no form fields, so a service that requires fields will refuse it.

## Chatbot

Every app has an **Assistant** tab/page. It talks to one server brain, `POST /api/assistant/chat` (see `shared/API.md`): what is waiting for me, count/list any record type, find a record by number (PO-0001), lots near expiry, the CRM pipeline, recent changes, a summary. It only answers from what the signed-in user may see. Set the environment variable `ANTHROPIC_API_KEY` on the server to let it answer free-form questions it has no rule for (the model gets no company data in that mode). `tools/mock_server.py` has a small version of the endpoint for trying the apps without the real backend.

## Running without a command line (Windows)

| Folder | Double-click | What it does |
|---|---|---|
| `java-swing` | `run.bat` | Starts the ready-built `workflow-erp.jar` (needs Java 17+). |
| `csharp-wpf` | `build-exe.bat` once, then `run.bat` | Makes `dist\WorkflowErp.exe` (self-contained; needs the .NET 8 SDK only for the build). |
| `python-pyside6` | `run.bat` (or `build-exe.bat` for an .exe) | First run installs PySide6 into a private `.venv`. |
| `cpp-qt` | `build-exe.bat` | Builds and packs `dist\workflow-erp.exe` with windeployqt (set `QT_DIR` first). |

## Modules in the desktop apps

The ERP page now lists the same data modules as the portal: Procurement, Supply chain, Warehouse, Manufacturing, Projects, CRM, Assets, Payroll, Real estate, Archive, EPM, BPM, Governance, Integrations, BI, **Finance, HR (with employees), Point of sale and Hospital** (19 modules, 132 record types). Each user still sees only the types their privileges allow. List, search, create, edit and delete work for every type; types the server computes (POS sales and shifts, hospital visits, prescriptions, invoices, payslips, logs) are shown read-only.

Everything in the portal now exists in the desktop apps as well; see the sections below for each module.

## Setup & administration (new)

Module **Setup & administration** in the ERP page (for users with the Admin / Organisation privileges): **Users** (create, edit, activate/deactivate, change role, set a new password, delete), **Roles & privileges** (create a role copied from another one, edit its privilege list), **Companies** and **Branches**. A new record starts with the usual fields filled in (for a user: displayName, email, role, password; the Code is the login name). To reset a password, type it into `newPassword` and save.

## Test user with data in every module

`seed\run-seed.bat` (backend running, Node 18+). Then sign in with `ldemow1u00` / `Test@12345`. See `seed\README.md`.

## Workflow designer
Every desktop app has a **Workflow designer** entry in the left menu: flows list (new / open / run / delete), the designer (palette of 22 step types in 7 categories, drag to move, *Link steps* to connect, property panel per step type, task form builder, condition tester, save / publish / run) and the instance monitor (live process map, timeline, collected data, activity log, cancel). The step types and their properties come from `shared/workflow.json`. It needs the `wf.view`, `wf.design`, `wf.publish` and `wf.instances.view` privileges (the same ones the portal uses).

## Setup programs (installers)
Each version has `build-installer.bat` (double-click). It builds the app if needed and creates a normal Windows setup program in `desktop-versions\installers\`:
`WorkflowERP-WPF-Setup.exe`, `WorkflowERP-Python-Setup.exe`, `WorkflowERP-Qt-Setup.exe`, `WorkflowERP-Java-Setup.exe`.
Run the setup like any program: Next, Install, tick "Start Workflow ERP now" - the ERP window opens, and the app is in the Start menu (and on the desktop if ticked) with an uninstaller. It installs for the current user, no administrator needed. Java's setup bundles its own runtime, so the PC does not need Java.
To make the setup the build PC needs the same tools as `build-exe.bat` (.NET 8 SDK / Python 3 / Qt 6 + CMake / JDK 17+ for jpackage) plus Inno Setup 6 (the script installs it with winget if missing). The finished Setup.exe runs on any Windows 10/11 PC with nothing else installed.

## Typed forms, notes, attachments and saved filters

All four apps now match the portal here:

- **Workflow task forms** - a task with a form shows typed fields (text, email, number, date, text area, drop-down, check box), pre-filled from the document's data; required fields are checked before an approving decision (not for Reject / Cancel). Starting a document whose first step is a form opens that form straight away.
- **Record screens** - opening a record shows a *Data* tab and a *Notes / Attachments* tab: add and delete notes, attach files up to 4 MB, download and delete them.
- **ERP lists** - a status drop-down next to the search box and **saved filters** (search text + status; the bookmark button saves the current filter, optionally shared with the workspace; the bin deletes your own). They use the same store as the portal.

## Dashboard, Reports and the report designer (new)

The first tab is now the same dashboard as the portal, and a new **Reports** tab sits after Documents. Both are computed on the desktop from `GET /instances` and `GET /tasks`, exactly like the portal does it, so the figures agree:

- **Dashboard** - six KPI tiles (sales and purchases this month with pipeline and committed spend, receivables, payables with expenses, my approvals, average cycle time with open documents and reject rate), the six-stage business flow (Request, Approval, Purchase, Inventory, Accounting, Reporting; click a stage to list the documents sitting there), the six-month sales-versus-purchases chart, open documents by module, my approval queue and recent activity.
- **Reports & Analytics** - by module and by branch (count, in progress, completed, rejected, average days, value), where documents are waiting, approval turnaround per step (red above 24 hours), top customers and top vendors, and **Export CSV**.
- **Report designer** - the printer button on the Reports tab and on every module list. Choose and reorder the columns, title, subtitle, header and footer text, orientation, grouping, totals, row numbers, print date and "printed by"; see the live preview; print it or save it as PDF (Python and Qt: a PDF button; Java and WPF: the system print dialog, choose "Microsoft Print to PDF"; both also save an HTML copy). Layouts can be saved per list and shared with the workspace - the same `collab/configs/report` store the portal and the Ionic mobile app use, so a layout saved on one appears on all.

The stage and module mapping (`dashboard.json`) is shared by all four apps. The mock server now creates 36 sample documents (purchase, sales, transfer, payment and expense) so the dashboard has something to show. The Ionic mobile app already had these screens.

## Point of sale: till, shifts, sales and receipts (new)
A **POS** page (after Muslim in the side list) is in all four desktop apps and matches the portal's `/pos/terminal`, `/pos/shifts` and `/pos/sales`:

* **Till** - scan a barcode or search, tap a product tile (stock left, promotion badge), basket with +/-/remove, line discount and order discount (capped by the POS setting), customer with loyalty points and standing discount, hold and recall baskets, payment by cash / card / other with quick amounts, point redemption, change, then a receipt you can print. If the server cannot be reached the sale is saved on the computer, a provisional receipt is shown and the sale is sent again from the *Send now* button (the server ignores a repeated `localId`).
* **Shifts** - open a shift with a float (and register), cash in / out, close with a counted amount (shows expected, variance and the finance journal), and the shift history.
* **Sales** - find a receipt, reprint it, return items (`pos.refund`) or void a sale of the open shift (`pos.void`).

The basket is priced with the same rules as the portal (`pos.calc.ts`) and the server's figures are the ones that count. Products, customers, promotions, registers and stock lists stay in the ERP page (catalog `pos`). The Java and WPF apps print through the system print dialog (choose "Microsoft Print to PDF" for a PDF); Python and Qt use Qt's print dialog. Test it with `tools/mock_server.py` (it has a small catalogue, a promotion, a customer with points and the checkout / return / void / shift endpoints).

## Calendar and meetings (new)
A **Calendar** page (after Hospital in the side list) is in all four desktop apps and uses the same `/api/calendar` as the portal. Times are shown in the computer's own time zone; the server keeps UTC.

* **Agenda** - a list for the day, week (Monday first) or month with previous / today / next. Repeating events (daily, weekly, monthly) appear once per occurrence, marked ↻.
* **New / open** - event, meeting or to-do with start and end (`2026-11-03 14:30`), location, notes, repeat and repeat-until, reminder minutes, priority, attendees picked from the workspace's people and outside guests by e-mail. *Check availability* shows each person as free or busy around the chosen time (blocks only, never titles). Only the owner (or a user with `cal.settings`) can change or delete an item.
* **Meetings** - *Join* opens the meeting room link in the browser, *Copy link* copies it, *Instant meeting* creates and opens one now, *Save .ics* downloads the invitation file. Invited people answer *Accept / Maybe / Decline*.
* **To-dos** - add with due date and priority, mark done or reopen, delete.
* **Settings** (needs `cal.settings`) - meeting server (Jitsi domain) and the work-day hours.

Not in the desktop apps: the in-app video room (the browser opens the meeting link instead), reminder pop-ups and a month grid (the month is shown as an agenda list).

## Finance: reports and bank reconciliation (new)
A **Finance** page (after Calendar in the side list) is in all four desktop apps. A drop-down picks the report; reports you have no `finance.*` privilege for are hidden. They are described by `shared/finance.json` and calculated from the same finance records as the portal (a port of `fin.calc.ts`):

| Report | Privilege | Notes |
|---|---|---|
| Overview | `finance.reports.view` | the server's `/finance/summary` figures (revenue, expenses, cash, receivables / payables, budget, assets, projects) |
| Trial balance, Income statement, Balance sheet | `finance.gl.view` | posted journals only; From / To dates and a company filter; "Create standard accounts" button with `finance.setup` |
| Receivables / Payables aging | `finance.ar.view` / `finance.ap.view` | buckets current, 1-30, 31-60, 61-90, 90+ per customer or supplier |
| Budget vs actual, Project results | `finance.budget.view` / `finance.projects.view` | |
| Fixed assets | `finance.assets.view` | cost, accumulated depreciation, book value, monthly depreciation, months left |
| Bank | `finance.bank.view` | statement lines with opening / reconciled balance; select a line and press Reconcile / Undo (`finance.bank.manage`); the Company box filters by bank account here |
| Audit trail | `finance.audit.view` | |

Records (accounts, journals, invoices, vendors, customers ...) are still edited on the ERP page. Depreciation, journals from invoices, the 3-way match, period closing and the ZATCA e-invoice are on the Actions page. Not included: consolidation and the finance setup screens (defaults, controls; edit them as records on the ERP page).

## HR: reports and employee import (new)
An **HR** page (after Finance in the side list) is in all four desktop apps. A drop-down picks the report; reports you have no privilege for are hidden. They are described by `shared/hr.json`:

| Report | Privilege | Notes |
|---|---|---|
| Overview | `hr.reports.view` | the server's `/hr/summary` figures |
| Employees | `hr.employees.view` | the Salary column needs `hr.employees.salary`; **Import from Excel** needs `hr.employees.import` |
| Leave requests | `hr.leave.view` | Approve / Reject (pending only) with `hr.leave.approve` |
| Leave balances | `hr.leave.view` | entitlement, used this year, remaining per leave type |
| Recruitment | `hr.recruitment.view` | candidates by stage; Next / Previous stage with `hr.recruitment.manage` |
| Performance | `hr.performance.view` | reviews with average rating and distribution |
| Organization | `hr.org.view` | units with head count |

**Excel / CSV import.** Choose an .xlsx or .csv file (no extra library needed). Columns are matched to employee fields by heading (English or Arabic); change any column with its drop-down, tick or untick "first row is header". Each row is checked (required fields, dates read day-first, numbers, status, gender, e-mail, duplicate employee numbers) and the first 50 are previewed with their problems. Valid rows go to the server in chunks of 200 (up to 5000 rows); the result shows added, updated, skipped and failed rows with the server's reasons. "Template" saves a sample CSV.

Hiring is described below. Employees, goals and organization units are edited as records on the ERP page. Not included: self-service.

## Operations: planning, costing, project billing and VAT (new)
An **Operations** page (after HR in the side list) is in all four desktop apps. A drop-down picks the view; views you have no privilege for are hidden. They are described by `shared/ops.json`:

| View | Privilege | Notes |
|---|---|---|
| Material planning (MRP) | `mfg.view` | add what must be produced (product, quantity, due date); the plan explodes every bill of materials, nets it against stock and open work orders, and marks each item Make / Buy / Covered. **Create work orders** (needs `mfg.orders.manage`) makes a Planned work order for every Make line; **Export purchase list** saves the Buy lines as CSV |
| Standard cost | `mfg.view` | material, labor (routing minutes x work-centre rate), overhead (the `defaults` setting, 15% if none) and cost per unit for each bill of materials |
| Work order variance | `mfg.view` | completed work orders: actual cost, standard cost and the variance |
| Project billing | `prj.view` | amount ready to bill per project (approved billable time and open billable costs for time-and-material, achieved milestones otherwise) and amount billed; **Create invoice** asks for date, payment terms and tax % and drafts the customer invoice in Finance |
| VAT return | `gov.vat.view` or `finance.reports.view` | From / To dates; sales and purchases by category and by tax code, output / input / net VAT, e-invoiced count, warnings for lines without a tax code; **Export CSV** |
| ZATCA seller profile | `gov.zatca.manage`, `finance.setup` or `finance.view` | seller name (English / Arabic), VAT number (15 digits), commercial registration, address; saving needs `gov.zatca.manage` or `finance.setup` |

The calculations are a port of the portal's `erp.calc.ts`; the work order, invoice and VAT rules stay on the server. Bills of materials, routings, work centres, timesheets and project costs are edited as records on the ERP page; work-order actions and the ZATCA e-invoice are on the Actions page.

## Website builder and custom modules (new)
Two pages after Operations in all four desktop apps (**Website** and **Custom**).

**Website** (`web.view`): a drop-down switches between *Sites* and *Orders and messages* (needs `web.orders.manage`).
* *New site* asks for a name, a template (shop, business, blank) and a currency, creates it and opens the editor (`web.edit`).
* The **editor** has three tabs. *Pages*: add / rename / delete pages and, for the chosen page, add (14 block types: navigation, hero, text, image, features, products, gallery, testimonials, FAQ, call to action, contact form, embed, spacer, footer), edit, duplicate, move and delete blocks; list-type fields (features, FAQ, gallery, footer links) open a small list editor. *Details*: colours, font, corner radius, dark mode, language, direction, title, description. *Shop*: shop on/off, currency, products, and **Sync from POS** (imports the point-of-sale products).
* **Preview** renders the page to a temporary html file and opens it in your browser; **Download** saves the html. **Publish** (`web.publish`) uploads the page with the public order and message addresses, so the shop checkout and contact form reach the server; **Unpublish** takes it offline.
* *Orders and messages*: set an order or message to new / confirmed / shipped / done / cancelled.

The blocks, templates, styles and the shop script come from `shared/website.json`. The html each app produces is **byte-for-byte the same** as the portal designer's output (checked for the three templates in Python, Qt and Java; the WPF renderer is a hand port that has not been compiled or run).

**Custom** (`cus.view`): pick a custom module, search and open its records; *New* adds one, double-click edits (`cus.manage`). Users with `cus.design` can create a module (name in English / Arabic, icon, colour and fields of type text, long text, number, date, list, tick box, e-mail, phone), edit or delete it. The forms and the table columns are generated from the module definition (`shared/custom.json` holds the field types and icons); validation stays on the server.

Not included: drag-and-drop canvas and live visual preview inside the app (use Preview), uploading pictures (paste an image address), site-level domain settings.

## Hiring candidates and printing hospital invoices (new)
- **HR > Recruitment** now has **Hire as employee** and **Reject** next to the stage buttons (`hr.recruitment.manage`). *Hire* works on a candidate in the **Offer** stage: it opens a form prefilled from the candidate and the vacancy (position, unit, location, grade, hire date today); enter the employee number, press *Hire* and the employee is created with status Probation and the candidate becomes **Hired**. *Reject* moves a candidate to Rejected.
- **Hospital > Billing** has a **Print** button: it opens a printable invoice page in your browser (items, tax, insurance share, payments, balance) and the print dialog.

Hospital setup records (departments, doctors, wards, beds, services, lab tests, drugs) and HR goals / org units are edited as records on the ERP page; the portal's day-and-hours picker for doctors is not in the desktop forms.

## Actions: work orders, accounting periods, depreciation (new)
An **Actions** page (after Admin in the side list) is in all four desktop apps; each tab shows only if you hold its privilege.

| Tab | Privilege | What it does |
|---|---|---|
| Work orders | `mfg.view` | the orders with status and cost; **Release** / **Cancel** (`mfg.orders.manage`), **Start** / **Complete** (`mfg.orders.execute`); *Complete* asks for good quantity, scrap, hours and a note and shows each component needed against the stock; **Create work order** from a bill of materials (copies its components, routing and work centre) |
| Accounting periods | `finance.gl.view` | the periods; **Close** / **Reopen** and **Generate the year** (adds the missing months) need `finance.gl.approve` |
| Depreciation run | `finance.assets.view` | choose a month; lists the assets with depreciation due up to it (straight line or declining balance, stops at salvage). **Run** (`finance.assets.manage` + `finance.gl.manage`) creates one *Draft* journal `DEPR-yyyy-mm` (debit depreciation expense, credit accumulated depreciation, from the finance default accounts) and updates each asset; the journal still needs approval in the portal |

| Invoices | `finance.ar.view` | switch between customer and supplier invoices. **Post to ledger** (`finance.gl.manage`) creates the draft journal with the portal's rules (customer: debit receivables, credit revenue and VAT output; supplier: debit expense and VAT input, credit payables; accounts from the finance default accounts) and stores its number on the invoice. Supplier invoices show the **3-way match** (invoice total against the smaller of the PO and received amount, with the tolerance from the finance controls). **E-invoice (ZATCA)** on an issued customer invoice shows the UUID, counter and hash chain, **issues** it and saves the XML |

Bills of materials, routings, timesheets, journals, employees and goals are edited as records on the ERP page. Not included: drawing the e-invoice QR code (the QR text is shown), supplier-invoice approve / hold / pay.

## Administration: setup wizard, invitations, billing, modules (new)
An **Admin** page (after Custom in the side list) is in all four desktop apps. Its tabs appear according to your privileges:

| Tab | Privilege | What it does |
|---|---|---|
| Workspace plan and usage | everyone | workspace name and id, plan, users / companies / branches used against the plan limits; a reminder while the first-run setup is not finished |
| Setup wizard | `org.manage` | four steps like the portal: **company** (name, Arabic name, currency, country, tax number), **branches** (add / delete), **team** (invite people: name, e-mail, login, role, branch access; each gets an invitation link to copy) and **finish** (module switches, then *Finish* marks the setup done) |
| Invitations | `admin.users` | everyone with their state (invited / active), **Resend invitation**, **Copy link**, and a form to invite another person. The person opens the link in a browser (`/accept-invite?token=...`) and chooses a password |
| Billing | `org.manage` | users, price per user, estimate, balance; usage by branch; the monthly invoices. **Pay** opens the payment provider's page in your browser (with no provider connected the server runs in test mode and **Mark as paid (test mode)** settles it); **Check payment** asks the server after you return; **Print invoice** saves an html invoice and opens it |
| Modules | `org.manage` | tick the modules the company uses; users only get privileges of switched-on modules |

The users, roles, companies and branches lists are still edited on the ERP page (*Setup & administration*). Not included: the public invitation page itself (it is a web page), editing a user's individual privileges from here.

## Hospital: clinical screens (new)
A **Hospital** page (after POS in the side list) is in all four desktop apps. It has ten tabs, shown only when the user has the matching `hos.*` privilege:

* **Overview** - patients, open visits, admitted, pending lab and prescriptions, today's appointments, bed occupancy, money collected and outstanding, low-stock drugs.
* **Patients** - search, new patient, edit, *Patient file* (history of visits and prescriptions), *Start visit* for a walk-in.
* **Appointments** - pick a day, book (patient, doctor, date, time), *Check in* (opens a visit), *Complete*, *Cancel*. The server refuses a doctor who is already booked at that time.
* **Visits** - *Record exam* (complaint, vitals, diagnoses one per line as `CODE | name`, SOAP notes), *Prescribe*, *Order lab test*, *Add service*, *Admit to ward*, *Close visit*. A prescription that triggers a safety warning (for example an allergy) shows the warnings and needs a written reason to go ahead.
* **Laboratory** - enter or amend a result. **Pharmacy** - dispense (optionally partial) or cancel a prescription. **Drug stock** - receive or remove stock with batch and expiry.
* **Wards and beds** - admit a patient to a free bed, put a bed in or out of maintenance. **Admissions** - transfer or discharge with an outcome.
* **Billing** - invoice details and taking a payment.

All four apps read the same description of these screens, `data/hospital.json` (copy in `shared/`), so a change to a field or an action is made once. The clinical rules (conflicts, allergies, stock, beds, billing) stay on the server, as in the portal.

## Quran text pages: rose and blue page colours (new)
In the Quran reader, when *Aa* (text pages) is on, a 🎨 button switches the Madinah text pages between the original **rose** frame and a **blue** frame (blue band, diamond ornaments, blue surah banners and verse medallions; the words stay black with Allah / Rabb in red). The choice is saved (`mtheme`) in the portal, the Ionic mobile app and all four desktop apps. These are our own drawn pages from the Amiri Quran font; we do not copy scanned pages of printed Qurans (third-party scans such as the Scribd "Blue Page" upload carry their own copyright). To use page images instead, press *Aa* off and set the image source folder / URL below the reader.

## Muslim (prayer times and the Holy Quran)

Every desktop app has a **Muslim** entry in the left menu, the same as the portal's Muslim module: prayer times for today and the whole month (21 calculation methods, Shafi'i / Hanafi Asr, far-north rule, per-prayer fine-tuning), a countdown to the next prayer, Hijri date, Qibla compass and distance, spoken-style reminders ("Fajr in 10 minutes"), and the **Holy Quran as Madinah Mushaf page images** (604 pages) with surah and juz jump, one or two-page spread, zoom, night mode, bookmarks, full screen and the arrow keys. The prayer engine is a port of the portal's `prayer-times.ts` and gives the same minutes (checked on 168 cases per app); the places, methods and Mushaf page tables come from `shared/muslim.json`. Settings are stored on the computer. The page images come from the *Image source* box (default: the same CDN the portal uses); the pages you read are cached on disk, and you can point the box at a local folder holding `001.png` ... `604.png` to read offline.
**Text pages (Madinah layout).** The *Aa* button in the Quran toolbar switches the reader from page images to pages drawn as text, laid out exactly like the printed Madinah Mushaf: facing pages, an ornate frame, the surah and juz in the header, surah banners, the basmala, 15 justified lines per page, verse medallions, and the words Allah and Rabb in red. They are drawn from `shared/mushaf-text.json` (the 604-page line layout) with the Amiri Quran font (SIL Open Font License, `OFL.txt`), so they work offline, zoom without blurring and follow night mode. Not included: the printed margin column of word meanings (no licensed data for it) and the hizb marks.

**Tap a word (text pages).** Click any word to open a panel with its meaning and transliteration, the English translation of its verse, and the tafsir (Al-Muyassar in Arabic, Ibn Kathir in English). `shared/mushaf-index.json` maps every word of the text pages to its surah, verse and word number; the explanations come live from the public Quran.com API, so this part needs internet (the text pages themselves still work offline). The word meaning is shown only when Quran.com splits the verse into the same number of words as the page; otherwise the panel still shows the translation and tafsir. To use another server, set the environment variable `QURAN_API` (portal and mobile apps: `localStorage.quranApi`).

Notes: the Qt app uses the civil Islamic calendar for the Hijri date, which can differ from Umm al-Qura by a day (use *Hijri date adjustment*); the Python app needs `hijridate` and `tzdata` (in `requirements.txt`).
