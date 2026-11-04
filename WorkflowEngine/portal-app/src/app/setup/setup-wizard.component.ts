import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { OrgService } from '../core/org.service';
import { PortalApiService } from '../core/portal-api.service';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';
import { AdminModulesComponent } from '../admin/admin-modules.component';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent } from '../shared/ui';
import { CURRENCIES, Company } from '../core/erp.config';
import { AdminUser, PermissionCatalog } from '../core/models';

/** First-run setup (like Odoo's onboarding): company -> branches -> team -> done. */
@Component({
  selector: 'app-setup-wizard',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent, AdminModulesComponent],
  template: `
    <div class="wiz">
      <h2>{{ 'setup.title' | translate }}</h2>
      <p class="dim">{{ 'setup.sub' | translate }}</p>
      <div class="steps">
        <span *ngFor="let s of stepKeys; let i = index" [class.on]="step() === i" [class.done]="step() > i"><b>{{ i + 1 }}</b>{{ s | translate }}</span>
      </div>
      <p class="err" *ngIf="error">{{ error }}</p>

      <!-- 1 company -->
      <section class="card pad" *ngIf="step() === 0 && co">
        <div class="grid">
          <div class="full"><label class="lbl">{{ 'signup.company' | translate }}</label><input [(ngModel)]="co.name" /></div>
          <div><label class="lbl">{{ 'org.nameAr' | translate }}</label><input [(ngModel)]="co.nameAr" dir="rtl" /></div>
          <div><label class="lbl">{{ 'signup.currency' | translate }}</label>
            <select [(ngModel)]="co.currency"><option *ngFor="let c of currencies" [value]="c">{{ c }}</option></select></div>
          <div><label class="lbl">{{ 'setup.country' | translate }}</label><input [(ngModel)]="co.country" /></div>
          <div><label class="lbl">{{ 'setup.taxNo' | translate }}</label><input [(ngModel)]="co.taxNo" /></div>
        </div>
        <p class="hint">{{ 'setup.oneCompany' | translate }}</p>
      </section>

      <!-- 2 branches -->
      <section class="card pad" *ngIf="step() === 1">
        <div class="row" *ngFor="let b of org.branches()">
          <app-icon name="building" [size]="16"></app-icon>
          <strong>{{ b.name }}</strong><span class="mono dim">{{ b.code }}</span><span class="dim" *ngIf="b.city">· {{ b.city }}</span>
          <span class="spacer"></span>
          <button class="ghost sm danger-i" (click)="delBranch(b.code)" [disabled]="org.branches().length < 2"><app-icon name="trash" [size]="14"></app-icon></button>
        </div>
        <div class="add">
          <input [(ngModel)]="brName" [placeholder]="'setup.branchName' | translate" (keyup.enter)="addBranch()" />
          <input [(ngModel)]="brCity" [placeholder]="'org.city' | translate" (keyup.enter)="addBranch()" />
          <button class="primary" (click)="addBranch()" [disabled]="!brName.trim()"><app-icon name="plus" [size]="14"></app-icon>{{ 'org.addBranch' | translate }}</button>
        </div>
      </section>

      <!-- 3 team -->
      <section class="card pad" *ngIf="step() === 2">
        <p class="dim">{{ 'setup.teamHint' | translate }}</p>
        <div class="row" *ngFor="let u of invited()">
          <app-icon name="user" [size]="16"></app-icon><strong>{{ u.displayName }}</strong><span class="chip">{{ u.role }}</span>
          <span class="dim">{{ u.branches?.length ? u.branches!.join(', ') : ('invite.allBranches' | translate) }}</span>
          <span class="spacer"></span>
          <button class="sm" (click)="copy(u)">{{ (copiedId === u.id ? 'invite.copied' : 'invite.copy') | translate }}</button>
        </div>
        <div class="grid">
          <div><label class="lbl">{{ 'admin.displayName' | translate }}</label><input [(ngModel)]="nu.displayName" /></div>
          <div><label class="lbl">{{ 'admin.email' | translate }}</label><input type="email" [(ngModel)]="nu.email" /></div>
          <div><label class="lbl">{{ 'admin.username' | translate }}</label><input [(ngModel)]="nu.username" /></div>
          <div><label class="lbl">{{ 'admin.role' | translate }}</label>
            <select [(ngModel)]="nu.role"><option *ngFor="let r of roles()" [value]="r">{{ r }}</option></select></div>
        </div>
        <label class="lbl">{{ 'invite.branchAccess' | translate }}</label>
        <div class="brs">
          <label class="chip pick" *ngFor="let b of org.branches()"><input type="checkbox" [checked]="nu.branches.includes(b.code)" (change)="toggle(b.code)" /> {{ b.name }}</label>
        </div>
        <button class="primary" (click)="invite()" [disabled]="busy || !nu.displayName.trim() || !nu.username.trim()"><app-icon name="mail" [size]="14"></app-icon>{{ 'setup.invite' | translate }}</button>
      </section>

      <!-- 4 done -->
      <section class="card pad done" *ngIf="step() === 3">
        <app-icon name="check" [size]="28"></app-icon>
        <h3>{{ 'setup.ready' | translate }}</h3>
        <p class="dim">{{ 'setup.readyHint' | translate }}</p>
        <h4>{{ 'mods.tab' | translate }}</h4>
        <app-admin-modules></app-admin-modules>
      </section>

      <div class="nav">
        <button (click)="back()" *ngIf="step() > 0">{{ 'setup.back' | translate }}</button>
        <span class="spacer"></span>
        <button class="ghost" *ngIf="step() === 2" (click)="step.set(3)">{{ 'setup.skip' | translate }}</button>
        <button class="primary" (click)="next()" [disabled]="busy">{{ (step() === 3 ? 'setup.finish' : 'setup.next') | translate }}</button>
      </div>
    </div>
  `,
  styles: [`
    .wiz { max-width: 760px; margin: 0 auto; padding: 8px 0 40px; }
    .steps { display: flex; gap: 14px; margin: 18px 0; flex-wrap: wrap; }
    .steps span { display: inline-flex; align-items: center; gap: 6px; color: var(--muted, #888); font-size: 13px; }
    .steps b { display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--line, #ddd); font-size: 12px; }
    .steps .on { color: inherit; font-weight: 650; } .steps .on b, .steps .done b { background: var(--brand, #4f46e5); color: #fff; }
    .pad { padding: 18px; } .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; } .full { grid-column: 1 / -1; }
    .row { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--line, #eee); flex-wrap: wrap; }
    .add { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; } .add input { flex: 1; min-width: 140px; }
    .brs { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0 14px; } .pick { display: inline-flex; gap: 6px; align-items: center; cursor: pointer; }
    .nav { display: flex; gap: 8px; margin-top: 18px; } .spacer { flex: 1; }
    .err { color: #b91c1c; } .hint { color: var(--muted, #888); font-size: 12px; margin: 0; }
    .done { text-align: center; } .done h3 { margin: 8px 0 4px; }
    @media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
  `]
})
export class SetupWizardComponent implements OnInit {
  stepKeys = ['setup.s1', 'setup.s2', 'setup.s3', 'setup.s4'];
  step = signal(0);
  currencies = CURRENCIES;
  co: Company | null = null;
  brName = ''; brCity = '';
  catalog = signal<PermissionCatalog | null>(null);
  roles = computed(() => (this.catalog()?.roles ?? []).filter(r => r !== 'admin'));
  invited = signal<(AdminUser & { link?: string })[]>([]);
  nu = { displayName: '', email: '', username: '', role: 'employee', branches: [] as string[] };
  busy = false; error = ''; copiedId = '';

  constructor(public org: OrgService, private api: PortalApiService, private auth: AuthService, private i18n: I18nService, private router: Router) {}

  ngOnInit() {
    this.org.load().subscribe(() => { const c = this.org.companies()[0]; if (c) this.co = { ...c }; });
    this.api.getPermissionCatalog().subscribe(c => { this.catalog.set(c); const r = c.roles.filter(x => x !== 'admin'); if (r.length && !r.includes(this.nu.role)) this.nu.role = r[0]; });
  }

  private fail(e: any) { this.busy = false; this.error = typeof e?.error === 'string' && e.error ? e.error : this.i18n.t('common.error'); }

  back() { this.error = ''; this.step.set(this.step() - 1); }
  next() {
    this.error = '';
    if (this.step() === 0) {
      if (!this.co || !this.co.name.trim()) { this.error = this.i18n.t('signup.fill'); return; }
      this.busy = true;
      this.org.saveCompany(this.co, false).subscribe({ next: () => { this.busy = false; this.step.set(1); }, error: e => this.fail(e) });
    } else if (this.step() < 3) this.step.set(this.step() + 1);
    else {
      this.busy = true;
      this.org.completeSetup().subscribe({ next: () => { this.busy = false; this.router.navigate(['/dashboard']); }, error: e => this.fail(e) });
    }
  }

  addBranch() {
    const co = this.org.companies()[0];
    if (!co || !this.brName.trim()) return;
    const n = this.org.branches().length + 1;
    const code = ('BR' + String(n).padStart(2, '0') + '-' + Math.random().toString(36).slice(2, 5)).toUpperCase();
    this.org.saveBranch({ code, company: co.code, name: this.brName.trim(), nameAr: '', warehouse: '', city: this.brCity.trim() }, true)
      .subscribe({ next: () => { this.brName = ''; this.brCity = ''; }, error: e => this.fail(e) });
  }
  delBranch(code: string) { this.org.removeBranch(code).subscribe({ error: e => this.fail(e) }); }

  toggle(c: string) { const b = this.nu.branches; this.nu.branches = b.includes(c) ? b.filter(x => x !== c) : [...b, c]; }
  invite() {
    this.busy = true; this.error = '';
    this.api.adminCreateUser({ username: this.nu.username.trim(), displayName: this.nu.displayName.trim(), email: this.nu.email.trim(), role: this.nu.role,
      isActive: true, permissions: null, branches: this.nu.branches.length ? this.nu.branches : null, invite: true, appUrl: location.origin }).subscribe({
      next: u => {
        this.busy = false;
        const link = u.inviteToken ? `${location.origin}/accept-invite?token=${encodeURIComponent(u.inviteToken)}` : undefined;
        this.invited.set([...this.invited(), { ...u, link }]);
        this.nu = { displayName: '', email: '', username: '', role: this.nu.role, branches: [] };
      }, error: e => this.fail(e) });
  }
  copy(u: AdminUser & { link?: string }) { if (u.link) navigator.clipboard?.writeText(u.link).then(() => this.copiedId = u.id).catch(() => {}); }
}
