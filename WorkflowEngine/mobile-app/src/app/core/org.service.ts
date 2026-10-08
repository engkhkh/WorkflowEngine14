import { Injectable, computed, signal } from '@angular/core';
import { Observable, catchError, of, tap } from 'rxjs';
import { PortalApiService } from './portal-api.service';
import { BRANCHES, COMPANIES, Branch, Company, WAREHOUSES } from './erp.config';
import { Tenant } from './models';

/**
 * The signed-in workspace's companies and branches. Starts with the built-in defaults so screens are never empty,
 * then load() replaces them with the workspace's own list (GET /api/org).
 */
@Injectable({ providedIn: 'root' })
export class OrgService {
  companies = signal<Company[]>(COMPANIES);
  branches = signal<Branch[]>(BRANCHES);
  tenant = signal<Tenant | null>(null);
  loaded = signal(false);

  /** warehouses = every branch's warehouse (+ the demo ones until real branches exist) */
  warehouses = computed(() => {
    const own = this.branches().map(b => b.warehouse).filter(Boolean);
    return Array.from(new Set(own.length ? own : WAREHOUSES));
  });

  constructor(private api: PortalApiService) {}

  load(): Observable<unknown> {
    return this.api.getOrg().pipe(
      tap(o => {
        if (o.companies.length) this.companies.set(o.companies);
        this.branches.set(o.branches);
        this.tenant.set(o.tenant);
        this.loaded.set(true);
      }),
      catchError(() => { this.loaded.set(true); return of(null); })
    );
  }

  reset() { this.companies.set(COMPANIES); this.branches.set(BRANCHES); this.tenant.set(null); this.loaded.set(false); }

  company(code: string | undefined): Company | undefined { return this.companies().find(c => c.code === code); }
  branch(code: string | undefined): Branch | undefined { return this.branches().find(b => b.code === code); }
  branchesOf(company: string): Branch[] { return this.branches().filter(b => b.company === company); }

  // ---- mutations: call the API, then update the local lists (and the usage counters) ----
  saveCompany(c: Company, isNew: boolean, originalCode = c.code): Observable<Company> {
    return (isNew ? this.api.createCompany(c) : this.api.updateCompany(originalCode, c)).pipe(
      tap(saved => {
        this.companies.set(isNew ? [...this.companies(), saved] : this.companies().map(x => x.code === originalCode ? saved : x));
        this.bump();
      }));
  }

  removeCompany(code: string): Observable<void> {
    return this.api.deleteCompany(code).pipe(tap(() => {
      this.companies.set(this.companies().filter(c => c.code !== code));
      this.branches.set(this.branches().filter(b => b.company !== code));
      this.bump();
    }));
  }

  saveBranch(b: Branch, isNew: boolean, originalCode = b.code): Observable<Branch> {
    return (isNew ? this.api.createBranch(b) : this.api.updateBranch(originalCode, b)).pipe(
      tap(saved => {
        this.branches.set(isNew ? [...this.branches(), saved] : this.branches().map(x => x.code === originalCode ? saved : x));
        this.bump();
      }));
  }

  removeBranch(code: string): Observable<void> {
    return this.api.deleteBranch(code).pipe(tap(() => { this.branches.set(this.branches().filter(b => b.code !== code)); this.bump(); }));
  }

  private bump() {
    const t = this.tenant();
    if (t) this.tenant.set({ ...t, companies: this.companies().length, branches: this.branches().length });
  }
}
