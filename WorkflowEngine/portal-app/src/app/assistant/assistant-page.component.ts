import { Component } from '@angular/core';
import { TranslatePipe } from '../core/translate.pipe';
import { AssistantPanelComponent } from './assistant-panel.component';

@Component({
  selector: 'app-assistant-page',
  standalone: true,
  imports: [TranslatePipe, AssistantPanelComponent],
  template: `
    <div class="page-head">
      <div class="titles">
        <h1>{{ 'ai.title' | translate }}</h1>
        <p>{{ 'ai.sub' | translate }}</p>
      </div>
    </div>
    <div class="card"><app-assistant-panel [full]="true"></app-assistant-panel></div>
  `
})
export class AssistantPageComponent {}
