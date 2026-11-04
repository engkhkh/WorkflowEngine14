# 100-user test: how a user type (profile) is written

`node load100.js` creates 5 workspaces. Each has 20 users: user 0 is the workspace admin (profile p01), users 1..19 get
profiles p02..p20 (in file order). So **every workspace runs every user type exactly once**, all 100 users at the same time.

## File contract: `load/pNN-name.js`
```js
module.exports = {
  id: 'finance-ar',                 // short id used in the report
  title: 'Receivables clerk',
  modules: ['finance'],             // modules this job covers (for the coverage table)
  role: 'finance',                  // a key of roleDefaults (admin, finance, procurement, sales, doctor, employee ...) else 'employee'
  perms: ['finance.*', 'cal.*'],    // extra privileges; 'x.*' expands via the catalog. Role defaults are added automatically.
  probe: { path: '/api/finance/records/journal', perm: 'finance.view' },   // a GET that needs `perm` (used by the "refused without privilege" check). Omit if none.
  async setup(ws) {},               // OPTIONAL. Runs once per workspace BEFORE the 100 users start, as ws.admin, in profile order.
  async run(u) {},                  // the job of this user. Runs at the same time as all other users.
};
```
## What `run(u)` gets
- `u.c` signed-in Client (`get/post/put/del/call`, returns `{ok,status,data,text}`); `u.ws` workspace: `ws.admin` (full-rights client), `ws.company`, `ws.branch.{RYD,JED,DMM}`, `ws.today` (yyyy-mm-dd), `ws.shared` (plain object for data made in `setup`), `ws.i` (1..5)
- `u.key` unique per user (`W3U07`) - put it in EVERY code/name you create (`CUS-${u.key}`) because 100 users share the server and codes must not collide; `u.tag` numeric tag; `u.state` scratch object; `u.perms` effective privileges
- `await u.step('F-01', 'what it proves', async () => { ... return 'short note'; })` - a thrown error is a FAIL with that message. Use `must, ok, eq, refused` from `../lib`.
- `u.manual(id, title, why)` for browser-only checks.
## Rules
1. A user type must NOT depend on another user type's data. Make your own master data (customers, items...) inside run(), or in `setup(ws)` when it is shared and must exist once (chart of accounts, fiscal year). Another profile's `setup` runs before you in file order only.
2. Use only endpoints that exist in `backend-real/Controllers/*.cs` and request shapes that the proven steps in `u1.js..u5.js` use (those steps passed against the real server). Never invent a route or field. When you add something not covered by u1..u5, read the controller first.
3. Cover EVERY feature of your modules: create, update, status changes, every action endpoint, summary/overview endpoint, list of every kind, validation failures that must be refused, and one numeric check that proves a calculation (totals, VAT, balances, stock).
4. 10 to 25 steps per user type. One step = one business fact. Keep each step independent enough that a later step still runs when an earlier one failed (use `u.state`, check with `ok(u.state.x, 'depends on F-01')`).
5. No sleeps over 2 s. No dialogs. Node 18, no dependencies.
