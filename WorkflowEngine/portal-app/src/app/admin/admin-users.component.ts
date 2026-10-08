import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { PortalApiService } from '../core/portal-api.service';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';
import { OrgService } from '../core/org.service';
import { TranslatePipe } from '../core/translate.pipe';
import { AdminUser, PermissionCatalog, SaveUserPayload } from '../core/models';
import { IconComponent, LocalDatePipe } from '../shared/ui';
import { PrivilegeEditorComponent } from './privilege-editor.component';

@Component({
  selector: 'app-admin-users',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent, LocalDatePipe, PrivilegeEditorComponent],
  template: `
    <div class="flash" [class.bad]="flashBad" *ngIf="flashMsg">{{ flashMsg }}</div>

    <div class="bar">
      <div class="find"><app-icon name="search" [size]="15"></app-icon><input [ngModel]="q()" (ngModelChange)="q.set($event)" [placeholder]="'admin.search' | translate" /></div>
      <select [ngModel]="roleFilter()" (ngModelChange)="roleFilter.set($event)">
        <option value="">{{ 'admin.allRoles' | translate }}</option>
        <option *ngFor="let r of roles()" [value]="r">{{ r }}</option>
      </select>
      <select [ngModel]="statusFilter()" (ngModelChange)="statusFilter.set($event)">
        <option value="">{{ 'admin.allStatus' | translate }}</option>
        <option value="active">{{ 'admin.active' | translate }}</option>
        <option value="inactive">{{ 'admin.inactive' | translate }}</option>
      </select>
      <span class="spacer"></span>
      <button class="primary" (click)="startNew()"><app-icon name="plus" [size]="15"></app-icon>{{ 'admin.newUser' | translate }}</button>
    </div>

    <div class="card">
      <div class="table-wrap">
        <table class="data">
          <thead><tr>
            <th>{{ 'admin.user' | translate }}</th><th>{{ 'admin.email' | translate }}</th><th>{{ 'admin.role' | translate }}</th>
            <th>{{ 'admin.privileges' | translate }}</th><th>{{ 'admin.status' | translate }}</th><th></th>
          </tr></thead>
          <tbody>
            <tr *ngFor="let u of shown()">
              <td>
                <div class="who"><span class="av">{{ initials(u.displayName) }}</span>
                  <div><strong>{{ u.displayName }}</strong> <span class="chip" *ngIf="u.username === auth.currentUser()?.username">{{ 'admin.you' | translate }}</span>
                    <div class="dim mono">{{ u.username }}</div></div></div>
              </td>
              <td class="dim">{{ u.email || '—' }}</td>
              <td><span class="chip">{{ u.role }}</span></td>
              <td>
                <span class="chip" [class.warn]="u.permissions !== null">{{ (u.permissions === null ? 'admin.roleDefaults' : 'admin.custom') | translate }}</span>
                <span class="dim"> · {{ 'admin.count' | translate: { n: u.effectivePermissions.length } }}</span>
              </td>
              <td><span class="dotted" [class.on]="u.isActive"></span>{{ (u.isActive ? 'admin.active' : 'admin.inactive') | translate }}</td>
              <td class="act">
                <button class="ghost sm" (click)="edit(u)" [title]="'admin.edit' | translate"><app-icon name="edit" [size]="15"></app-icon></button>
                <button class="ghost sm" (click)="startReset(u)" [title]="'admin.resetPassword' | translate"><app-icon name="key" [size]="15"></app-icon></button>
                <button class="ghost sm danger-i" (click)="confirmDelete(u)" [title]="'admin.delete' | translate" [disabled]="u.username === auth.currentUser()?.username"><app-icon name="trash" [size]="15"></app-icon></button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="empty" *ngIf="!shown().length">{{ 'common.noData' | translate }}</div>
    </div>

    <!-- create / edit -->
    <div class="modal-scrim" *ngIf="form" (click)="form = null">
      <div class="modal" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ (editingId ? 'admin.edit' : 'admin.create') | translate }}</h3>
          <button class="ghost icon-btn" (click)="form = null"><app-icon name="x"></app-icon></button></div>
        <div class="modal-body" *ngIf="form && catalog()">
          <div class="form-grid">
            <div><label class="lbl">{{ 'admin.username' | translate }}</label>
              <input [(ngModel)]="form.username" [disabled]="!!editingId" autocomplete="off" /></div>
            <div><label class="lbl">{{ 'admin.displayName' | translate }}</label><input [(ngModel)]="form.displayName" /></div>
            <div><label class="lbl">{{ 'admin.email' | translate }}</label><input type="email" [(ngModel)]="form.email" /></div>
            <div><label class="lbl">{{ 'admin.role' | translate }}</label>
              <input [(ngModel)]="form.role" list="roles-list" />
              <datalist id="roles-list"><option *ngFor="let r of roles()" [value]="r"></option></datalist></div>
            <div *ngIf="!editingId"><label class="lbl">{{ 'admin.password' | translate }}</label>
              <input type="password" [(ngModel)]="form.password" autocomplete="new-password" />
              <div class="hint">{{ 'admin.passwordHint' | translate }}</div></div>
            <div class="check"><label><input type="checkbox" [(ngModel)]="form.isActive" /> {{ 'admin.active' | translate }}</label></div>
          </div>
          <h4 class="sec">{{ 'admin.privileges' | translate }}</h4>
          <app-privilege-editor [catalog]="catalog()!" [role]="form.role" [(value)]="form.permissions"></app-privilege-editor>
          <p class="flash bad" *ngIf="formError">{{ formError }}</p>
        </div>
        <div class="modal-foot">
          <button (click)="form = null">{{ 'common.cancel' | translate }}</button>
          <button class="primary" (click)="save()" [disabled]="saving">{{ (saving ? 'admin.saving' : 'admin.save') | translate }}</button>
        </div>
      </div>
    </div>

    <!-- reset password -->
    <div class="modal-scrim" *ngIf="resetFor" (click)="resetFor = null">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'admin.resetPassword' | translate }}</h3></div>
        <div class="modal-body">
          <p class="dim">{{ resetFor.displayName }} · <span class="mono">{{ resetFor.username }}</span></p>
          <label class="lbl">{{ 'admin.newPassword' | translate }}</label>
          <input type="password" [(ngModel)]="newPassword" autocomplete="new-password" />
          <div class="hint">{{ 'admin.passwordHint' | translate }}</div>
          <p class="flash bad" *ngIf="formError">{{ formError }}</p>
        </div>
        <div class="modal-foot"><button (click)="resetFor = null">{{ 'common.cancel' | translate }}</button>
          <button class="primary" (click)="doReset()" [disabled]="saving">{{ 'admin.save' | translate }}</button></div>
      </div>
    </div>

    <!-- delete -->
    <div class="modal-scrim" *ngIf="deleting" (click)="deleting = null">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'admin.delete' | translate }}</h3></div>
        <div class="modal-body"><p>{{ 'admin.deleteConfirm' | translate: { name: deleting.displayName } }}</p>
          <p class="flash bad" *ngIf="formError">{{ formError }}</p></div>
        <div class="modal-foot"><button (click)="deleting = null">{{ 'common.cancel' | translate }}</button>
          <button class="danger" (click)="doDelete()" [disabled]="saving">{{ 'admin.delete' | translate }}</button></div>
      </div>
    </div>
  `,
  styles: [`
    .bar { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; flex-wrap: wrap; }
    .bar select { width: auto; }
    .find { display: flex; align-items: center; gap: 8px; padding: 0 11px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text-dim); min-width: 220px; }
    .find input { border: none; box-shadow: none; padding: 8px 0; background: transparent; }
    .spacer { flex: 1; }
    .who { display: flex; gap: 10px; align-items: center; }
    .av { width: 34px; height: 34px; border-radius: 50%; background: var(--primary-soft); color: var(--primary); display: grid; place-items: center; font-weight: 700; font-size: 12px; flex-shrink: 0; }
    .dotted { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--muted); margin-inline-end: 6px; }
    .dotted.on { background: var(--ok); }
    td.act { white-space: nowrap; text-align: end; }
    .danger-i { color: var(--bad); }
    .check { display: flex; align-items: flex-end; padding-bottom: 8px; }
    .check label { display: flex; gap: 8px; align-items: center; font-size: 13px; }
    .sec { margin: 20px 0 10px; font-size: 13px; font-weight: 650; }
  `]
})
export class AdminUsersComponent implements OnInit {
  users = signal<AdminUser[]>([]);
  catalog = signal<PermissionCatalog | null>(null);
  q = signal('');
  roleFilter = signal('');
  statusFilter = signal('');
  roles = computed(() => this.catalog()?.roles ?? []);

  shown = computed(() => {
    const q = this.q().trim().toLowerCase();
    return this.users().filter(u =>
      (!q || (u.displayName + ' ' + u.username + ' ' + u.email).toLowerCase().includes(q)) &&
      (!this.roleFilter() || u.role === this.roleFilter()) &&
      (!this.statusFilter() || (this.statusFilter() === 'active') === u.isActive));
  });

  form: (SaveUserPayload & { username: string; password: string }) | null = null;
  editingId = '';
  formError = '';
  saving = false;
  flashMsg = '';
  flashBad = false;
  resetFor: AdminUser | null = null;
  newPassword = '';
  deleting: AdminUser | null = null;

  constructor(private api: PortalApiService, public auth: AuthService, private i18n: I18nService, private org: OrgService) {}

  ngOnInit() {
    this.api.getPermissionCatalog().subscribe(c => this.catalog.set(c));
    this.reload();
  }

  reload() { this.api.adminListUsers().subscribe({ next: u => this.users.set(u), error: e => this.fail(e) }); }

  initials(n: string) { return n.split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase(); }

  startNew() {
    this.editingId = ''; this.formError = '';
    this.form = { username: '', displayName: '', email: '', role: 'employee', isActive: true, password: '', permissions: null };
  }

  edit(u: AdminUser) {
    this.editingId = u.id; this.formError = '';
    this.form = { username: u.username, displayName: u.displayName, email: u.email, role: u.role, isActive: u.isActive, password: '',
      permissions: u.permissions ? [...u.permissions] : null };
  }

  save() {
    if (!this.form) return;
    this.saving = true; this.formError = '';
    const f = this.form;
    const payload: SaveUserPayload = { username: f.username, displayName: f.displayName, email: f.email, role: f.role, isActive: f.isActive, permissions: f.permissions };
    if (!this.editingId) payload.password = f.password;
    const call = this.editingId ? this.api.adminUpdateUser(this.editingId, payload) : this.api.adminCreateUser(payload);
    call.subscribe({
      next: saved => {
        this.saving = false; this.form = null;
        this.flash(this.i18n.t('admin.saved'));
        this.reload();
        this.org.load().subscribe();                      // usage counters
        if (saved.username === this.auth.currentUser()?.username) this.auth.refreshMe().subscribe();
      },
      error: e => { this.saving = false; this.formError = this.msg(e); }
    });
  }

  startReset(u: AdminUser) { this.resetFor = u; this.newPassword = ''; this.formError = ''; }
  doReset() {
    if (!this.resetFor) return;
    this.saving = true; this.formError = '';
    this.api.adminResetPassword(this.resetFor.id, this.newPassword).subscribe({
      next: () => { this.saving = false; this.resetFor = null; this.flash(this.i18n.t('admin.passwordReset')); },
      error: e => { this.saving = false; this.formError = this.msg(e); }
    });
  }

  confirmDelete(u: AdminUser) { this.deleting = u; this.formError = ''; }
  doDelete() {
    if (!this.deleting) return;
    this.saving = true;
    this.api.adminDeleteUser(this.deleting.id).subscribe({
      next: () => { this.saving = false; this.deleting = null; this.flash(this.i18n.t('admin.deleted')); this.reload(); this.org.load().subscribe(); },
      error: e => { this.saving = false; this.formError = this.msg(e); }
    });
  }

  private flash(m: string, bad = false) {
    this.flashMsg = m; this.flashBad = bad;
    setTimeout(() => this.flashMsg = '', 3500);
  }
  private fail(e: HttpErrorResponse) { this.flash(this.msg(e), true); }
  /** server messages are plain English text in the response body; 403 gets the translated message */
  private msg(e: HttpErrorResponse): string {
    if (e.status === 403) return this.i18n.t('common.forbidden');
    return typeof e.error === 'string' && e.error ? e.error : (e.error?.title || this.i18n.t('common.error'));
  }
}
