import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ErpContextService } from '../core/erp-context.service';
import { ErpService } from '../core/erp.service';
import { ErpModule, ErpRec, CRM_SOURCES_DEFAULT, CRM_STAGES_DEFAULT } from '../core/erp.models';
import { I18nService } from '../core/i18n.service';
import { TranslatePipe } from '../core/translate.pipe';
import { errMsg } from '../hr/hr-util';

/** Module defaults (stored in the database): costing overhead / stock rules for Manufacturing, pipeline stages / lead sources for CRM. */
@Component({
  selector: 'app-erp-setup',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  template: `
    <h3 class="h">{{ 'erp.setup.title' | translate }}</h3>
    <div class="card pad">
      <div class="form-grid" *ngIf="module === 'mfg'">
        <div><label class="lbl">{{ 'mfg.setup.overhead' | translate }}</label><input type="number" step="0.01" [(ngModel)]="f['overheadPct']" /><small class="dim">{{ 'mfg.setup.overheadHint' | translate }}</small></div>
        <label class="chk"><input type="checkbox" [(ngModel)]="f['allowNegativeStock']" /> {{ 'mfg.setup.negStock' | translate }}</label>
      </div>
      <div class="form-grid" *ngIf="module === 'proc'">
        <div><label class="lbl">{{ 'proc.setup.overReceipt' | translate }}</label><input type="number" step="0.01" [(ngModel)]="f['overReceiptPct']" /><small class="dim">{{ 'proc.setup.overReceiptHint' | translate }}</small></div>
        <div><label class="lbl">{{ 'crm.q.tax' | translate }}</label><input type="number" step="0.01" [(ngModel)]="f['taxPct']" /></div>
      </div>
      <div class="form-grid" *ngIf="module === 'wh'"><label class="chk"><input type="checkbox" [(ngModel)]="f['allowNegativeStock']" /> {{ 'mfg.setup.negStock' | translate }}</label></div>
      <div class="form-grid" *ngIf="module === 'ast'"><div class="full"><label class="lbl">{{ 'ast.setup.categories' | translate }}</label><input [(ngModel)]="f['categories']" /></div></div>
      <div class="form-grid" *ngIf="module === 'pay'">
        <div><label class="lbl">{{ 'pay.setup.expense' | translate }}</label><select [(ngModel)]="f['expenseAccount']"><option value="">—</option><option *ngFor="let a of accounts()" [value]="a.code">{{ a.code }} · {{ a.name }}</option></select></div>
        <div><label class="lbl">{{ 'pay.setup.payable' | translate }}</label><select [(ngModel)]="f['payableAccount']"><option value="">—</option><option *ngFor="let a of accounts()" [value]="a.code">{{ a.code }} · {{ a.name }}</option></select></div>
        <div><label class="lbl">{{ 'pay.setup.deduction' | translate }}</label><select [(ngModel)]="f['deductionAccount']"><option value="">—</option><option *ngFor="let a of accounts()" [value]="a.code">{{ a.code }} · {{ a.name }}</option></select></div>
      </div>
      <div class="form-grid" *ngIf="module === 'epm'"><div><label class="lbl">{{ 'epm.setup.year' | translate }}</label><input [(ngModel)]="f['year']" /></div></div>
      <div class="form-grid" *ngIf="module === 'crm'">
        <div class="full"><label class="lbl">{{ 'crm.setup.stages' | translate }}</label><input [(ngModel)]="f['stages']" /><small class="dim">{{ 'crm.setup.stagesHint' | translate }}</small></div>
        <div class="full"><label class="lbl">{{ 'crm.setup.sources' | translate }}</label><input [(ngModel)]="f['sources']" /></div>
        <div><label class="lbl">{{ 'crm.setup.tax' | translate }}</label><input type="number" step="0.01" [(ngModel)]="f['taxPct']" /></div>
      </div>
      <p class="flash good" *ngIf="msg">{{ msg }}</p><p class="flash bad" *ngIf="error">{{ error }}</p>
      <button class="primary" (click)="save()">{{ 'admin.save' | translate }}</button>
    </div>
  `,
  styles: [`.h { margin: 0 0 10px; font-size: 14px; } .pad { padding: 16px; display: grid; gap: 12px; max-width: 760px; } .chk { display: flex; gap: 8px; align-items: center; padding-top: 22px; } .chk input { width: auto; } .full { grid-column: 1 / -1; } small.dim { display: block; margin-top: 3px; }`]
})
export class ErpSetupComponent {
  private erp = inject(ErpService); private ctx = inject(ErpContextService); private i18n = inject(I18nService);
  module = inject(ActivatedRoute).snapshot.data['module'] as ErpModule;
  rec: ErpRec | null = null; msg = ''; error = '';
  accounts = signal<{ code: string; name: string }[]>([]);
  f: Record<string, any> = this.defaults();
  private defaults(): Record<string, any> {
    switch (this.module) {
      case 'mfg': return { overheadPct: 15, allowNegativeStock: false };
      case 'proc': return { overReceiptPct: 0, taxPct: 15 };
      case 'wh': return { allowNegativeStock: false };
      case 'ast': return { categories: 'Vehicle, Machinery, IT, Furniture, Building' };
      case 'pay': return { expenseAccount: '', payableAccount: '', deductionAccount: '' };
      case 'epm': return { year: String(new Date().getFullYear()) };
      default: return { stages: CRM_STAGES_DEFAULT.join(', '), sources: CRM_SOURCES_DEFAULT.join(', '), taxPct: 15 };
    }
  }
  constructor() {
    if (this.module === 'pay') this.erp.lookup('pay', 'accounts').subscribe(a => this.accounts.set(a));
    effect(() => {
      const c = this.ctx.company();
      this.erp.records(this.module, 'setting', { company: c }).subscribe(l => { this.rec = l.find(s => s.code === 'defaults') ?? null; this.f = { ...this.defaults(), ...(this.rec?.data ?? {}) }; });
    });
  }
  save() {
    this.error = '';
    const data = { ...this.f };
    for (const k of ['overheadPct', 'taxPct', 'overReceiptPct']) if (k in data) data[k] = Number(data[k]) || 0;
    const req = this.rec ? this.erp.update(this.module, 'setting', this.rec.id, { ...this.rec, data }) : this.erp.create(this.module, 'setting', { code: 'defaults', company: this.ctx.company(), data });
    req.subscribe({ next: r => { this.rec = r; this.msg = this.i18n.t('hr.saved'); setTimeout(() => this.msg = '', 2500); }, error: e => this.error = errMsg(e, this.i18n) });
  }
}
