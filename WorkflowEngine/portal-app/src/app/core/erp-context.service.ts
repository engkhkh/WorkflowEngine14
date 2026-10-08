import { Injectable, effect, signal, computed } from '@angular/core';
import { Branch, Company } from './erp.config';
import { OrgService } from './org.service';
import { AppearanceService } from './appearance.service';

const KEY = 'portal_erp_ctx';

/** Selected company / branch (from the workspace's own list) + sidebar state, persisted per browser. */
@Injectable({ providedIn: 'root' })
export class ErpContextService {
  company = signal<string>('MAIN');
  branch = signal<string>('ALL'); // 'ALL' = consolidated view across the company's branches
  sidebarCollapsed = signal(false);

  /** light/dark actually in effect (the Appearance panel owns the setting) */
  theme = computed(() => this.look.effective());

  companyObj = computed<Company>(() => this.org.companies().find(c => c.code === this.company()) ?? this.org.companies()[0]);
  branches = computed<Branch[]>(() => this.org.branches().filter(b => b.company === this.companyObj().code));
  branchObj = computed<Branch | undefined>(() => this.org.branches().find(b => b.code === this.branch()));

  constructor(private org: OrgService, private look: AppearanceService) {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s.company) this.company.set(s.company);
        if (s.branch) this.branch.set(s.branch);
        if (typeof s.sidebarCollapsed === 'boolean') this.sidebarCollapsed.set(s.sidebarCollapsed);
      }
    } catch { /* storage unavailable - defaults are fine */ }

    // If the saved company/branch no longer exists (removed, or another workspace), fall back to the first one.
    effect(() => {
      const cs = this.org.companies();
      if (cs.length && !cs.some(c => c.code === this.company())) this.company.set(cs[0].code);
      const b = this.branch();
      if (b !== 'ALL' && !this.org.branches().some(x => x.code === b && x.company === this.company())) this.branch.set('ALL');
    }, { allowSignalWrites: true });

    effect(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify({ company: this.company(), branch: this.branch(), sidebarCollapsed: this.sidebarCollapsed() }));
      } catch { /* ignore */ }
    });
  }

  setCompany(code: string) {
    this.company.set(code);
    this.branch.set('ALL');
  }

  /** Branch to stamp on a new document: the selected one, or the company's first branch. */
  defaultBranch(): Branch {
    return this.branchObj() ?? this.branches()[0] ?? this.org.branches()[0]
      ?? { code: '', company: this.companyObj().code, name: '', nameAr: '', warehouse: '' };
  }

  toggleTheme() { this.look.setMode(this.theme() === 'light' ? 'dark' : 'light'); }
}
