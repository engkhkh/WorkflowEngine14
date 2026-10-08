import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FormDefinition } from '../core/models/workflow.models';

@Component({
  selector: 'app-dynamic-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="dyn-form" *ngIf="form">
      <h3 *ngIf="form.title">{{ form.title }}</h3>
      <div class="field" *ngFor="let f of form.fields">
        <label>{{ f.label }} <span class="req" *ngIf="f.required">*</span></label>

        <input *ngIf="f.type === 'Text' || f.type === 'Email'"
               [type]="f.type === 'Email' ? 'email' : 'text'"
               [placeholder]="f.placeholder || ''"
               [readOnly]="f.readOnly"
               [(ngModel)]="values[f.key]" />

        <input *ngIf="f.type === 'Number'" type="number"
               [readOnly]="f.readOnly"
               [(ngModel)]="values[f.key]" />

        <input *ngIf="f.type === 'Date'" type="date"
               [readOnly]="f.readOnly"
               [(ngModel)]="values[f.key]" />

        <textarea *ngIf="f.type === 'TextArea'" rows="3"
               [readOnly]="f.readOnly"
               [(ngModel)]="values[f.key]"></textarea>

        <select *ngIf="f.type === 'Select'" [disabled]="f.readOnly" [(ngModel)]="values[f.key]">
          <option value="" disabled>Select…</option>
          <option *ngFor="let o of f.options" [value]="o.value">{{ o.label }}</option>
        </select>

        <label class="chk" *ngIf="f.type === 'Checkbox'">
          <input type="checkbox" [disabled]="f.readOnly" [(ngModel)]="values[f.key]" />
          {{ f.placeholder || 'Yes' }}
        </label>
      </div>
    </div>
  `,
  styles: [`
    .dyn-form { display: flex; flex-direction: column; gap: 12px; }
    h3 { margin: 0 0 4px; font-size: 14px; }
    .field { display: flex; flex-direction: column; gap: 4px; }
    label { font-size: 12px; color: var(--text-dim); }
    .req { color: var(--red); }
    .chk { display: flex; align-items: center; gap: 6px; }
    .chk input { width: auto; }
  `]
})
export class DynamicFormComponent {
  @Input() form: FormDefinition | undefined;
  @Input() values: Record<string, any> = {};
}
