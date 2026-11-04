import { Injectable, signal } from '@angular/core';

export interface Toast { id: number; title: string; body?: string; kind: 'info' | 'prayer' | 'meeting'; link?: string; }

/** Small in-page notices (prayer / meeting reminders). Stay until closed or after `ms`. */
@Injectable({ providedIn: 'root' })
export class ToastService {
  toasts = signal<Toast[]>([]);
  private n = 0;
  add(t: Omit<Toast, 'id'>, ms = 60000) {
    const id = ++this.n;
    this.toasts.update(l => [...l.slice(-3), { ...t, id }]);
    if (ms > 0) setTimeout(() => this.dismiss(id), ms);
  }
  dismiss(id: number) { this.toasts.update(l => l.filter(x => x.id !== id)); }
}
