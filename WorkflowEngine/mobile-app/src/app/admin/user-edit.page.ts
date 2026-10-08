import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import {
  IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonButton, IonList, IonItem, IonInput, IonToggle, IonCheckbox,
  AlertController, ToastController
} from '@ionic/angular/standalone';
import { PortalApiService } from '../core/portal-api.service';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';
import { OrgService } from '../core/org.service';
import { TranslatePipe } from '../core/translate.pipe';
import { AdminUser, PermissionCatalog, SaveUserPayload } from '../core/models';

/** Add / edit one user: profile, role, active flag and an individual privilege set (or the role's defaults). */
@Component({
  selector: 'app-user-edit',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IonHeader, IonToolbar, IonTitle, IonContent, IonButtons, IonBackButton, IonButton,
    IonList, IonItem, IonInput, IonToggle, IonCheckbox],
  template: `
    <ion-header><ion-toolbar>
      <ion-buttons slot="start"><ion-back-button defaultHref="/admin"></ion-back-button></ion-buttons>
      <ion-title>{{ (isNew ? 'admin.create' : 'admin.edit') | translate }}</ion-title>
      <ion-buttons slot="end"><ion-button strong (click)="save()" [disabled]="saving">{{ (saving ? 'admin.saving' : 'admin.save') | translate }}</ion-button></ion-buttons>
    </ion-toolbar></ion-header>

    <ion-content *ngIf="cat() as c">
      <ion-list class="boxed" lines="full">
        <ion-item><ion-input [label]="'admin.username' | translate" labelPlacement="stacked" [(ngModel)]="f.username" [disabled]="!isNew" autocapitalize="off"></ion-input></ion-item>
        <ion-item><ion-input [label]="'admin.displayName' | translate" labelPlacement="stacked" [(ngModel)]="f.displayName"></ion-input></ion-item>
        <ion-item><ion-input [label]="'admin.email' | translate" labelPlacement="stacked" type="email" [(ngModel)]="f.email"></ion-input></ion-item>
        <ion-item><ion-input [label]="'admin.role' | translate" labelPlacement="stacked" [(ngModel)]="f.role" (ionInput)="role = f.role" autocapitalize="off"></ion-input></ion-item>
        <ion-item *ngIf="isNew"><ion-input [label]="'admin.password' | translate" labelPlacement="stacked" type="password" [(ngModel)]="f.password"></ion-input></ion-item>
        <ion-item><ion-toggle [(ngModel)]="f.isActive">{{ 'admin.active' | translate }}</ion-toggle></ion-item>
      </ion-list>
      <p class="hint" *ngIf="roleNames(c).length">{{ roleNames(c).join(' · ') }}</p>

      <div class="section-title">{{ 'admin.privileges' | translate }}</div>
      <ion-list class="boxed" lines="full">
        <ion-item>
          <ion-toggle [checked]="f.permissions === null" (ionChange)="toggleDefaults($any($event).detail.checked, c)">{{ 'admin.useRoleDefaults' | translate }}</ion-toggle>
        </ion-item>
      </ion-list>
      <p class="hint">{{ 'admin.roleNote' | translate }}</p>

      <div class="tools" *ngIf="f.permissions !== null">
        <ion-button size="small" fill="outline" (click)="setAll(c)">{{ 'admin.selectAll' | translate }}</ion-button>
        <ion-button size="small" fill="outline" (click)="f.permissions = []">{{ 'admin.clearAll' | translate }}</ion-button>
        <ion-button size="small" fill="outline" (click)="f.permissions = roleList(c)">{{ 'admin.copyRole' | translate }}</ion-button>
      </div>

      <ion-list class="boxed grp" lines="full" *ngFor="let g of c.groups" [class.off]="f.permissions === null">
        <div class="gh">{{ 'perm.group.' + g.group | translate }}</div>
        <ion-item *ngFor="let k of g.keys">
          <ion-checkbox [checked]="has(k, c)" [disabled]="f.permissions === null" (ionChange)="flip(k, $any($event).detail.checked, c)">{{ 'perm.' + k | translate }}</ion-checkbox>
        </ion-item>
      </ion-list>

      <div class="actions" *ngIf="!isNew">
        <ion-button expand="block" fill="outline" (click)="resetPassword()">{{ 'admin.resetPassword' | translate }}</ion-button>
        <ion-button expand="block" fill="outline" color="danger" (click)="remove()" [disabled]="f.username === auth.currentUser()?.username">{{ 'admin.delete' | translate }}</ion-button>
      </div>
    </ion-content>
  `,
  styles: [`
    .hint { font-size: 12px; color: var(--text-dim); margin: 6px 4px 0; }
    .tools { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0 0; }
    .grp { margin-top: 12px; } .grp.off { opacity: .55; }
    .gh { padding: 10px 16px 4px; font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-dim); }
    :host-context(html[dir="rtl"]) .gh { text-transform: none; letter-spacing: 0; }
    .actions { margin: 22px 0 30px; display: flex; flex-direction: column; gap: 8px; }
  `]
})
export class UserEditPage implements OnInit {
  cat = signal<PermissionCatalog | null>(null);
  isNew = true;
  id = '';
  role = 'employee';
  saving = false;
  f: SaveUserPayload & { username: string; password: string } = { username: '', displayName: '', email: '', role: 'employee', isActive: true, password: '', permissions: null };

  constructor(private route: ActivatedRoute, private router: Router, private api: PortalApiService, public auth: AuthService,
              private i18n: I18nService, private org: OrgService, private alerts: AlertController, private toasts: ToastController) {}

  ngOnInit() {
    this.id = this.route.snapshot.paramMap.get('id') ?? 'new';
    this.isNew = this.id === 'new';
    this.api.getPermissionCatalog().subscribe(c => this.cat.set(c));
    if (!this.isNew) {
      this.api.adminListUsers().subscribe(list => {
        const u = list.find(x => x.id === this.id);
        if (!u) { this.router.navigate(['/admin']); return; }
        this.f = { username: u.username, displayName: u.displayName, email: u.email, role: u.role, isActive: u.isActive, password: '', permissions: u.permissions ? [...u.permissions] : null };
        this.role = u.role;
      });
    }
  }

  roleNames(c: PermissionCatalog) { return Object.keys(c.roleDefaults); }
  roleList(c: PermissionCatalog): string[] { return [...(c.roleDefaults[this.f.role] ?? c.roleDefaults['employee'] ?? [])]; }
  has(k: string, c: PermissionCatalog) { return (this.f.permissions ?? this.roleList(c)).includes(k); }
  toggleDefaults(on: boolean, c: PermissionCatalog) { this.f.permissions = on ? null : this.roleList(c); }
  setAll(c: PermissionCatalog) { this.f.permissions = c.groups.flatMap(g => g.keys); }
  flip(k: string, on: boolean, c: PermissionCatalog) {
    if (this.f.permissions === null) return;
    const s = new Set(this.f.permissions);
    on ? s.add(k) : s.delete(k);
    this.f.permissions = [...s];
  }

  save() {
    this.saving = true;
    const f = this.f;
    const payload: SaveUserPayload = { username: f.username, displayName: f.displayName, email: f.email, role: f.role, isActive: f.isActive, permissions: f.permissions };
    if (this.isNew) payload.password = f.password;
    (this.isNew ? this.api.adminCreateUser(payload) : this.api.adminUpdateUser(this.id, payload)).subscribe({
      next: saved => {
        this.saving = false;
        this.toast(this.i18n.t('admin.saved'));
        this.org.load().subscribe();
        if (saved.username === this.auth.currentUser()?.username) this.auth.refreshMe().subscribe();
        this.router.navigate(['/admin']);
      },
      error: e => { this.saving = false; this.toast(this.msg(e), true); }
    });
  }

  async resetPassword() {
    const a = await this.alerts.create({
      header: this.i18n.t('admin.resetPassword'),
      inputs: [{ name: 'pw', type: 'password', placeholder: this.i18n.t('admin.newPassword') }],
      buttons: [{ text: this.i18n.t('common.cancel'), role: 'cancel' }, { text: this.i18n.t('admin.save'), handler: (v: any) => {
        this.api.adminResetPassword(this.id, v.pw || '').subscribe({ next: () => this.toast(this.i18n.t('admin.passwordReset')), error: e => this.toast(this.msg(e), true) });
        return true;
      } }]
    });
    await a.present();
  }

  async remove() {
    const a = await this.alerts.create({
      message: this.i18n.t('admin.deleteConfirm', { name: this.f.displayName }),
      buttons: [{ text: this.i18n.t('common.cancel'), role: 'cancel' }, { text: this.i18n.t('common.delete'), role: 'destructive', handler: () => {
        this.api.adminDeleteUser(this.id).subscribe({ next: () => { this.toast(this.i18n.t('admin.deleted')); this.org.load().subscribe(); this.router.navigate(['/admin']); }, error: e => this.toast(this.msg(e), true) });
      } }]
    });
    await a.present();
  }

  private async toast(message: string, bad = false) {
    const t = await this.toasts.create({ message, duration: 2500, color: bad ? 'danger' : 'success', position: 'top' });
    await t.present();
  }
  private msg(e: HttpErrorResponse): string {
    if (e.status === 403) return this.i18n.t('common.forbidden');
    return typeof e.error === 'string' && e.error ? e.error : this.i18n.t('common.error');
  }
}
