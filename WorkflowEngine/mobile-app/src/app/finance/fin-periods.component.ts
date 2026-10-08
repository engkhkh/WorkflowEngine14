import { Component, Input, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../core/auth.service';
import { ErpContextService } from '../core/erp-context.service';
import { FinService } from '../core/fin.service';
import { I18nService } from '../core/i18n.service';
import { FinRec } from '../core/fin.models';
import { TranslatePipe } from '../core/translate.pipe';
import { CrudAction, CrudField, FinCrudComponent } from './fin-crud.component';
import { errMsg, thisYear } from './fin-util';

/** Accounting periods of the selected company. Closing / reopening needs finance.gl.approve; a closed period rejects postings. */
@Component({
  selector: 'app-fin-periods',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, FinCrudComponent],
  template: `
    <p class="dim lead">{{ 'fin.per.hint' | translate }}</p>
    <p class="flash bad" *ngIf="error">{{ error }}</p>
    <app-fin-crud #crud kind="period" [fields]="fields" [company]="ctx.company()" [canManage]="auth.can('finance.gl.manage')" [actions]="actions"
                  newLabel="fin.per.new" emptyKey="fin.per.none">
      <span bar class="inl" *ngIf="auth.can('finance.gl.manage')">
        <input class="yr" type="number" [(ngModel)]="year" />
        <button (click)="generate()" [disabled]="busy">{{ 'fin.per.generate' | translate }}</button>
      </span>
    </app-fin-crud>
  `,
  styles: [`.lead { margin: 0 0 12px; font-size: 13px; } .yr { width: 90px; } .inl { display: inline-flex; gap: 8px; align-items: center; }`]
})
export class FinPeriodsComponent {
  auth = inject(AuthService); ctx = inject(ErpContextService); private fin = inject(FinService); private i18n = inject(I18nService);
  @ViewChild('crud') crud!: FinCrudComponent;
  year = thisYear(); busy = false; error = '';
  fields: CrudField[] = [
    { key: 'code', label: 'fin.per.code', required: true, table: true, lockOnEdit: true, hint: 'fin.per.codeHint' },
    { key: 'status', label: 'fin.f.status', type: 'status', table: true, def: 'Open', options: () => ['Open', 'Closed'].map(v => ({ value: v, label: this.i18n.t('fin.st.' + v) })) },
  ];
  actions: CrudAction[] = [
    { label: 'fin.per.close', show: r => r.status !== 'Closed' && this.auth.can('finance.gl.approve'), run: r => this.setStatus(r, 'Closed') },
    { label: 'fin.per.reopen', show: r => r.status === 'Closed' && this.auth.can('finance.gl.approve'), run: r => this.setStatus(r, 'Open') },
  ];
  setStatus(r: FinRec, status: string) {
    this.error = '';
    this.fin.update('period', r.id, { status, data: r.data }).subscribe({ next: () => this.crud.reload(), error: e => this.error = errMsg(e, this.i18n) });
  }
  generate() {
    this.busy = true; this.error = '';
    const have = new Set(this.crud.all().map(p => p.code));
    const todo = Array.from({ length: 12 }, (_, i) => `${this.year}-${String(i + 1).padStart(2, '0')}`).filter(c => !have.has(c));
    const next = (i: number) => {
      if (i >= todo.length) { this.busy = false; this.crud.reload(); return; }
      this.fin.create('period', { code: todo[i], company: this.ctx.company(), status: 'Open', data: {} }).subscribe({ next: () => next(i + 1), error: e => { this.busy = false; this.error = errMsg(e, this.i18n); this.crud.reload(); } });
    };
    next(0);
  }
}
