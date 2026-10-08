import { Component, Input, Pipe, PipeTransform } from '@angular/core';
import { I18nService } from '../core/i18n.service';

/** Currency/number formatting that follows the UI language. `compact` = 12.4K style. */
@Pipe({ name: 'money', standalone: true, pure: false })
export class MoneyPipe implements PipeTransform {
  constructor(private i18n: I18nService) {}
  transform(value: number | null | undefined, currency = 'SAR', compact = false): string {
    if (value === null || value === undefined || isNaN(value)) return '—';
    try {
      return new Intl.NumberFormat(this.i18n.locale, {
        style: 'currency', currency, notation: compact ? 'compact' : 'standard',
        maximumFractionDigits: compact ? 1 : 2, minimumFractionDigits: compact ? 0 : 2,
      }).format(value);
    } catch {
      return `${value.toFixed(2)} ${currency}`;
    }
  }
}

@Pipe({ name: 'num', standalone: true, pure: false })
export class NumPipe implements PipeTransform {
  constructor(private i18n: I18nService) {}
  transform(value: number | null | undefined, digits = 0): string {
    if (value === null || value === undefined || isNaN(value)) return '—';
    return new Intl.NumberFormat(this.i18n.locale, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
  }
}

@Pipe({ name: 'ldate', standalone: true, pure: false })
export class LocalDatePipe implements PipeTransform {
  constructor(private i18n: I18nService) {}
  transform(value: Date | string | null | undefined, style: 'date' | 'datetime' | 'short' = 'date'): string {
    if (!value) return '—';
    const d = typeof value === 'string' ? new Date(value) : value;
    const opts: Intl.DateTimeFormatOptions = style === 'datetime'
      ? { dateStyle: 'medium', timeStyle: 'short' }
      : style === 'short' ? { month: 'short', day: 'numeric' } : { dateStyle: 'medium' };
    return new Intl.DateTimeFormat(this.i18n.locale, opts).format(d);
  }
}

const ICONS: Record<string, string> = {
  'grid': 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  'check-square': 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  'file': 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  'send': 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
  'bar-chart': 'M12 20V10M18 20V4M6 20v-4',
  'sparkles': 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9zM5 2l.6 1.4L7 4l-1.4.6L5 6l-.6-1.4L3 4l1.4-.6z',
  'trending-up': 'M23 6l-9.5 9.5-5-5L1 18M17 6h6v6',
  'cart': 'M9 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM20 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6',
  'box': 'M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7zM3.3 7L12 12l8.7-5M12 22V12',
  'wallet': 'M21 12V7H5a2 2 0 0 1 0-4h14v4M3 5v14a2 2 0 0 0 2 2h16v-5M18 12a2 2 0 0 0 0 4h4v-4z',
  'users': 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  'settings': 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  'search': 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  'bell': 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  'globe': 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z',
  'moon': 'M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z',
  'sun': 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  'log-out': 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  'plus': 'M12 5v14M5 12h14',
  'chevron': 'M9 18l6-6-6-6',
  'menu': 'M3 12h18M3 6h18M3 18h18',
  'x': 'M18 6L6 18M6 6l12 12',
  'clock': 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  'alert': 'M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  'check': 'M20 6L9 17l-5-5',
  'download': 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  'printer': 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
  'refresh': 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.8-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15',
  'building': 'M3 21h18M5 21V7l8-4v18M19 21V11l-6-4M9 9h.01M9 13h.01M9 17h.01',
  'book': 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
  'arrow-right': 'M5 12h14M12 5l7 7-7 7',
  'palette': 'M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4.5 4H15a2 2 0 0 0-1.4 3.4c.5.5.6 1.1.4 1.6-.3.8-1 1-2 1zM7.5 11.5h.01M10.5 7.5h.01M15.5 7.5h.01M18 11.5h.01',
  'shield': 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  'edit': 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  'key': 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4',
  'git-branch': 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
  'layers': 'M12 2L2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  'trash': 'M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
};

@Component({
  selector: 'app-icon',
  standalone: true,
  template: `<svg [attr.width]="size" [attr.height]="size" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    [attr.stroke-width]="stroke" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="path"></path></svg>`,
  styles: [':host{display:inline-flex;line-height:0;flex-shrink:0}']
})
export class IconComponent {
  @Input() name = 'grid';
  @Input() size = 18;
  @Input() stroke = 1.8;
  get path() { return ICONS[this.name] ?? ICONS['grid']; }
}

/** Status pill used everywhere a document status is shown. */
@Component({
  selector: 'app-status',
  standalone: true,
  template: `<span class="pill" [class]="status"><i></i>{{ label }}</span>`,
  styles: [`
    .pill { display:inline-flex; align-items:center; gap:6px; font-size:11.5px; font-weight:600; padding:3px 10px 3px 8px; border-radius:999px; white-space:nowrap;
      background: var(--info-soft); color: var(--info); }
    .pill i { width:6px; height:6px; border-radius:50%; background: currentColor; }
    .pill.pending i { animation: pulse 1.6s ease-in-out infinite; }
    .pill.approved { background: var(--ok-soft); color: var(--ok); }
    .pill.rejected { background: var(--bad-soft); color: var(--bad); }
    .pill.canceled { background: var(--muted-soft); color: var(--muted); }
    @keyframes pulse { 50% { opacity: .35; } }
  `]
})
export class StatusComponent {
  @Input() status: string = 'pending';
  @Input() label = '';
}
