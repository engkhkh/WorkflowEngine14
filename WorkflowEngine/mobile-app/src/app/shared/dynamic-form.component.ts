import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonList, IonItem, IonInput, IonTextarea, IonSelect, IonSelectOption, IonCheckbox } from '@ionic/angular/standalone';
import { FormDefinition } from '../core/models';
import { I18nService } from '../core/i18n.service';

@Component({
  selector: 'app-dynamic-form',
  standalone: true,
  imports: [CommonModule, FormsModule, IonList, IonItem, IonInput, IonTextarea, IonSelect, IonSelectOption, IonCheckbox],
  template: `
    <ion-list *ngIf="form" class="boxed" lines="full">
      <ion-item *ngFor="let f of form.fields" [class.ro]="f.readOnly">
        <ion-input *ngIf="f.type === 'Text' || f.type === 'Email' || f.type === 'Number' || f.type === 'Date'"
                   [type]="inputType(f.type)" [label]="label(f)" labelPlacement="stacked" [placeholder]="f.placeholder || ''"
                   [readonly]="f.readOnly" [(ngModel)]="values[f.key]"></ion-input>

        <ion-textarea *ngIf="f.type === 'TextArea'" [label]="label(f)" labelPlacement="stacked" [autoGrow]="true"
                      [readonly]="f.readOnly" [(ngModel)]="values[f.key]"></ion-textarea>

        <ion-select *ngIf="f.type === 'Select'" [label]="label(f)" labelPlacement="stacked" interface="action-sheet"
                    [disabled]="f.readOnly" [(ngModel)]="values[f.key]" [placeholder]="i18n.t('common.select')">
          <ion-select-option *ngFor="let o of f.options" [value]="o.value">{{ o.label }}</ion-select-option>
        </ion-select>

        <ion-checkbox *ngIf="f.type === 'Checkbox'" [disabled]="f.readOnly" [(ngModel)]="values[f.key]" labelPlacement="end" justify="start">
          {{ f.label }}
        </ion-checkbox>
      </ion-item>
    </ion-list>
  `,
  styles: [`.ro { --background: var(--surface-2); }`]
})
export class DynamicFormComponent {
  @Input() form: FormDefinition | undefined;
  @Input() values: Record<string, any> = {};
  constructor(public i18n: I18nService) {}

  label(f: { label: string; required: boolean; readOnly: boolean }) { return f.label + (f.required && !f.readOnly ? ' *' : ''); }
  inputType(t: string): 'text' | 'email' | 'number' | 'date' {
    return t === 'Email' ? 'email' : t === 'Number' ? 'number' : t === 'Date' ? 'date' : 'text';
  }
}
