import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { HrService } from '../core/hr.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { Employee, HrKind, HrRecord, REF_KINDS, UNIT_LEVELS } from '../core/hr.models';
import { IconComponent } from '../shared/ui';
import { empName, errMsg, refLabel } from './hr-util';

interface UnitRow { rec: HrRecord; depth: number; direct: number; total: number; }

/**
 * Organization structure (Company > Division > Department > Section > Team) and the reference data employees are linked to:
 * positions, jobs, grades, cost centres, locations, legal entities, business units and leave types.
 * Viewing needs hr.org.view; adding / editing / deleting needs hr.org.manage.
 */
@Component({
  selector: 'app-hr-org',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe, IconComponent],
  template: `
    <div class="flash" [class.bad]="flashBad" *ngIf="flashMsg">{{ flashMsg }}</div>
    <div class="seg" style="margin-bottom:16px">
      <button [class.on]="tab() === 'units'" (click)="tab.set('units')">{{ 'hr.org.structure' | translate }}</button>
      <button *ngFor="let k of kinds" [class.on]="tab() === k.kind" (click)="tab.set(k.kind)">{{ k.labelKey | translate }}</button>
    </div>

    <!-- ===== org units ===== -->
    <ng-container *ngIf="tab() === 'units'">
      <div class="bar">
        <p class="dim grow">{{ 'hr.org.structureHint' | translate }} <a routerLink="/admin" *ngIf="auth.can('org.manage')">{{ 'hr.org.companiesLink' | translate }}</a></p>
        <button class="primary" *ngIf="canManage" (click)="openUnit(null, '')"><app-icon name="plus" [size]="15"></app-icon>{{ 'hr.org.newUnit' | translate }}</button>
      </div>
      <div class="card">
        <table class="data">
          <thead><tr><th>{{ 'hr.org.unit' | translate }}</th><th>{{ 'hr.org.level' | translate }}</th><th>{{ 'hr.org.manager' | translate }}</th><th class="num">{{ 'hr.org.headcount' | translate }}</th><th></th></tr></thead>
          <tbody>
            <tr *ngFor="let u of tree()">
              <td><div class="node" [style.padding-inline-start.px]="u.depth * 22"><app-icon [name]="u.depth ? 'git-branch' : 'building'" [size]="15"></app-icon>
                <strong>{{ label(u.rec) }}</strong><span class="mono dim">{{ u.rec.code }}</span></div></td>
              <td><span class="chip">{{ 'hr.lvl.' + (u.rec.data['level'] || 'department') | translate }}</span></td>
              <td class="dim">{{ managerName(u.rec.data['manager']) }}</td>
              <td class="num"><b>{{ u.direct }}</b><span class="dim" *ngIf="u.total !== u.direct"> ({{ u.total }})</span></td>
              <td class="act">
                <button class="ghost sm" *ngIf="canManage" (click)="openUnit(null, u.rec.code || '')" [title]="'hr.org.addChild' | translate"><app-icon name="plus" [size]="15"></app-icon></button>
                <button class="ghost sm" *ngIf="canManage" (click)="openUnit(u.rec, '')" [title]="'admin.edit' | translate"><app-icon name="edit" [size]="15"></app-icon></button>
                <button class="ghost sm danger-i" *ngIf="canManage" (click)="ask('unit', u.rec)" [title]="'admin.delete' | translate"><app-icon name="trash" [size]="15"></app-icon></button>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="empty" *ngIf="!tree().length">{{ 'hr.org.noUnits' | translate }}</div>
      </div>
    </ng-container>

    <!-- ===== reference data ===== -->
    <ng-container *ngIf="tab() !== 'units'">
      <div class="bar"><p class="dim grow">{{ 'hr.org.refHint' | translate }}</p>
        <button class="primary" *ngIf="canManage" (click)="openRef(null)"><app-icon name="plus" [size]="15"></app-icon>{{ 'hr.org.newRef' | translate }}</button></div>
      <div class="card">
        <table class="data">
          <thead><tr><th>{{ 'hr.org.code' | translate }}</th><th>{{ 'hr.org.name' | translate }}</th><th>{{ 'hr.org.nameAr' | translate }}</th>
            <th class="num" *ngIf="tab() === 'leavetype'">{{ 'hr.org.daysYear' | translate }}</th><th class="num">{{ 'hr.org.used' | translate }}</th><th></th></tr></thead>
          <tbody>
            <tr *ngFor="let r of refList()">
              <td class="mono">{{ r.code }}</td><td><strong>{{ r.data['name'] }}</strong></td><td class="dim" dir="rtl">{{ r.data['nameAr'] }}</td>
              <td class="num" *ngIf="tab() === 'leavetype'">{{ r.data['days'] }}</td>
              <td class="num dim">{{ usedBy(r) }}</td>
              <td class="act">
                <button class="ghost sm" *ngIf="canManage" (click)="openRef(r)"><app-icon name="edit" [size]="15"></app-icon></button>
                <button class="ghost sm danger-i" *ngIf="canManage" (click)="ask($any(tab()), r)"><app-icon name="trash" [size]="15"></app-icon></button>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="empty" *ngIf="!refList().length">{{ 'common.noData' | translate }}</div>
      </div>
    </ng-container>

    <!-- unit dialog -->
    <div class="modal-scrim" *ngIf="unitForm" (click)="unitForm = null">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ (editId ? 'hr.org.editUnit' : 'hr.org.newUnit') | translate }}</h3></div>
        <div class="modal-body"><div class="form-grid">
          <div><label class="lbl">{{ 'hr.org.code' | translate }} *</label><input [(ngModel)]="unitForm.code" /></div>
          <div><label class="lbl">{{ 'hr.org.level' | translate }}</label><select [(ngModel)]="unitForm.level"><option *ngFor="let l of levels" [value]="l">{{ 'hr.lvl.' + l | translate }}</option></select></div>
          <div><label class="lbl">{{ 'hr.org.name' | translate }} *</label><input [(ngModel)]="unitForm.name" /></div>
          <div><label class="lbl">{{ 'hr.org.nameAr' | translate }}</label><input [(ngModel)]="unitForm.nameAr" dir="rtl" /></div>
          <div><label class="lbl">{{ 'hr.org.parent' | translate }}</label>
            <select [(ngModel)]="unitForm.parent"><option value="">— {{ 'hr.org.top' | translate }}</option>
              <option *ngFor="let p of parentChoices()" [value]="p.code">{{ label(p) }}</option></select></div>
          <div><label class="lbl">{{ 'hr.org.manager' | translate }}</label>
            <select [(ngModel)]="unitForm.manager"><option value="">—</option><option *ngFor="let e of emps()" [value]="e.empNo">{{ e.empNo }} · {{ nm(e) }}</option></select></div>
        </div><p class="flash bad" *ngIf="formError">{{ formError }}</p></div>
        <div class="modal-foot"><button (click)="unitForm = null">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="saveUnit()" [disabled]="saving">{{ 'admin.save' | translate }}</button></div>
      </div>
    </div>

    <!-- reference dialog -->
    <div class="modal-scrim" *ngIf="refForm" (click)="refForm = null">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ labelOfTab() | translate }}</h3></div>
        <div class="modal-body"><div class="form-grid">
          <div><label class="lbl">{{ 'hr.org.code' | translate }} *</label><input [(ngModel)]="refForm.code" /></div>
          <div *ngIf="tab() === 'leavetype'"><label class="lbl">{{ 'hr.org.daysYear' | translate }}</label><input type="number" min="0" [(ngModel)]="refForm.days" /></div>
          <div><label class="lbl">{{ 'hr.org.name' | translate }} *</label><input [(ngModel)]="refForm.name" /></div>
          <div><label class="lbl">{{ 'hr.org.nameAr' | translate }}</label><input [(ngModel)]="refForm.nameAr" dir="rtl" /></div>
        </div><p class="flash bad" *ngIf="formError">{{ formError }}</p></div>
        <div class="modal-foot"><button (click)="refForm = null">{{ 'common.cancel' | translate }}</button><button class="primary" (click)="saveRef()" [disabled]="saving">{{ 'admin.save' | translate }}</button></div>
      </div>
    </div>

    <!-- delete -->
    <div class="modal-scrim" *ngIf="deleting" (click)="deleting = null">
      <div class="modal sm" (click)="$event.stopPropagation()">
        <div class="modal-head"><h3>{{ 'admin.delete' | translate }}</h3></div>
        <div class="modal-body"><p>{{ 'hr.org.deleteConfirm' | translate: { name: label(deleting.rec) } }}</p><p class="flash bad" *ngIf="formError">{{ formError }}</p></div>
        <div class="modal-foot"><button (click)="deleting = null">{{ 'common.cancel' | translate }}</button><button class="primary danger-fill" (click)="doDelete()">{{ 'admin.delete' | translate }}</button></div>
      </div>
    </div>
  `,
  styles: [`
    .bar { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; } .grow { flex: 1; margin: 0; font-size: 13px; }
    .node { display: flex; align-items: center; gap: 8px; } .node app-icon { color: var(--text-dim); }
    .act { white-space: nowrap; text-align: end; } .danger-i { color: var(--bad); }
    .danger-fill { background: var(--bad); border-color: var(--bad); color: #fff; }
  `]
})
export class HrOrgComponent implements OnInit {
  kinds = REF_KINDS;
  levels = UNIT_LEVELS;
  tab = signal<'units' | HrKind>('units');
  emps = signal<Employee[]>([]);
  version = signal(0);

  unitForm: any = null; refForm: any = null; editId = ''; deleting: { kind: HrKind; rec: HrRecord } | null = null;
  saving = false; formError = ''; flashMsg = ''; flashBad = false;

  get canManage() { return this.auth.can('hr.org.manage'); }

  constructor(public auth: AuthService, private hr: HrService, private i18n: I18nService) {}

  ngOnInit() {
    this.reload();
    this.hr.employees().subscribe({ next: l => this.emps.set(l), error: () => {} });
  }
  reload() { this.hr.loadRefs().subscribe(() => this.version.update(v => v + 1)); }

  units = computed(() => { this.version(); return this.hr.ref('unit'); });
  refList = computed(() => { this.version(); const t = this.tab(); return t === 'units' ? [] : this.hr.ref(t); });

  tree = computed<UnitRow[]>(() => {
    const units = this.units();
    const emps = this.emps().filter(e => e.status !== 'Terminated');
    const direct = (u: HrRecord) => emps.filter(e => this.matches(e.unit, u)).length;
    const kids = (parent: string) => units.filter(u => (u.data['parent'] ?? '') === parent);
    const out: UnitRow[] = [];
    const seen = new Set<string>();
    const walk = (parent: string, depth: number): number => {
      let sum = 0;
      for (const u of kids(parent)) {
        if (seen.has(u.id)) continue; seen.add(u.id);
        const row: UnitRow = { rec: u, depth, direct: direct(u), total: 0 };
        out.push(row);
        row.total = row.direct + walk(u.code ?? '', depth + 1);
        sum += row.total;
      }
      return sum;
    };
    walk('', 0);
    // orphans (parent deleted) are shown at the top level so nothing disappears
    for (const u of units) if (!seen.has(u.id)) { seen.add(u.id); const row = { rec: u, depth: 0, direct: direct(u), total: 0 }; row.total = row.direct; out.push(row); }
    return out;
  });

  parentChoices() { return this.units().filter(u => u.id !== this.editId); }
  matches(v: string | null | undefined, u: HrRecord) { const s = (v ?? '').trim().toLowerCase(); return !!s && (s === (u.code ?? '').toLowerCase() || s === String(u.data['name'] ?? '').toLowerCase()); }
  usedBy(r: HrRecord) { return this.emps().filter(e => this.matches(this.fieldOf(e), r)).length; }
  private fieldOf(e: Employee): string | null | undefined {
    switch (this.tab()) { case 'position': return e.position; case 'job': return e.job; case 'grade': return e.grade; case 'costcenter': return e.costCenter;
      case 'location': return e.location; case 'entity': return e.legalEntity; case 'bu': return e.businessUnit; default: return null; }
  }
  label(r: HrRecord) { return refLabel(r, this.i18n); }
  nm(e: Employee) { return empName(e, this.i18n); }
  managerName(no: string) { const e = this.emps().find(x => x.empNo === no); return e ? this.nm(e) : (no || '—'); }
  labelOfTab() { return REF_KINDS.find(k => k.kind === this.tab())?.labelKey ?? 'hr.org.newRef'; }

  openUnit(rec: HrRecord | null, parent: string) {
    this.formError = ''; this.editId = rec?.id ?? '';
    this.unitForm = rec ? { code: rec.code, name: rec.data['name'], nameAr: rec.data['nameAr'] ?? '', level: rec.data['level'] ?? 'department', parent: rec.data['parent'] ?? '', manager: rec.data['manager'] ?? '' }
      : { code: '', name: '', nameAr: '', level: parent ? this.nextLevel(parent) : 'division', parent, manager: '' };
  }
  private nextLevel(parentCode: string) {
    const p = this.units().find(u => u.code === parentCode); const i = UNIT_LEVELS.indexOf(p?.data['level'] ?? 'division');
    return UNIT_LEVELS[Math.min(UNIT_LEVELS.length - 1, i + 1)];
  }
  saveUnit() {
    const f = this.unitForm;
    if (!String(f.code ?? '').trim() || !String(f.name ?? '').trim()) { this.formError = this.i18n.t('hr.err.required'); return; }
    if (f.parent && f.parent === f.code) { this.formError = this.i18n.t('hr.org.selfParent'); return; }
    this.persist('unit', this.editId, { code: f.code.trim(), data: { name: f.name.trim(), nameAr: (f.nameAr ?? '').trim(), level: f.level, parent: f.parent, manager: f.manager } }, () => this.unitForm = null);
  }

  openRef(rec: HrRecord | null) {
    this.formError = ''; this.editId = rec?.id ?? '';
    this.refForm = rec ? { code: rec.code, name: rec.data['name'], nameAr: rec.data['nameAr'] ?? '', days: rec.data['days'] ?? 0 } : { code: '', name: '', nameAr: '', days: 21 };
  }
  saveRef() {
    const f = this.refForm;
    if (!String(f.code ?? '').trim() || !String(f.name ?? '').trim()) { this.formError = this.i18n.t('hr.err.required'); return; }
    const data: any = { name: f.name.trim(), nameAr: (f.nameAr ?? '').trim() };
    if (this.tab() === 'leavetype') data.days = Number(f.days) || 0;
    this.persist(this.tab() as HrKind, this.editId, { code: f.code.trim(), data }, () => this.refForm = null);
  }

  private persist(kind: HrKind, id: string, body: Partial<HrRecord>, done: () => void) {
    this.saving = true; this.formError = '';
    const call = id ? this.hr.updateRecord(kind, id, body) : this.hr.createRecord(kind, body);
    call.subscribe({
      next: () => { this.saving = false; done(); this.flash(this.i18n.t('hr.saved')); this.reload(); },
      error: e => { this.saving = false; this.formError = e.status === 409 ? this.i18n.t('hr.err.dupCode') : errMsg(e, this.i18n); }
    });
  }

  ask(kind: HrKind, rec: HrRecord) { this.formError = ''; this.deleting = { kind, rec }; }
  doDelete() {
    const d = this.deleting!;
    this.hr.deleteRecord(d.kind, d.rec.id).subscribe({
      next: () => { this.deleting = null; this.flash(this.i18n.t('hr.deleted')); this.reload(); },
      error: e => this.formError = errMsg(e, this.i18n)
    });
  }
  private flash(m: string, bad = false) { this.flashMsg = m; this.flashBad = bad; setTimeout(() => this.flashMsg = '', 3000); }
}
