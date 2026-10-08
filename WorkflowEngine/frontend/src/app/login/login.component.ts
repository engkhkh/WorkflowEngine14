import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../core/services/auth.service';
import { I18nService } from '../core/i18n/i18n.service';
import { TranslatePipe } from '../core/i18n/translate.pipe';
import { LangPickerComponent } from '../shared/lang-picker.component';
import { OrgService } from '../core/org.service';
import { CURRENCIES } from '../core/erp.config';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, LangPickerComponent],
  template: `
    <div class="login-page" [class.rtl]="i18n.isRtl">
      <app-lang-picker class="lang-toggle"></app-lang-picker>
      <form class="login-card" (ngSubmit)="submit()" *ngIf="!signupMode">
        <div class="brand">⚡ {{ 'brand.name' | translate }}</div>
        <p class="sub">{{ 'login.title' | translate }}</p>

        <label class="field-label">{{ 'login.username' | translate }}</label>
        <input [(ngModel)]="username" name="username" autocomplete="username" />

        <label class="field-label">{{ 'login.password' | translate }}</label>
        <input [(ngModel)]="password" name="password" type="password" autocomplete="current-password" />

        <p class="error" *ngIf="error">{{ error }}</p>

        <button class="primary" type="submit" [disabled]="loading">
          {{ loading ? ('login.submitting' | translate) : ('login.submit' | translate) }}
        </button>

        <div class="demo-accounts">
          <p>{{ 'login.demoAccounts' | translate }}</p>
          <code>employee / employee123</code>
          <code>manager / manager123</code>
          <code>hr / hr123</code>
          <code>senior-manager / senior-manager123</code>
          <code>admin / admin123</code>
        </div>
        <button type="button" class="link" (click)="signupMode = true; error = ''">{{ 'signup.noAccount' | translate }}</button>
      </form>

      <form class="login-card wide" (ngSubmit)="doSignup()" *ngIf="signupMode">
        <div class="brand">⚡ {{ 'brand.name' | translate }}</div>
        <p class="sub">{{ 'signup.sub' | translate }}</p>
        <label class="field-label">{{ 'signup.company' | translate }}</label>
        <input [(ngModel)]="su.workspaceName" name="ws" />
        <div class="two">
          <div><label class="field-label">{{ 'signup.branch' | translate }}</label><input [(ngModel)]="su.branchName" name="br" /></div>
          <div><label class="field-label">{{ 'signup.currency' | translate }}</label>
            <select [(ngModel)]="su.currency" name="cur"><option *ngFor="let c of currencies" [value]="c">{{ c }}</option></select></div>
        </div>
        <label class="field-label">{{ 'signup.name' | translate }}</label>
        <input [(ngModel)]="su.displayName" name="dn" />
        <label class="field-label">{{ 'signup.email' | translate }}</label>
        <input [(ngModel)]="su.email" name="em" type="email" />
        <div class="two">
          <div><label class="field-label">{{ 'signup.username' | translate }}</label><input [(ngModel)]="su.username" name="un" autocapitalize="off" /></div>
          <div><label class="field-label">{{ 'signup.password' | translate }}</label><input [(ngModel)]="su.password" name="pw" type="password" autocomplete="new-password" /></div>
        </div>
        <p class="error" *ngIf="error">{{ error }}</p>
        <button class="primary" type="submit" [disabled]="loading">{{ (loading ? 'signup.submitting' : 'signup.submit') | translate }}</button>
        <button type="button" class="link" (click)="signupMode = false; error = ''">{{ 'signup.haveAccount' | translate }}</button>
      </form>
    </div>
  `,
  styles: [`
    .login-page { display: flex; align-items: center; justify-content: center; min-height: calc(100vh / var(--ui-zoom, 1)); padding: 24px 0; background: var(--bg); position: relative; }
    .lang-toggle { position: absolute; top: 20px; inset-inline-end: 20px; }
    .login-card.wide { width: 380px; max-width: calc(100vw - 32px); }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .link { margin-top: 12px; background: none; border: none; color: var(--accent); font-size: 12px; }
    .login-card { width: 320px; background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 28px; display: flex; flex-direction: column; }
    .brand { font-weight: 700; font-size: 16px; text-align: center; }
    .sub { color: var(--text-dim); font-size: 12px; text-align: center; margin: 4px 0 20px; }
    .field-label { font-size: 11px; color: var(--text-dim); margin: 10px 0 4px; }
    .error { color: var(--red); font-size: 12px; margin: 10px 0 0; }
    button.primary { margin-top: 18px; padding: 9px; }
    .demo-accounts { margin-top: 22px; padding-top: 16px; border-top: 1px solid var(--border); font-size: 11px; color: var(--text-dim); display: flex; flex-direction: column; gap: 3px; }
    .demo-accounts code { background: var(--panel-2); padding: 2px 6px; border-radius: 4px; direction: ltr; display: inline-block; }
  `]
})
export class LoginComponent {
  signupMode = false;
  currencies = CURRENCIES;
  su = { workspaceName: '', branchName: '', displayName: '', email: '', username: '', password: '', currency: 'SAR' };
  username = '';
  password = '';
  error = '';
  loading = false;

  constructor(private auth: AuthService, private router: Router, public i18n: I18nService, private org: OrgService) {}

  submit() {
    if (!this.username || !this.password) { this.error = this.i18n.t('login.error'); return; }
    this.loading = true;
    this.error = '';
    this.auth.login(this.username, this.password).subscribe({
      next: () => { this.loading = false; this.afterAuth(); },
      error: () => { this.loading = false; this.error = this.i18n.t('login.error'); }
    });
  }

  private afterAuth() {
    this.org.reset();
    this.org.load().subscribe();
    this.router.navigate(['/tasks']);
  }

  doSignup() {
    const v = this.su;
    if (!v.workspaceName.trim() || !v.displayName.trim() || !v.username.trim() || v.password.length < 6) { this.error = this.i18n.t('signup.fill'); return; }
    this.loading = true;
    this.error = '';
    this.auth.signup({ ...v, workspaceName: v.workspaceName.trim(), username: v.username.trim() }).subscribe({
      next: () => { this.loading = false; this.afterAuth(); },
      error: e => { this.loading = false; this.error = e.status === 409 ? this.i18n.t('signup.taken') : this.i18n.t('signup.error'); }
    });
  }
}
