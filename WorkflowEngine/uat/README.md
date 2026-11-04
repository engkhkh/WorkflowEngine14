# ERP UAT runner

Plays the five-user scenario (Khalid, Noura, Faisal, Reem, Sara) against your real backend through its REST API, with real data and the expected figures from the "ERP UAT Scenarios" document.

## Run

1. Start the backend (`dotnet run` in `backend\WorkflowEngine.Api`). Use a **test database**: the run creates a new workspace and a lot of records.
2. In a terminal (Node 18 or newer):

```
cd uat
set API=http://localhost:63353
node run.js
```

PowerShell: `$env:API="http://localhost:63353"; node run.js`

3. It prints PASS / FAIL / MANUAL per step and writes `uat-report.md` and `uat-report.json` in the same folder. Send me `uat-report.md`.

Takes about 2 to 3 minutes (the "deactivated user" check waits up to 80 seconds because the server caches account status for 20 seconds).

## Options

- `UAT_RUN=abc` fixed suffix for usernames (default: random 5 digits, so the run can be repeated).
- `UAT_PASSWORD=...` password for the five users (default `Test@12345`).
- `node run.js --day=3` runs one day only (needs the earlier days in the same run).

## Files

- `u0.js` workspace, branches, five users with privileges. `u1.js` to `u5.js` one file per user. `*.notes.md` list where the real system differs from the document, and what could not be verified without a server.
- MANUAL steps are browser-only checks (layout, Arabic/RTL, audio, offline). Do them by hand from the document.

## 100-user test
`node load100.js` (5 workspaces x 20 users, every user a different job, all at once). Options: `--ws=1` (quick, 20 users), `--conc=30`, `--only=p06,p07`.
Needs the backend with the fix2 files. Report: `load-report.md`. See `load/README.md` for how user types are written.
