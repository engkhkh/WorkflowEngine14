import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../translate.pipe';
import { ApiGateway } from './api-gateway.service';

/** Thin progress bar while calls are running + a notice when the API layer meets a session / permission / connection problem. */
@Component({
  selector: 'app-api-status',
  standalone: true,
  imports: [CommonModule, TranslatePipe],
  template: `
    <div class="bar" *ngIf="gw.busy()"><i></i></div>
    <div class="note" *ngIf="gw.notice() as n" [class]="n.kind" role="status" (click)="gw.dismiss()">{{ 'api.' + n.kind | translate }}</div>
  `,
  styles: [`
    .bar { position: fixed; inset: 0 0 auto 0; height: 3px; z-index: 3000; overflow: hidden; pointer-events: none; }
    .bar i { display: block; height: 100%; width: 40%; background: var(--primary, #4338ca); animation: slide 1s ease-in-out infinite; }
    @keyframes slide { from { transform: translateX(-100%); } to { transform: translateX(260%); } }
    :host-context([dir=rtl]) .bar i { animation-direction: reverse; }
    .note { position: fixed; z-index: 3000; bottom: 18px; inset-inline: 16px; margin-inline: auto; width: fit-content; max-width: calc(100vw - 32px); padding: 10px 16px; border-radius: 10px;
      background: #1f2937; color: #fff; font-size: 13.5px; box-shadow: 0 8px 28px rgba(0,0,0,.3); cursor: pointer; }
    .note.session, .note.forbidden { background: #92400e; } .note.offline, .note.server { background: #991b1b; }
  `]
})
export class ApiStatusComponent { gw = inject(ApiGateway); }
