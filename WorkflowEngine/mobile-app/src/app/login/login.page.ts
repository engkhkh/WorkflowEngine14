import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { IonContent, IonList, IonItem, IonInput, IonButton, IonIcon, IonText, IonSelect, IonSelectOption } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { globeOutline } from 'ionicons/icons';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';
import { ErpDataService } from '../core/erp-data.service';
import { TranslatePipe } from '../core/translate.pipe';
import { CURRENCIES, MODULES } from '../core/erp.config';
import { LangSelectComponent } from '../shared/lang-select.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, IonContent, IonList, IonItem, IonInput, IonButton, IonIcon, IonText, IonSelect, IonSelectOption, TranslatePipe, LangSelectComponent],
  template: `
    <ion-content [fullscreen]="true">
      <div class="hero">
        <app-lang-select class="lang"></app-lang-select>
        <div class="logo">W</div>
        <h1>{{ 'brand' | translate }}</h1>
        <p>{{ 'login.sub' | translate }}</p>
        <div class="mods"><span *ngFor="let m of modules"><i [style.background]="m.color"></i>{{ ('module.' + m.key) | translate }}</span></div>
      </div>

      <div class="form" *ngIf="!signupMode">
        <ion-list class="boxed" lines="full">
          <ion-item><ion-input [label]="'login.username' | translate" labelPlacement="stacked" [(ngModel)]="username" autocomplete="username"></ion-input></ion-item>
          <ion-item><ion-input [label]="'login.password' | translate" labelPlacement="stacked" type="password" [(ngModel)]="password" autocomplete="current-password"></ion-input></ion-item>
        </ion-list>
        <ion-text color="danger" *ngIf="error"><p class="err">{{ error }}</p></ion-text>
        <ion-button expand="block" [disabled]="loading" (click)="submit()">{{ (loading ? 'login.submitting' : 'login.submit') | translate }}</ion-button>

        <div class="demo">
          <p>{{ 'login.demo' | translate }}</p>
          <div class="chips"><button *ngFor="let u of demoUsers" (click)="fill(u)">{{ u }}</button></div>
        </div>
        <ion-button expand="block" fill="clear" (click)="signupMode = true; error = ''">{{ 'signup.noAccount' | translate }}</ion-button>
      </div>

      <div class="form" *ngIf="signupMode">
        <h2>{{ 'signup.title' | translate }}</h2>
        <p class="dim sub">{{ 'signup.sub' | translate }}</p>
        <ion-list class="boxed" lines="full">
          <ion-item><ion-input [label]="'signup.company' | translate" labelPlacement="stacked" [(ngModel)]="su.workspaceName"></ion-input></ion-item>
          <ion-item><ion-input [label]="'signup.branch' | translate" labelPlacement="stacked" [(ngModel)]="su.branchName"></ion-input></ion-item>
          <ion-item><ion-select [label]="'signup.currency' | translate" labelPlacement="stacked" interface="action-sheet" [(ngModel)]="su.currency">
            <ion-select-option *ngFor="let c of currencies" [value]="c">{{ c }}</ion-select-option></ion-select></ion-item>
          <ion-item><ion-input [label]="'signup.name' | translate" labelPlacement="stacked" [(ngModel)]="su.displayName"></ion-input></ion-item>
          <ion-item><ion-input [label]="'signup.email' | translate" labelPlacement="stacked" type="email" [(ngModel)]="su.email"></ion-input></ion-item>
          <ion-item><ion-input [label]="'signup.username' | translate" labelPlacement="stacked" [(ngModel)]="su.username" autocapitalize="off"></ion-input></ion-item>
          <ion-item><ion-input [label]="'signup.password' | translate" labelPlacement="stacked" type="password" [(ngModel)]="su.password"></ion-input></ion-item>
        </ion-list>
        <ion-text color="danger" *ngIf="error"><p class="err">{{ error }}</p></ion-text>
        <ion-button expand="block" [disabled]="loading" (click)="doSignup()">{{ (loading ? 'signup.submitting' : 'signup.submit') | translate }}</ion-button>
        <ion-button expand="block" fill="clear" (click)="signupMode = false; error = ''">{{ 'signup.haveAccount' | translate }}</ion-button>
      </div>
    </ion-content>
  `,
  styles: [`
    .hero { background: radial-gradient(600px 400px at 0% 0%, #312e81 0%, #0f1a33 60%, #0b1226 100%); color: #fff; padding: calc(env(safe-area-inset-top, 0px) + 28px) 22px 34px; border-radius: 0 0 26px 26px; position: relative; margin: -12px -16px 0; }
    .lang { position: absolute; top: calc(env(safe-area-inset-top, 0px) + 8px); inset-inline-end: 8px; width: 130px; --color: #c7d2fe; color: #c7d2fe; }
    h2 { margin: 0 0 4px; font-size: 20px; } .sub { font-size: 13px; margin: 0 0 12px; }
    .logo { width: 48px; height: 48px; border-radius: 14px; display: grid; place-items: center; font-weight: 800; font-size: 22px; background: linear-gradient(135deg, #6366f1, #8b5cf6 50%, #0ea5a4); box-shadow: 0 8px 22px rgba(99,102,241,.5); }
    h1 { margin: 16px 0 4px; font-size: 22px; font-weight: 700; }
    .hero p { margin: 0; opacity: .75; font-size: 13.5px; line-height: 1.45; }
    .mods { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 16px; }
    .mods span { font-size: 11.5px; border: 1px solid rgba(255,255,255,.2); border-radius: 999px; padding: 4px 10px; display: inline-flex; align-items: center; gap: 6px; }
    .mods i { width: 6px; height: 6px; border-radius: 50%; }
    .form { padding-top: 20px; }
    .err { font-size: 13px; margin: 4px 4px 10px; }
    .demo { margin-top: 22px; font-size: 12px; color: var(--text-dim); }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chips button { border: 1px solid var(--border); background: var(--surface); color: var(--text-2); border-radius: 8px; padding: 6px 10px; font-size: 12px; font-family: ui-monospace, Menlo, monospace; }
  `]
})
export class LoginPage {
  modules = MODULES;
  demoUsers = ['employee', 'manager', 'senior-manager', 'procurement', 'admin-stores', 'finance', 'sales', 'admin'];
  signupMode = false;
  currencies = CURRENCIES;
  su = { workspaceName: '', branchName: '', displayName: '', email: '', username: '', password: '', currency: 'SAR' };
  username = '';
  password = '';
  error = '';
  loading = false;

  constructor(private auth: AuthService, private router: Router, public i18n: I18nService, private data: ErpDataService) {
    addIcons({ globeOutline });
  }

  doSignup() {
    const s = this.su;
    if (!s.workspaceName.trim() || !s.displayName.trim() || !s.username.trim() || s.password.length < 6) { this.error = this.i18n.t('signup.fill'); return; }
    this.loading = true;
    this.error = '';
    this.auth.signup({ ...s, workspaceName: s.workspaceName.trim(), username: s.username.trim() }).subscribe({
      next: () => { this.loading = false; this.data.loadedOnce.set(false); this.router.navigate(['/tabs/home'], { replaceUrl: true }); },
      error: e => { this.loading = false; this.error = e.status === 409 ? this.i18n.t('signup.taken') : this.i18n.t('signup.error'); }
    });
  }

  fill(u: string) { this.username = u; this.password = u + '123'; }

  submit() {
    if (!this.username || !this.password) { this.error = this.i18n.t('login.error'); return; }
    this.loading = true;
    this.error = '';
    this.auth.login(this.username, this.password).subscribe({
      next: () => { this.loading = false; this.data.loadedOnce.set(false); this.router.navigate(['/tabs/home'], { replaceUrl: true }); },
      error: () => { this.loading = false; this.error = this.i18n.t('login.error'); }
    });
  }
}
