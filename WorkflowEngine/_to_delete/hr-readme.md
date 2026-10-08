
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
