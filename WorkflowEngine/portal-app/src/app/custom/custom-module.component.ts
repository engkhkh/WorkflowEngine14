import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { IconComponent } from '../shared/ui';
import { errMsg } from '../hr/hr-util';
import { CusField, CusModule, CusRecord, CustomService } from './custom.service';
import { CustomDesignerComponent } from './custom-designer.component';

/** List + form of any custom module, generated from its fields. */
@Component({
  selector: 'app-custom-module',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TranslatePipe, IconComponent, CustomDesignerComponent],
  template: `
  <ng-container *ngIf="mod() as m; else missing">
    <div class="page-head"><div class="titles"><h1>{{ svc.title(m) }}</h1><p>{{ 'cus.sub' | translate:{ n: rows().length } }}</p></div></div>
    <div class="bar">
      <input class="search" [placeholder]="'cus.search' | translate" [(ngModel)]="q" (ngModelChange)="load()">
      <span class="grow"></span>
      <button *ngIf="auth.can('cus.design')" (click)="design.set(true)"><app-icon name="settings" [size]="14"></app-icon> {{ 'cus.design' | translate }}</button>
      <button class="primary" *ngIf="auth.can('cus.manage')" (click)="open(null)"><app-icon name="plus" [size]="15"></app-icon> {{ 'cus.new' | translate }}</button>
    </div>
    <p class="flash bad" *ngIf="error() && !form">{{ error() }}</p>
    <div class="card"><div class="table-wrap"><table class="data">
      <thead><tr><th>#</th><th *ngFor="let f of cols()">{{ svc.label(f) }}</th></tr></thead>
      <tbody>
        <tr *ngFor="let r of rows()" class="click" (click)="open(r)"><td><b>{{ r.code }}</b></td><td *ngFor="let f of cols()">{{ show(f, r) }}</td></tr>
        <tr *ngIf="!rows().length"><td [attr.colspan]="cols().length + 1" class="dim">{{ 'cus.none' | translate }}</td></tr>
      </tbody></table></div></div>

    <div class="modal-scrim" *ngIf="form" (click)="form = null"><div class="modal" (click)="$event.stopPropagation()">
      <div class="modal-head"><h3>{{ editing ? editing.code : ('cus.new' | translate) }}</h3><button class="ghost" (click)="form = null"><app-icon name="x"></app-icon></button></div>
      <div class="modal-body"><p class="flash bad" *ngIf="error()">{{ error() }}</p>
        <div class="form-grid">
          <div *ngFor="let f of m.def.fields" [class.full]="f.type === 'textarea'">
            <label class="lbl">{{ svc.label(f) }}<span *ngIf="f.required"> *</span></label>
            <ng-container [ngSwitch]="f.type">
              <textarea *ngSwitchCase="'textarea'" [(ngModel)]="form[f.key]" [disabled]="!canEdit()"></textarea>
              <select *ngSwitchCase="'select'" [(ngModel)]="form[f.key]" [disabled]="!canEdit()"><option value=""></option><option *ngFor="let o of f.options" [value]="o">{{ o }}</option></select>
              <input *ngSwitchCase="'checkbox'" type="checkbox" [(ngModel)]="form[f.key]" [disabled]="!canEdit()">
              <input *ngSwitchCase="'number'" type="number" step="any" [(ngModel)]="form[f.key]" [disabled]="!canEdit()">
              <input *ngSwitchCase="'date'" type="date" [(ngModel)]="form[f.key]" [disabled]="!canEdit()">
              <input *ngSwitchCase="'email'" type="email" [(ngModel)]="form[f.key]" [disabled]="!canEdit()">
              <input *ngSwitchDefault [(ngModel)]="form[f.key]" [disabled]="!canEdit()">
            </ng-container>
          </div>
        </div></div>
      <div class="modal-foot"><button class="danger" *ngIf="editing && canEdit()" (click)="del()">{{ 'cal.delete' | translate }}</button><span class="grow"></span><button (click)="form = null">{{ 'cal.close' | translate }}</button><button class="primary" *ngIf="canEdit()" [disabled]="busy()" (click)="save()">{{ 'cal.save' | translate }}</button></div>
    </div></div>

    <app-custom-designer *ngIf="design()" [mod]="m" (closed)="design.set(false)" (saved)="design.set(false); load()"></app-custom-designer>
  </ng-container>
  <ng-template #missing><div class="card"><div class="card-body"><p class="dim">{{ svc.loaded() ? ('cus.missing' | translate) : ('mus.loading' | translate) }}</p><a routerLink="/custom">← {{ 'module.custom' | translate }}</a></div></div></ng-template>`,
  styles: [`.bar { display: flex; gap: 10px; align-items: center; margin-bottom: 14px; flex-wrap: wrap; } .grow { flex: 1; } .search { min-width: 240px; max-width: 360px; } .dim { color: var(--text-dim); } .click { cursor: pointer; } .modal-foot { display: flex; gap: 8px; align-items: center; } textarea { width: 100%; min-height: 80px; }`]
})
export class CustomModuleComponent implements OnInit {
  auth = inject(AuthService); svc = inject(CustomService); private i18n = inject(I18nService); private route = inject(ActivatedRoute); private router = inject(Router);
  key = signal(''); rows = signal<CusRecord[]>([]); q = ''; error = signal(''); busy = signal(false); design = signal(false);
  form: Record<string, any> | null = null; editing: CusRecord | null = null;
  mod = computed<CusModule | undefined>(() => this.svc.modules().find(m => m.key === this.key()));
  cols = computed<CusField[]>(() => (this.mod()?.def.fields ?? []).slice(0, 6));
  canEdit() { return this.auth.can('cus.manage'); }

  ngOnInit() {
    this.route.paramMap.subscribe(p => { this.key.set(p.get('key') ?? ''); this.rows.set([]); this.load(); });
    if (!this.svc.loaded()) this.svc.load().subscribe({ error: () => {} });
  }
  load() { if (this.key()) this.svc.records(this.key(), this.q).subscribe({ next: l => { this.rows.set(l); this.error.set(''); }, error: e => this.error.set(errMsg(e, this.i18n)) }); }
  show(f: CusField, r: CusRecord): string { const v = r.data[f.key]; return f.type === 'checkbox' ? (v ? '✓' : '') : v == null ? '' : String(v); }
  open(r: CusRecord | null) { this.error.set(''); this.editing = r; this.form = { ...(r?.data ?? {}) }; }
  save() {
    if (!this.form) return; this.busy.set(true); this.error.set('');
    const call = this.editing ? this.svc.saveRecord(this.key(), this.editing.id, this.form) : this.svc.addRecord(this.key(), this.form);
    call.subscribe({ next: () => { this.busy.set(false); this.form = null; this.load(); }, error: e => { this.busy.set(false); this.error.set(errMsg(e, this.i18n)); } });
  }
  del() { if (!this.editing || !confirm(this.i18n.t('cal.confirmDelete'))) return; this.svc.removeRecord(this.key(), this.editing.id).subscribe({ next: () => { this.form = null; this.load(); }, error: e => this.error.set(errMsg(e, this.i18n)) }); }
}
