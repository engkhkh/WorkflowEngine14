import { Component, EventEmitter, Input, OnInit, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '../core/translate.pipe';
import { I18nService } from '../core/i18n.service';
import { IconComponent } from '../shared/ui';
import { errMsg } from '../hr/hr-util';
import { CUS_ICONS, CUS_TYPES, CusDef, CusField, CusModule, CustomService } from './custom.service';

/** Edit the name, icon and fields of a custom module (the assistant does the same from a typed sentence). */
@Component({
  selector: 'app-custom-designer',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe, IconComponent],
  template: `
  <div class="modal-scrim" (click)="closed.emit()"><div class="modal wide" (click)="$event.stopPropagation()">
    <div class="modal-head"><h3>{{ (mod ? 'cus.design' : 'cus.newModule') | translate }}</h3><button class="ghost" (click)="closed.emit()"><app-icon name="x"></app-icon></button></div>
    <div class="modal-body">
      <p class="flash bad" *ngIf="error()">{{ error() }}</p>
      <div class="form-grid">
        <div><label class="lbl">{{ 'cus.name' | translate }} *</label><input [(ngModel)]="d.title"></div>
        <div><label class="lbl">{{ 'cus.nameAr' | translate }}</label><input [(ngModel)]="d.titleAr" dir="rtl"></div>
        <div><label class="lbl">{{ 'cus.icon' | translate }}</label><select [(ngModel)]="d.icon"><option *ngFor="let i of icons" [value]="i">{{ i }}</option></select></div>
        <div><label class="lbl">{{ 'cus.color' | translate }}</label><input type="color" [(ngModel)]="d.color"></div>
      </div>
      <h4 class="mt">{{ 'cus.fields' | translate }}</h4>
      <div class="frow" *ngFor="let f of d.fields; let i = index">
        <input [(ngModel)]="f.label" [placeholder]="'cus.fieldName' | translate">
        <input [(ngModel)]="f.labelAr" dir="rtl" [placeholder]="'cus.fieldNameAr' | translate">
        <select [(ngModel)]="f.type"><option *ngFor="let t of types" [value]="t">{{ 'cus.t.' + t | translate }}</option></select>
        <label class="chk"><input type="checkbox" [(ngModel)]="f.required"> {{ 'cus.required' | translate }}</label>
        <input *ngIf="f.type === 'select'" [ngModel]="(f.options || []).join(', ')" (ngModelChange)="f.options = split($event)" [placeholder]="'cus.options' | translate">
        <button class="ghost" (click)="move(i, -1)" [disabled]="i === 0">↑</button><button class="ghost" (click)="move(i, 1)" [disabled]="i === d.fields.length - 1">↓</button>
        <button class="ghost" (click)="d.fields.splice(i, 1)">✕</button>
      </div>
      <button class="mt" (click)="add()"><app-icon name="plus" [size]="14"></app-icon> {{ 'cus.addField' | translate }}</button>
    </div>
    <div class="modal-foot"><span class="grow"></span><button (click)="closed.emit()">{{ 'cal.close' | translate }}</button><button class="primary" [disabled]="busy()" (click)="save()">{{ 'cal.save' | translate }}</button></div>
  </div></div>`,
  styles: [`.wide { max-width: 900px; width: 96vw; } .frow { display: flex; gap: 6px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; } .frow input:not([type=checkbox]) { flex: 1; min-width: 120px; } .chk { display: flex; gap: 4px; align-items: center; font-size: 12px; } .mt { margin-top: 12px; } .grow { flex: 1; }`]
})
export class CustomDesignerComponent implements OnInit {
  @Input() mod: CusModule | null = null;
  @Output() saved = new EventEmitter<CusModule>();
  @Output() closed = new EventEmitter<void>();
  private svc = inject(CustomService); private i18n = inject(I18nService);
  icons = CUS_ICONS; types = CUS_TYPES; error = signal(''); busy = signal(false);
  d: CusDef = { title: '', titleAr: '', icon: 'grid', color: '#6366f1', fields: [{ key: '', label: '', type: 'text', required: true }] };
  ngOnInit() { if (this.mod) this.d = JSON.parse(JSON.stringify(this.mod.def)); }
  add() { this.d.fields.push({ key: '', label: '', type: 'text' } as CusField); }
  move(i: number, n: number) { const f = this.d.fields; [f[i], f[i + n]] = [f[i + n], f[i]]; }
  split(s: string) { return s.split(/[,،;]/).map(x => x.trim()).filter(x => x); }
  save() {
    this.error.set(''); this.busy.set(true);
    const body = { ...this.d, fields: this.d.fields.filter(f => f.label?.trim()) };
    const call = this.mod ? this.svc.update(this.mod.key, body) : this.svc.create(body);
    call.subscribe({ next: m => { this.busy.set(false); this.saved.emit(m); }, error: e => { this.busy.set(false); this.error.set(errMsg(e, this.i18n)); } });
  }
}
