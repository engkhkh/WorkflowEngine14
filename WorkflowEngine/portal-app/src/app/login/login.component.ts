import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';
import { ErpDataService } from '../core/erp-data.service';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent } from '../shared/ui';
import { LangPickerComponent } from '../shared/lang-picker.component';
import { CURRENCIES } from '../core/erp.config';
import { MODULES } from '../core/erp.config';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent, LangPickerComponent],
  template: `
    <div class="page">
      <aside class="hero">
        <div class="brand"><div class="logo">W</div><div><strong>{{ 'brand' | translate }}</strong><span>{{ 'brand.tag' | translate }}</span></div></div>
        <h1>{{ 'login.sub' | translate }}</h1>
        <ul>
          <li><app-icon name="grid"></app-icon>{{ 'login.hero1' | translate }}</li>
          <li><app-icon name="bar-chart"></app-icon>{{ 'login.hero2' | translate }}</li>
          <li><app-icon name="sparkles"></app-icon>{{ 'login.hero3' | translate }}</li>
        </ul>
        <div class="mods">
          <span *ngFor="let m of modules" [style.border-color]="m.color + '66'"><i [style.background]="m.color"></i>{{ ('module.' + m.key) | translate }}</span>
        </div>
        <div class="flow">Request → Approval → Purchase → Inventory → Accounting → Reporting</div>
      </aside>

      <main class="side">
        <app-lang-picker class="lang"></app-lang-picker>
        <form class="form" (ngSubmit)="submit()" *ngIf="!signupMode">
          <h2>{{ 'login.submit' | translate }}</h2>
          <label class="lbl">{{ 'login.username' | translate }}</label>
          <input [(ngModel)]="username" name="username" autocomplete="username" />
          <label class="lbl">{{ 'login.password' | translate }}</label>
          <input [(ngModel)]="password" name="password" type="password" autocomplete="current-password" />
          <p class="error" *ngIf="error">{{ error }}</p>
          <button class="primary go" type="submit" [disabled]="loading">{{ (loading ? 'login.submitting' : 'login.submit') | translate }}</button>

          <div class="demo">
            <p>{{ 'login.demo' | translate }}</p>
            <div class="chips">
              <button type="button" class="sm" *ngFor="let u of demoUsers" (click)="fill(u)">{{ u }}</button>
            </div>
          </div>
          <button type="button" class="link" (click)="signupMode = true; error = ''">{{ 'signup.noAccount' | translate }}</button>
        </form>

        <form class="form" (ngSubmit)="doSignup()" *ngIf="signupMode">
          <h2>{{ 'signup.title' | translate }}</h2>
          <p class="sub">{{ 'signup.sub' | translate }}</p>
          <label class="lbl">{{ 'signup.company' | translate }}</label>
          <input [(ngModel)]="su.workspaceName" name="ws" />
          <div class="two">
            <div><label class="lbl">{{ 'signup.branch' | translate }}</label><input [(ngModel)]="su.branchName" name="branch" /></div>
            <div><label class="lbl">{{ 'signup.currency' | translate }}</label>
              <select [(ngModel)]="su.currency" name="cur"><option *ngFor="let c of currencies" [value]="c">{{ c }}</option></select></div>
          </div>
          <label class="lbl">{{ 'signup.name' | translate }}</label>
          <input [(ngModel)]="su.displayName" name="dn" autocomplete="name" />
          <label class="lbl">{{ 'signup.email' | translate }}</label>
          <input [(ngModel)]="su.email" name="em" type="email" autocomplete="email" />
          <div class="two">
            <div><label class="lbl">{{ 'signup.username' | translate }}</label><input [(ngModel)]="su.username" name="un" autocomplete="username" /></div>
            <div><label class="lbl">{{ 'signup.password' | translate }}</label><input [(ngModel)]="su.password" name="pw" type="password" autocomplete="new-password" /></div>
          </div>
          <p class="error" *ngIf="error">{{ error }}</p>
          <button class="primary go" type="submit" [disabled]="loading">{{ (loading ? 'signup.submitting' : 'signup.submit') | translate }}</button>
          <button type="button" class="link" (click)="signupMode = false; error = ''">{{ 'signup.haveAccount' | translate }}</button>
        </form>
      </main>
    </div>
  `,
  styles: [`
    .page { display: grid; grid-template-columns: 1.1fr 1fr; min-height: 100vh; }
    .hero { background: radial-gradient(1200px 600px at 10% 0%, #312e81 0%, #0f1a33 55%, #0b1226 100%); color: #dfe5f5; padding: 48px 56px; display: flex; flex-direction: column; gap: 26px; justify-content: center; }
    .brand { display: flex; gap: 12px; align-items: center; }
    .brand strong { display: block; color: #fff; font-size: 16px; }
    .brand span { font-size: 12px; color: #93a0c3; }
    .logo { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; font-weight: 800; color: #fff; font-size: 20px; background: linear-gradient(135deg, #6366f1, #8b5cf6 50%, #0ea5a4); box-shadow: 0 8px 24px rgba(99,102,241,.5); }
    h1 { font-size: 32px; line-height: 1.25; color: #fff; max-width: 520px; font-weight: 700; }
    ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 14px; font-size: 15px; }
    li { display: flex; gap: 12px; align-items: center; }
    li app-icon { color: #a5b4fc; }
    .mods { display: flex; flex-wrap: wrap; gap: 8px; }
    .mods span { display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; border: 1px solid; border-radius: 999px; padding: 5px 12px; background: rgba(255,255,255,.04); }
    .mods i { width: 7px; height: 7px; border-radius: 50%; }
    .flow { font-size: 12px; color: #93a0c3; letter-spacing: .02em; direction: ltr; }
    .side { position: relative; display: grid; place-items: center; padding: 40px 24px; background: var(--bg); }
    .lang { position: absolute; top: 20px; inset-inline-end: 20px; }
    .form { width: min(380px, 100%); background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 32px; box-shadow: var(--shadow); display: flex; flex-direction: column; }
    h2 { font-size: 22px; margin-bottom: 18px; }
    .lbl { margin-top: 12px; }
    .sub { margin: -8px 0 4px; color: var(--text-dim); font-size: 12.5px; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .link { margin-top: 16px; border: none; background: transparent; color: var(--primary); font-weight: 600; justify-content: center; }
    .error { color: var(--bad); font-size: 12.5px; margin: 10px 0 0; }
    .go { margin-top: 20px; padding: 11px; }
    .demo { margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--border); font-size: 12px; color: var(--text-dim); }
    .demo p { margin: 0 0 8px; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chips button { font-weight: 500; font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11.5px; }
    @media (max-width: 900px) { .page { grid-template-columns: 1fr; } .hero { padding: 32px 24px; } h1 { font-size: 24px; } }
  `]
})
export class LoginComponent {
  modules = MODULES;
  demoUsers = ['employee', 'manager', 'senior-manager', 'procurement', 'admin-stores', 'finance', 'sales', 'hr', 'admin'];
  signupMode = false;
  currencies = CURRENCIES;
  su = { workspaceName: '', branchName: '', displayName: '', email: '', username: '', password: '', currency: 'SAR' };
  username = '';
  password = '';
  error = '';
  loading = false;

  constructor(private auth: AuthService, private router: Router, public i18n: I18nService, private data: ErpDataService) {}

  doSignup() {
    const s = this.su;
    if (!s.workspaceName.trim() || !s.displayName.trim() || !s.username.trim() || s.password.length < 6) { this.error = this.i18n.t('signup.fill'); return; }
    this.loading = true;
    this.error = '';
    this.auth.signup({ ...s, workspaceName: s.workspaceName.trim(), username: s.username.trim() }).subscribe({
      next: () => { this.loading = false; this.data.loadedOnce.set(false); this.router.navigate(['/dashboard']); },
      error: e => { this.loading = false; this.error = e.status === 409 ? this.i18n.t('signup.taken') : this.i18n.t('signup.error'); }
    });
  }

  fill(u: string) { this.username = u; this.password = u + '123'; }

  submit() {
    if (!this.username || !this.password) { this.error = this.i18n.t('login.error'); return; }
    this.loading = true;
    this.error = '';
    this.auth.login(this.username, this.password).subscribe({
      next: () => { this.loading = false; this.data.loadedOnce.set(false); this.router.navigate(['/dashboard']); },
      error: () => { this.loading = false; this.error = this.i18n.t('login.error'); }
    });
  }
}
