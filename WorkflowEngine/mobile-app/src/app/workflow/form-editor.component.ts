import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonItem, IonInput, IonSelect, IonSelectOption, IonToggle, IonButton, IonIcon, IonLabel } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { trashOutline, addOutline } from 'ionicons/icons';
import { FormDefinition, FormField, FormFieldType } from './workflow.models';

/** Form builder for FormTask / ApprovalTask nodes: title + fields (7 types, dropdown options, required, read-only). */
@Component({
  selector: 'app-wf-form-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, IonItem, IonInput, IonSelect, IonSelectOption, IonToggle, IonButton, IonIcon, IonLabel],
  template: `
    <div *ngIf="form" class="fe">
      <ion-item><ion-input label="Form title" labelPlacement="stacked" [(ngModel)]="form.title" placeholder="e.g. Leave request"></ion-input></ion-item>
      <div class="fld" *ngFor="let f of form.fields; let i = index">
        <div class="row">
          <ion-input label="Key" labelPlacement="stacked" [(ngModel)]="f.key" placeholder="amount"></ion-input>
          <ion-select label="Type" labelPlacement="stacked" interface="action-sheet" [(ngModel)]="f.type">
            <ion-select-option *ngFor="let t of types" [value]="t">{{ t }}</ion-select-option>
          </ion-select>
          <ion-button fill="clear" color="danger" (click)="form.fields.splice(i, 1)"><ion-icon name="trash-outline" slot="icon-only"></ion-icon></ion-button>
        </div>
        <ion-input label="Label shown to the user" labelPlacement="stacked" [(ngModel)]="f.label"></ion-input>
        <ion-toggle [(ngModel)]="f.required">Required</ion-toggle>
        <ion-toggle [(ngModel)]="f.readOnly">Read-only</ion-toggle>
        <div *ngIf="f.type === 'Select'" class="opts">
          <div class="row" *ngFor="let o of f.options; let oi = index">
            <ion-input label="Label" labelPlacement="stacked" [(ngModel)]="o.label"></ion-input>
            <ion-input label="Value" labelPlacement="stacked" [(ngModel)]="o.value"></ion-input>
            <ion-button fill="clear" color="danger" (click)="f.options.splice(oi, 1)"><ion-icon name="trash-outline" slot="icon-only"></ion-icon></ion-button>
          </div>
          <ion-button size="small" fill="outline" (click)="f.options.push({ label: '', value: '' })">+ Option</ion-button>
        </div>
      </div>
      <ion-button size="small" (click)="add()"><ion-icon name="add-outline" slot="start"></ion-icon>Add field</ion-button>
    </div>
  `,
  styles: [`
    .fld { border: 1px solid var(--border); border-radius: 10px; padding: 8px; margin: 8px 0; background: var(--surface-2); }
    .row { display: flex; gap: 6px; align-items: end; }
    .row > * { flex: 1; } .row ion-button { flex: 0 0 auto; }
    .opts { margin-top: 6px; padding-inline-start: 8px; border-inline-start: 2px solid var(--border); }
  `]
})
export class WfFormEditorComponent {
  @Input() form?: FormDefinition;
  types: FormFieldType[] = ['Text', 'TextArea', 'Number', 'Date', 'Select', 'Checkbox', 'Email'];
  constructor() { addIcons({ trashOutline, addOutline }); }
  add() {
    this.form?.fields.push({ id: crypto.randomUUID(), key: '', label: '', type: 'Text', required: false, options: [], readOnly: false } as FormField);
  }
}
