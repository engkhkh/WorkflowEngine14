import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonButton, IonIcon, IonSegment, IonSegmentButton, IonLabel,
  IonList, IonItem, IonSearchbar, IonRefresher, IonRefresherContent, AlertController, ToastController, ViewWillEnter
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { addOutline, createOutline, trashOutline, gitBranchOutline, businessOutline, chevronForward } from 'ionicons/icons';
import { HttpErrorResponse } from '@angular/common/http';
import { PortalApiService } from '../core/portal-api.service';
import { AuthService } from '../core/auth.service';
import { OrgService } from '../core/org.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { AdminUser } from '../core/models';
import { Branch, Company } from '../core/erp.config';

type Tab = 'users' | 'org' | 'ws';

/** Administration on mobile: users & privileges, companies & branches, workspace usage. */
@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, TranslatePipe, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonButton, IonIcon,
    IonSegment, IonSegmentButton, IonLabel, IonList, IonItem, IonSearchbar, IonRefresher, IonRefresherContent],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button defaultHref="/tabs/more"></ion-back-button></ion-buttons>
        <ion-title>{{ 'nav.administration' | translate }}</ion-title>
        <ion-buttons slot="end">
          <ion-button *ngIf="tab() === 'users'" (click)="newUser()"><ion-icon slot="icon-only" name="add-outline"></ion-icon></ion-button>
          <ion-button *ngIf="tab() === 'org'" (click)="addCompany()"><ion-icon slot="icon-only" name="add-outline"></ion-icon></ion-button>
        </ion-buttons>
      </ion-toolbar>
      <ion-toolbar>
        <ion-segment [value]="tab()" (ionChange)="tab.set($any($event).detail.value)">
          <ion-segment-button value="users" *ngIf="auth.can('admin.users')"><ion-label>{{ 'admin.usersTab' | translate }}</ion-label></ion-segment-button>
          <ion-segment-button value="org" *ngIf="auth.can('org.manage')"><ion-label>{{ 'admin.orgTab' | translate }}</ion-label></ion-segment-button>
          <ion-segment-button value="ws"><ion-label>{{ 'admin.wsTab' | translate }}</ion-label></ion-segment-button>
        </ion-segment>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <ion-refresher slot="fixed" (ionRefresh)="refresh($event)"><ion-refresher-content></ion-refresher-content></ion-refresher>

      <!-- users -->
      <ng-container *ngIf="tab() === 'users'">
        <ion-searchbar [placeholder]="'admin.search' | translate" (ionInput)="q.set($any($event).detail.value || '')"></ion-searchbar>
        <ion-list class="boxed" lines="full">
          <ion-item button detail="false" *ngFor="let u of shown()" (click)="edit(u)">
            <span class="av" slot="start">{{ initials(u.displayName) }}</span>
            <ion-label>
              <h3>{{ u.displayName }} <span class="chip" *ngIf="u.username === auth.currentUser()?.username">{{ 'admin.you' | translate }}</span></h3>
              <p>{{ u.username }} · {{ u.role }}</p>
              <p>{{ (u.permissions === null ? 'admin.roleDefaults' : 'admin.custom') | translate }} · {{ 'admin.count' | translate: { n: u.effectivePermissions.length } }}</p>
            </ion-label>
            <span class="state" [class.on]="u.isActive" slot="end">{{ (u.isActive ? 'admin.active' : 'admin.inactive') | translate }}</span>
          </ion-item>
        </ion-list>
        <p class="empty-state" *ngIf="!shown().length">{{ 'common.noData' | translate }}</p>
      </ng-container>

      <!-- organisation -->
      <ng-container *ngIf="tab() === 'org'">
        <p class="dim sub">{{ 'org.sub' | translate }}</p>
        <div class="co" *ngFor="let c of org.companies()">
          <div class="co-head">
            <ion-icon name="business-outline"></ion-icon>
            <div class="grow"><strong>{{ i18n.nm(c) }}</strong><small class="dim">{{ c.code }} · {{ c.currency }}</small></div>
            <ion-button fill="clear" size="small" (click)="editCompany(c)"><ion-icon slot="icon-only" name="create-outline"></ion-icon></ion-button>
            <ion-button fill="clear" size="small" color="danger" [disabled]="org.companies().length < 2" (click)="delCompany(c)"><ion-icon slot="icon-only" name="trash-outline"></ion-icon></ion-button>
          </div>
          <div class="br" *ngFor="let b of org.branchesOf(c.code)">
            <ion-icon name="git-branch-outline"></ion-icon>
            <div class="grow"><strong>{{ i18n.nm(b) }}</strong><small class="dim">{{ b.code }} · {{ b.warehouse }}<span *ngIf="b.city"> · {{ b.city }}</span></small></div>
            <ion-button fill="clear" size="small" (click)="editBranch(b)"><ion-icon slot="icon-only" name="create-outline"></ion-icon></ion-button>
            <ion-button fill="clear" size="small" color="danger" (click)="delBranch(b)"><ion-icon slot="icon-only" name="trash-outline"></ion-icon></ion-button>
          </div>
          <p class="dim none" *ngIf="!org.branchesOf(c.code).length">{{ 'org.noBranches' | translate }}</p>
          <ion-button size="small" fill="outline" (click)="addBranch(c)"><ion-icon slot="start" name="add-outline"></ion-icon>{{ 'org.addBranch' | translate }}</ion-button>
        </div>
      </ng-container>

      <!-- workspace -->
      <ng-container *ngIf="tab() === 'ws'">
        <div class="ws" *ngIf="org.tenant() as t">
          <div class="ws-head"><div><strong>{{ t.name }}</strong><small class="dim">{{ 'ws.id' | translate }}: {{ t.id }}</small></div>
            <span class="plan">{{ 'ws.plan.' + t.plan | translate }}</span></div>
          <h4>{{ 'ws.usage' | translate }}</h4>
          <div class="meter" *ngFor="let m of meters()">
            <div class="mh"><span>{{ m.label | translate }}</span>
              <strong>{{ m.max ? ('ws.of' | translate: { used: m.used, max: m.max }) : (m.used + ' · ' + ('ws.unlimited' | translate)) }}</strong></div>
            <div class="bar"><i [style.width.%]="m.max ? (m.used / m.max * 100 > 100 ? 100 : m.used / m.max * 100) : 8" [class.full]="m.max && m.used >= m.max"></i></div>
          </div>
          <p class="dim note">{{ 'ws.note' | translate }}</p>
        </div>
        <p class="empty-state" *ngIf="!org.tenant()">{{ 'common.noData' | translate }}</p>
      </ng-container>
    </ion-content>
  `,
  styles: [`
    .sub { margin: 4px 2px 12px; font-size: 13px; }
    .av { width: 38px; height: 38px; border-radius: 50%; background: var(--primary-soft); color: var(--primary); display: grid; place-items: center; font-weight: 700; font-size: 12px; margin-inline-end: 12px; }
    ion-label h3 { font-weight: 600; font-size: 15px; }
    ion-label p { font-size: 12px; color: var(--text-dim); }
    .chip { font-size: 10.5px; padding: 1px 7px; border-radius: 6px; background: var(--surface-3); color: var(--text-2); margin-inline-start: 4px; }
    .state { font-size: 11px; color: var(--muted); } .state.on { color: var(--ok); }
    .co { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 10px 12px 12px; margin-bottom: 12px; }
    .co-head, .br { display: flex; align-items: center; gap: 10px; }
    .co-head { padding-bottom: 6px; border-bottom: 1px solid var(--border); margin-bottom: 4px; }
    .co-head ion-icon { font-size: 22px; color: var(--primary); }
    .br { padding: 4px 0 4px 6px; } .br ion-icon { color: var(--text-dim); }
    .grow { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .grow small { font-size: 11.5px; }
    .none { font-size: 12.5px; margin: 6px 0; }
    .ws { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 14px; }
    .ws-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .ws-head div { display: flex; flex-direction: column; } .ws-head small { font-size: 11.5px; }
    .plan { padding: 3px 12px; border-radius: 999px; font-size: 12px; font-weight: 650; background: var(--primary-soft); color: var(--primary); }
    h4 { margin: 18px 0 10px; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-dim); }
    :host-context(html[dir="rtl"]) h4 { text-transform: none; letter-spacing: 0; }
    .meter { margin-bottom: 14px; } .mh { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 6px; gap: 8px; }
    .bar { height: 8px; border-radius: 999px; background: var(--surface-3); overflow: hidden; }
    .bar i { display: block; height: 100%; background: var(--primary); border-radius: 999px; } .bar i.full { background: var(--bad); }
    .note { font-size: 12.5px; }
  `]
})
export class AdminPage implements OnInit, ViewWillEnter {
  tab = signal<Tab>('users');
  users = signal<AdminUser[]>([]);
  q = signal('');
  shown = computed(() => {
    const q = this.q().trim().toLowerCase();
    return this.users().filter(u => !q || (u.displayName + ' ' + u.username + ' ' + u.email).toLowerCase().includes(q));
  });
  meters = computed(() => {
    const t = this.org.tenant();
    return t ? [
      { label: 'ws.users', used: t.users, max: t.maxUsers },
      { label: 'org.companies', used: t.companies, max: t.maxCompanies },
      { label: 'org.branches', used: t.branches, max: t.maxBranches },
    ] : [];
  });

  constructor(private api: PortalApiService, public auth: AuthService, public org: OrgService, public i18n: I18nService,
              private router: Router, private alerts: AlertController, private toasts: ToastController) {
    addIcons({ addOutline, createOutline, trashOutline, gitBranchOutline, businessOutline, chevronForward });
  }

  ngOnInit() {
    this.tab.set(this.auth.can('admin.users') ? 'users' : this.auth.can('org.manage') ? 'org' : 'ws');
  }
  ionViewWillEnter() { this.refresh(); }

  refresh(ev?: any) {
    if (this.auth.can('admin.users')) this.api.adminListUsers().subscribe({ next: u => this.users.set(u), error: e => this.toast(this.msg(e), true) });
    this.org.load().subscribe(() => ev?.target?.complete());
  }

  initials(n: string) { return n.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase(); }
  newUser() { this.router.navigate(['/admin/user', 'new']); }
  edit(u: AdminUser) { this.router.navigate(['/admin/user', u.id]); }

  // ---- companies ----
  async addCompany() { this.companyDialog(null); }
  editCompany(c: Company) { this.companyDialog(c); }
  private async companyDialog(c: Company | null) {
    const t = (k: string) => this.i18n.t(k);
    const a = await this.alerts.create({
      header: t(c ? 'org.editCompany' : 'org.addCompany'),
      inputs: [
        { name: 'code', placeholder: t('org.code'), value: c?.code ?? '', disabled: !!c },
        { name: 'name', placeholder: t('org.name'), value: c?.name ?? '' },
        { name: 'nameAr', placeholder: t('org.nameAr'), value: c?.nameAr ?? '' },
        { name: 'currency', placeholder: t('org.currency'), value: c?.currency ?? this.org.companies()[0]?.currency ?? 'SAR' },
        { name: 'taxNo', placeholder: t('org.taxNo'), value: c?.taxNo ?? '' },
      ],
      buttons: [{ text: t('common.cancel'), role: 'cancel' }, { text: t('admin.save'), handler: (v: any) => {
        const code = (v.code || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
        if (!code || !(v.name || '').trim()) { this.toast(t('org.required'), true); return false; }
        this.org.saveCompany({ code, name: v.name.trim(), nameAr: (v.nameAr || '').trim() || v.name.trim(), currency: (v.currency || 'SAR').toUpperCase(), taxNo: v.taxNo }, !c, c?.code)
          .subscribe({ next: () => this.toast(t('org.saved')), error: e => this.toast(this.msg(e), true) });
        return true;
      } }]
    });
    await a.present();
  }
  async delCompany(c: Company) {
    this.confirm(this.i18n.t('org.deleteCompanyConfirm', { name: this.i18n.nm(c) }), () =>
      this.org.removeCompany(c.code).subscribe({ next: () => this.toast(this.i18n.t('org.deleted')), error: e => this.toast(this.msg(e), true) }));
  }

  // ---- branches ----
  addBranch(c: Company) { this.branchDialog(null, c.code); }
  editBranch(b: Branch) { this.branchDialog(b, b.company); }
  private async branchDialog(b: Branch | null, company: string) {
    const t = (k: string) => this.i18n.t(k);
    const a = await this.alerts.create({
      header: t(b ? 'org.editBranch' : 'org.addBranch'),
      inputs: [
        { name: 'code', placeholder: t('org.code'), value: b?.code ?? '', disabled: !!b },
        { name: 'name', placeholder: t('org.name'), value: b?.name ?? '' },
        { name: 'nameAr', placeholder: t('org.nameAr'), value: b?.nameAr ?? '' },
        { name: 'city', placeholder: t('org.city'), value: b?.city ?? '' },
        { name: 'warehouse', placeholder: t('org.warehouse'), value: b?.warehouse ?? '' },
      ],
      buttons: [{ text: t('common.cancel'), role: 'cancel' }, { text: t('admin.save'), handler: (v: any) => {
        const code = (v.code || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '');
        if (!code || !(v.name || '').trim()) { this.toast(t('org.required'), true); return false; }
        this.org.saveBranch({ code, company, name: v.name.trim(), nameAr: (v.nameAr || '').trim() || v.name.trim(), city: v.city, warehouse: (v.warehouse || '').trim() || 'WH-' + code }, !b, b?.code)
          .subscribe({ next: () => this.toast(t('org.saved')), error: e => this.toast(this.msg(e), true) });
        return true;
      } }]
    });
    await a.present();
  }
  delBranch(b: Branch) {
    this.confirm(this.i18n.t('org.deleteBranchConfirm', { name: this.i18n.nm(b) }), () =>
      this.org.removeBranch(b.code).subscribe({ next: () => this.toast(this.i18n.t('org.deleted')), error: e => this.toast(this.msg(e), true) }));
  }

  private async confirm(message: string, ok: () => void) {
    const a = await this.alerts.create({ message, buttons: [{ text: this.i18n.t('common.cancel'), role: 'cancel' }, { text: this.i18n.t('common.delete'), role: 'destructive', handler: ok }] });
    await a.present();
  }
  private async toast(message: string, bad = false) {
    const t = await this.toasts.create({ message, duration: 2500, color: bad ? 'danger' : 'success', position: 'top' });
    await t.present();
  }
  private msg(e: HttpErrorResponse): string {
    if (e.status === 403) return this.i18n.t('common.forbidden');
    if (e.status === 402) return this.i18n.t('ws.limitReached');
    return typeof e.error === 'string' && e.error ? e.error : this.i18n.t('common.error');
  }
}
