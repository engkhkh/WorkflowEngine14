import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PortalApiService } from '../core/portal-api.service';
import { I18nService } from '../core/i18n.service';
import { RbacCatalog, RbacPermission, RbacRole } from '../core/models';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent } from '../shared/ui';
import { errMsg } from '../hr/hr-util';

/**
 * Roles & privileges, stored in the database: edit what each role gets by default, create / copy / delete roles, switch a page
 * (privilege) on or off for the whole workspace, or add a privilege of your own. Users with a personal list are not affected.
 */
@Component({
  selector: 'app-admin-roles',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent],
  template: `
    <p class="dim lead">{{ 'admin.rolesSub' | translate }}</p>
    <p class="flash bad" *ngIf="error">{{ error }}</p><p class="flash good" *ngIf="msg">{{ msg }}</p>
    <div class="row">
      <button class="primary" (click)="openNew = true; nr = { role: '', name: '', copyFrom: 'employee' }"><app-icon name="plus" [size]="15"></app-icon>{{ 'rbac.newRole' | translate }}</button>
      <span class="grow"></span><span class="dim" *ngIf="dirtyCount()">{{ 'rbac.unsaved' | translate }}: {{ dirtyCount() }}</span>
    </div>

    <div class="card" *ngIf="cat() as c">
      <div class="table-wrap">
        <table class="data matrix">
          <thead>
            <tr><th>{{ 'admin.privileges' | translate }}</th>
              <th class="c" *ngFor="let r of c.roles"><div class="rh"><b>{{ r.name || r.role }}</b><small class="dim">{{ r.users }} {{ 'rbac.users' | translate }}</small>
                <span class="acts" *ngIf="r.role !== 'admin'">
                  <button class="mini primary" *ngIf="dirty(r.role)" (click)="save(r)">{{ 'admin.save' | translate }}</button>
                  <button class="mini" *ngIf="dirty(r.role)" (click)="reset(r)">{{ 'common.cancel' | translate }}</button>
                  <button class="mini" *ngIf="!dirty(r.role) && (r.customised || !r.isSystem)" (click)="removeRole(r)">{{ r.isSystem ? ('rbac.restore' | translate) : ('common.delete' | translate) }}</button>
                </span></div></th></tr>
          </thead>
          <tbody>
            <ng-container *ngFor="let g of groups()">
              <tr class="grp"><td [attr.colspan]="c.roles.length + 1">{{ groupLabel(g.group) }}</td></tr>
              <tr *ngFor="let p of g.items" [class.off]="!p.isActive">
                <td>{{ label(p) }} <span class="mono dim">{{ p.key }}</span> <span class="tag" *ngIf="p.isCustom">{{ 'rbac.custom' | translate }}</span></td>
                <td class="c" *ngFor="let r of c.roles">
                  <input type="checkbox" [checked]="has(r, p.key)" [disabled]="r.role === 'admin' || !p.isActive" (change)="toggle(r, p.key)" />
                </td>
              </tr>
            </ng-container>
          </tbody>
        </table>
      </div>
    </div>

    <h3 class="h">{{ 'rbac.catalog' | translate }}</h3>
    <p class="dim lead">{{ 'rbac.catalogSub' | translate }}</p>
    <div class="row"><input class="search" [placeholder]="'common.search' | translate" [(ngModel)]="q" /><span class="grow"></span>
      <button (click)="openPerm = true; np = { key: '', group: '', label: '', route: '' }"><app-icon name="plus" [size]="15"></app-icon>{{ 'rbac.newPerm' | translate }}</button></div>
    <div class="card" *ngIf="cat() as c"><div class="table-wrap"><table class="data">
      <thead><tr><th>{{ 'admin.privileges' | translate }}</th><th>{{ 'rbac.group' | translate }}</th><th>{{ 'rbac.route' | translate }}</th><th>{{ 'rbac.active' | translate }}</th><th></th></tr></thead>
      <tbody><tr *ngFor="let p of filtered()" [class.off]="!p.isActive">
        <td>{{ label(p) }}<br><span class="mono dim">{{ p.key }}</span></td><td>{{ groupLabel(p.group) }}</td><td class="mono">{{ p.route || '—' }}</td>
        <td><input type="checkbox" [checked]="p.isActive" (change)="setActive(p, $any($event.target).checked)" /></td>
        <td><button class="ghost sm" *ngIf="p.isCustom" (click)="removePerm(p)">{{ 'common.delete' | translate }}</button></td></tr></tbody></table></div></div>

    <div class="modal-scrim" *ngIf="openNew" (click)="openNew = false"><div class="modal sm" (click)="$event.stopPropagation()">
      <div class="modal-head"><h3>{{ 'rbac.newRole' | translate }}</h3></div>
      <div class="modal-body">
        <label class="lbl">{{ 'rbac.roleCode' | translate }}</label><input [(ngModel)]="nr.role" placeholder="warehouse-lead" />
        <label class="lbl">{{ 'erp.f.name' | translate }}</label><input [(ngModel)]="nr.name" />
        <label class="lbl">{{ 'rbac.copyFrom' | translate }}</label>
        <select [(ngModel)]="nr.copyFrom"><option value="">—</option><option *ngFor="let r of cat()?.roles" [value]="r.role">{{ r.name || r.role }}</option></select></div>
      <div class="modal-foot"><button (click)="openNew = false">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="createRole()">{{ 'admin.save' | translate }}</button></div></div></div>

    <div class="modal-scrim" *ngIf="openPerm" (click)="openPerm = false"><div class="modal sm" (click)="$event.stopPropagation()">
      <div class="modal-head"><h3>{{ 'rbac.newPerm' | translate }}</h3></div>
      <div class="modal-body">
        <label class="lbl">{{ 'rbac.key' | translate }}</label><input [(ngModel)]="np.key" placeholder="sales.discounts" />
        <label class="lbl">{{ 'rbac.group' | translate }}</label><input [(ngModel)]="np.group" placeholder="sales" />
        <label class="lbl">{{ 'rbac.label' | translate }}</label><input [(ngModel)]="np.label" />
        <label class="lbl">{{ 'rbac.route' | translate }}</label><input [(ngModel)]="np.route" placeholder="/my-page" /></div>
      <div class="modal-foot"><button (click)="openPerm = false">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="addPerm()">{{ 'admin.save' | translate }}</button></div></div></div>
  `,
  styles: [`
    .lead { margin: 0 0 14px; font-size: 13px; } .h { margin: 26px 0 6px; font-size: 14px; } .row { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; } .grow { flex: 1; }
    .matrix th.c, .matrix td.c { text-align: center; } .matrix td.c { width: 96px; } .rh { display: flex; flex-direction: column; gap: 2px; align-items: center; } .acts { display: flex; gap: 4px; margin-top: 3px; } .mini { padding: 2px 8px; font-size: 11px; }
    tr.grp td { background: var(--surface-3); font-weight: 650; font-size: 12px; color: var(--text-2); padding-block: 6px; } tr.off td { opacity: .5; }
    .tag { font-size: 10px; padding: 1px 6px; border-radius: 8px; background: var(--primary-soft, rgba(99,102,241,.15)); color: var(--primary); } .card { margin-bottom: 18px; }
  `]
})
export class AdminRolesComponent implements OnInit {
  cat = signal<RbacCatalog | null>(null);
  edits = signal<Record<string, Set<string>>>({});    // unsaved changes per role
  q = ''; error = ''; msg = ''; openNew = false; openPerm = false;
  nr = { role: '', name: '', copyFrom: 'employee' }; np = { key: '', group: '', label: '', route: '' };
  constructor(private api: PortalApiService, private i18n: I18nService) {}
  ngOnInit() { this.load(); }
  private load() { this.api.rbacGet().subscribe({ next: c => { this.cat.set(c); this.edits.set({}); }, error: e => this.error = errMsg(e, this.i18n) }); }
  private done = (c: RbacCatalog) => { this.cat.set(c); this.edits.set({}); this.error = ''; };
  private fail = (e: any) => { this.error = errMsg(e, this.i18n); this.msg = ''; };

  groups = computed(() => {
    const c = this.cat(); if (!c) return [];
    const m = new Map<string, RbacPermission[]>();
    for (const p of [...c.permissions].sort((a, b) => a.sortOrder - b.sortOrder)) { if (!m.has(p.group)) m.set(p.group, []); m.get(p.group)!.push(p); }
    return [...m.entries()].map(([group, items]) => ({ group, items }));
  });
  filtered = computed(() => { const q = this.q.trim().toLowerCase(); return (this.cat()?.permissions ?? []).filter(p => !q || (p.key + ' ' + this.label(p)).toLowerCase().includes(q)); });
  dirtyCount = () => Object.keys(this.edits()).length;
  dirty = (role: string) => !!this.edits()[role];
  has(r: RbacRole, key: string) { const e = this.edits()[r.role]; return r.role === 'admin' ? true : e ? e.has(key) : r.permissions.includes(key); }
  toggle(r: RbacRole, key: string) {
    const cur = new Set(this.edits()[r.role] ?? r.permissions); cur.has(key) ? cur.delete(key) : cur.add(key);
    this.edits.update(x => ({ ...x, [r.role]: cur }));
  }
  reset(r: RbacRole) { this.edits.update(x => { const n = { ...x }; delete n[r.role]; return n; }); }
  label(p: RbacPermission) { if (p.label) return p.label; const k = 'perm.' + p.key; const t = this.i18n.t(k); return t === k ? p.key : t; }
  groupLabel(g: string) { const k = 'perm.group.' + g; const t = this.i18n.t(k); return t === k ? g : t; }

  save(r: RbacRole) { const set = this.edits()[r.role]; if (!set) return; this.api.rbacSaveRole(r.role, { permissions: [...set] }).subscribe({ next: c => { this.done(c); this.msg = this.i18n.t('rbac.saved'); }, error: this.fail }); }
  removeRole(r: RbacRole) { if (!confirm(this.i18n.t(r.isSystem ? 'rbac.restoreConfirm' : 'rbac.deleteConfirm', { name: r.name || r.role }))) return; this.api.rbacDeleteRole(r.role).subscribe({ next: this.done, error: this.fail }); }
  createRole() { this.api.rbacCreateRole({ role: this.nr.role, name: this.nr.name, copyFrom: this.nr.copyFrom || undefined }).subscribe({ next: c => { this.openNew = false; this.done(c); }, error: this.fail }); }
  setActive(p: RbacPermission, v: boolean) { this.api.rbacSavePermission(p.key, { isActive: v }).subscribe({ next: this.done, error: e => { this.fail(e); this.load(); } }); }
  addPerm() { this.api.rbacAddPermission({ ...this.np }).subscribe({ next: c => { this.openPerm = false; this.done(c); }, error: this.fail }); }
  removePerm(p: RbacPermission) { if (!confirm(this.i18n.t('rbac.deleteConfirm', { name: p.key }))) return; this.api.rbacDeletePermission(p.key).subscribe({ next: this.done, error: this.fail }); }
}
