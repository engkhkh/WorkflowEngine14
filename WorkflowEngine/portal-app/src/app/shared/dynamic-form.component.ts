import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FormDefinition } from '../core/models';
import { TranslatePipe } from '../core/translate.pipe';

@Component({
  selector: 'app-dynamic-form',
  standalone: true,
  imports: [CommonModule, FormsModule, TranslatePipe],
  template: `
    <div class="dyn-form" *ngIf="form">
      <div class="field" *ngFor="let f of form.fields" [class.wide]="f.type === 'TextArea'">
        <label class="lbl">{{ f.label }} <span class="req" *ngIf="f.required && !f.readOnly">*</span></label>

        <input *ngIf="f.type === 'Text' || f.type === 'Email'"
               [type]="f.type === 'Email' ? 'email' : 'text'" [placeholder]="f.placeholder || ''"
               [readOnly]="f.readOnly" [(ngModel)]="values[f.key]" />

        <input *ngIf="f.type === 'Number'" type="number" [readOnly]="f.readOnly" [(ngModel)]="values[f.key]" />
        <input *ngIf="f.type === 'Date'" type="date" [readOnly]="f.readOnly" [(ngModel)]="values[f.key]" />
        <textarea *ngIf="f.type === 'TextArea'" rows="3" [readOnly]="f.readOnly" [(ngModel)]="values[f.key]"></textarea>

        <select *ngIf="f.type === 'Select'" [disabled]="f.readOnly" [(ngModel)]="values[f.key]">
          <option [ngValue]="undefined" disabled>{{ 'common.select' | translate }}</option>
          <option *ngFor="let o of f.options" [value]="o.value">{{ o.label }}</option>
        </select>

        <label class="chk" *ngIf="f.type === 'Checkbox'">
          <input type="checkbox" [disabled]="f.readOnly" [(ngModel)]="values[f.key]" />
          {{ f.placeholder || ('common.yes' | translate) }}
        </label>
      </div>
    </div>
  `,
  styles: [`
    .dyn-form { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
    .field { display: flex; flex-direction: column; }
    .field.wide { grid-column: 1 / -1; }
    .req { color: var(--bad); }
    .chk { display: flex; align-items: center; gap: 8px; font-size: 13px; padding-top: 6px; }
  `]
})
export class DynamicFormComponent {
  @Input() form: FormDefinition | undefined;
  @Input() values: Record<string, any> = {};
}
