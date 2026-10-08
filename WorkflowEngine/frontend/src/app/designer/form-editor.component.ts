import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { FormDefinition, FormField, FormFieldType } from '../core/models/workflow.models';

@Component({
  selector: 'app-form-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="form-editor" *ngIf="form">
      <label class="field-label">Form Title</label>
      <input [(ngModel)]="form.title" placeholder="e.g. Leave Request" />

      <div class="fields">
        <div class="field-row" *ngFor="let f of form.fields; let i = index">
          <div class="field-row-top">
            <input class="key" [(ngModel)]="f.key" placeholder="key (e.g. amount)" />
            <select [(ngModel)]="f.type">
              <option value="Text">Text</option>
              <option value="TextArea">Text Area</option>
              <option value="Number">Number</option>
              <option value="Date">Date</option>
              <option value="Select">Dropdown</option>
              <option value="Checkbox">Checkbox</option>
              <option value="Email">Email</option>
            </select>
            <button class="danger" (click)="remove(i)">✕</button>
          </div>
          <input class="label" [(ngModel)]="f.label" placeholder="Field label shown to user" />
          <div class="field-row-bottom">
            <label class="chk"><input type="checkbox" [(ngModel)]="f.required" /> Required</label>
            <label class="chk"><input type="checkbox" [(ngModel)]="f.readOnly" /> Read-only</label>
          </div>
          <div *ngIf="f.type === 'Select'" class="options">
            <div *ngFor="let o of f.options; let oi = index" class="option-row">
              <input [(ngModel)]="o.label" placeholder="Label" />
              <input [(ngModel)]="o.value" placeholder="Value" />
              <button class="danger" (click)="removeOption(f, oi)">✕</button>
            </div>
            <button (click)="addOption(f)">+ Option</button>
          </div>
        </div>
      </div>

      <button class="primary" (click)="addField()">+ Add Field</button>
    </div>
  `,
  styles: [`
    .form-editor { display: flex; flex-direction: column; gap: 8px; }
    .field-label { font-size: 11px; color: var(--text-dim); margin-top: 6px; }
    .fields { display: flex; flex-direction: column; gap: 10px; margin: 8px 0; }
    .field-row { background: var(--panel-2); border: 1px solid var(--border); border-radius: 8px; padding: 10px; display: flex; flex-direction: column; gap: 6px; }
    .field-row-top { display: flex; gap: 6px; }
    .field-row-top .key { flex: 1; }
    .field-row-top select { width: 120px; }
    .field-row-bottom { display: flex; gap: 14px; }
    .chk { font-size: 11px; color: var(--text-dim); display: flex; align-items: center; gap: 4px; }
    .chk input { width: auto; }
    .options { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; padding-left: 8px; border-left: 2px solid var(--border); }
    .option-row { display: flex; gap: 6px; }
  `]
})
export class FormEditorComponent {
  @Input() form!: FormDefinition;

  addField() {
    const field: FormField = {
      id: crypto.randomUUID(),
      key: 'field' + (this.form.fields.length + 1),
      label: 'New Field',
      type: 'Text' as FormFieldType,
      required: false,
      readOnly: false,
      options: []
    };
    this.form.fields.push(field);
  }

  remove(i: number) {
    this.form.fields.splice(i, 1);
  }

  addOption(f: FormField) {
    f.options.push({ label: 'Option', value: 'value' });
  }

  removeOption(f: FormField, i: number) {
    f.options.splice(i, 1);
  }
}
