import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ToastService } from '../core/toast.service';

@Component({
  selector: 'app-toast-host',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="host" aria-live="polite">
      <div class="toast" *ngFor="let t of toasts.toasts()" [class]="t.kind">
        <div class="tx"><b>{{ t.title }}</b><span *ngIf="t.body">{{ t.body }}</span><a *ngIf="t.link" [routerLink]="t.link" (click)="toasts.dismiss(t.id)">→</a></div>
        <button (click)="toasts.dismiss(t.id)" aria-label="Close">×</button>
      </div>
    </div>`,
  styles: [`
    .host { position: fixed; inset-inline-end: 18px; bottom: 18px; z-index: 300; display: flex; flex-direction: column; gap: 10px; max-width: min(380px, calc(100vw - 36px)); }
    .toast { display: flex; gap: 10px; align-items: flex-start; background: var(--surface, #fff); color: var(--text); border: 1px solid var(--border); border-inline-start: 4px solid var(--primary); border-radius: 10px; padding: 12px 14px; box-shadow: 0 10px 30px rgba(0,0,0,.18); }
    .toast.prayer { border-inline-start-color: #059669; } .toast.meeting { border-inline-start-color: #2563eb; }
    .tx { display: flex; flex-direction: column; gap: 4px; flex: 1; font-size: 13px; line-height: 1.5; white-space: pre-line; } .tx b { font-size: 14px; } .tx a { color: var(--primary); font-weight: 600; }
    button { background: none; border: 0; font-size: 20px; line-height: 1; cursor: pointer; color: var(--text-2); }
  `]
})
export class ToastHostComponent { toasts = inject(ToastService); }
