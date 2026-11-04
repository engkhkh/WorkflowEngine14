import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonSelect, IonSelectOption } from '@ionic/angular/standalone';
import { I18nService } from '../core/i18n.service';

/** Language chooser (all 7 languages by their own names) as an action sheet. */
@Component({
  selector: 'app-lang-select',
  standalone: true,
  imports: [CommonModule, IonSelect, IonSelectOption],
  template: `
    <ion-select [label]="label" [labelPlacement]="label ? 'start' : undefined" aria-label="Language" interface="action-sheet" [interfaceOptions]="{ header: i18n.t('lang.title') }"
                [value]="i18n.lang()" (ionChange)="i18n.setLang($any($event).detail.value)">
      <ion-select-option *ngFor="let l of i18n.languages" [value]="l.code">{{ l.native }}</ion-select-option>
    </ion-select>
  `,
  styles: [`:host { display: block; } ion-select { min-height: 36px; }`]
})
export class LangSelectComponent {
  @Input() label = '';
  constructor(public i18n: I18nService) {}
}
