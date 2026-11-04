# 100-user load and feature test

Run 173282 against http://127.0.0.1:5055. 1 workspaces x 20 users = 20 users. Duration 0 s. 1 HTTP calls (13.2/s).

**0 pass / 1 fail / 0 manual** of 1 step results. Server errors (HTTP 5xx or no answer): **1**.

## Phases

| Phase | Seconds |
| --- | --- |
| 1 create workspaces | 0.1 |
| 2 create and sign in users | 0.0 |
| 3 setup per workspace | 0.0 |
| 4 0 users work at the same time | 0.0 |
| 5 permission probes (each user against every other module) | 0.0 |
| 6 contention: 20 parallel creates per workspace (unique codes) | 0.0 |
| 7 isolation between workspaces | 0.0 |
| 8 plan limit (Starter = 25 users) | 0.0 |

## Results by user type and step

Each cell is passes / runs across the workspaces (every workspace runs every user type once).

### admin - Workspace administrator  (modules: admin, org, workflow, bpm, integration, bi, rbac, billing)

| Step | Result | Title | p95 ms | First failure |
| --- | --- | --- | --- | --- |

### finance-gl - General ledger accountant  (modules: finance)

| Step | Result | Title | p95 ms | First failure |
| --- | --- | --- | --- | --- |

### finance-ar - Receivables clerk  (modules: finance)

| Step | Result | Title | p95 ms | First failure |
| --- | --- | --- | --- | --- |

### finance-ap - Payables clerk  (modules: finance)

| Step | Result | Title | p95 ms | First failure |
| --- | --- | --- | --- | --- |

### finance-bank-assets-epm - Treasury, assets and planning accountant  (modules: finance, epm)

| Step | Result | Title | p95 ms | First failure |
| --- | --- | --- | --- | --- |

### procurement - Procurement officer  (modules: proc)

| Step | Result | Title | p95 ms | First failure |
| --- | --- | --- | --- | --- |

### warehouse - Warehouse and stores keeper  (modules: wh, inventory, items)

| Step | Result | Title | p95 ms | First failure |
| --- | --- | --- | --- | --- |

### mfg-scm - Production and supply-chain planner  (modules: mfg, scm)

| Step | Result | Title | p95 ms | First failure |
| --- | --- | --- | --- | --- |

### crm - CRM account manager  (modules: crm)

| Step | Result | Title | p95 ms | First failure |
| --- | --- | --- | --- | --- |

### sales-marketing - Sales and marketing executive  (modules: sales, mkt, cus)

| Step | Result | Title | p95 ms | First failure |
| --- | --- | --- | --- | --- |

### pos-cashier-manager - POS cashier and manager  (modules: pos)

| Step | Result | Title | p95 ms | First failure |
| --- | --- | --- | --- | --- |

### website-manager - Website manager  (modules: web)

| Step | Result | Title | p95 ms | First failure |
| --- | --- | --- | --- | --- |

### projects-manager - Project manager  (modules: prj)

| Step | Result | Title | p95 ms | First failure |
| --- | --- | --- | --- | --- |

### hospital-clinical - Hospital doctor (clinical)  (modules: hos)

| Step | Result | Title | p95 ms | First failure |
| --- | --- | --- | --- | --- |

### hospital-pharmacy-ward-billing - Hospital pharmacy, ward and billing desk  (modules: hos)

| Step | Result | Title | p95 ms | First failure |
| --- | --- | --- | --- | --- |

### hr-officer - HR officer  (modules: hr)

| Step | Result | Title | p95 ms | First failure |
| --- | --- | --- | --- | --- |

### payroll-officer - Payroll officer  (modules: pay)

| Step | Result | Title | p95 ms | First failure |
| --- | --- | --- | --- | --- |

### assets-maintenance - Asset and maintenance engineer  (modules: ast)

| Step | Result | Title | p95 ms | First failure |
| --- | --- | --- | --- | --- |

### collab-calendar-muslim - Collaboration, calendar and Muslim tools  (modules: cal, collab, tasks, mus)

| Step | Result | Title | p95 ms | First failure |
| --- | --- | --- | --- | --- |

### custom-modules - Custom module designer  (modules: cus)

| Step | Result | Title | p95 ms | First failure |
| --- | --- | --- | --- | --- |

## Slowest endpoints (p95)

| Endpoint | Calls | p50 ms | p95 ms | max ms | 5xx |
| --- | --- | --- | --- | --- | --- |
| POST /api/tenants/signup | 1 | 73 | 73 | 73 | 1 |

All calls: p50 73 ms, p95 73 ms, p99 73 ms, max 73 ms.

## Server errors (5xx / no answer)

| Endpoint | Status | Count | Example |
| --- | --- | --- | --- |
| POST /api/tenants/signup | 0 | 1 | fetch failed |
