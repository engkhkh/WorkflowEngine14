import { I18nService } from '../core/i18n.service';
import { FinRec } from '../core/fin.models';

export { errMsg, todayStr, dateOnly } from '../hr/hr-util';

/** Name of a finance record in the UI language (Arabic name when the UI is Arabic and one exists). */
export function recName(r: FinRec | undefined | null, i18n: I18nService): string {
  if (!r) return '';
  const d = r.data ?? {};
  return (i18n.lang() === 'ar' && d['nameAr']) ? d['nameAr'] : (d['name'] ?? r.code ?? '');
}
/** "1010 · Cash on hand" */
export function recLabel(r: FinRec | undefined | null, i18n: I18nService): string {
  if (!r) return '';
  const n = recName(r, i18n);
  return n && n !== r.code ? `${r.code} · ${n}` : (r.code ?? '');
}
export const findByCode = (list: FinRec[], code: string | null | undefined) => list.find(r => r.code === code);
export const monthOf = (d: string) => (d ?? '').slice(0, 7);
export const thisMonth = () => new Date().toISOString().slice(0, 7);
export const thisYear = () => new Date().getFullYear();
export const startOfYear = () => `${new Date().getFullYear()}-01-01`;

/** Status -> colour family of the shared status pill (approved = green, rejected = red, canceled = grey, pending = blue). */
export function finPill(s: string | null | undefined): 'approved' | 'rejected' | 'pending' | 'canceled' {
  if (['Active', 'Open', 'Posted', 'Paid', 'Approved', 'Issued', 'Matched', 'Reconciled'].includes(s ?? '')) return 'approved';
  if (['Rejected', 'Mismatch', 'Held', 'Overdue'].includes(s ?? '')) return 'rejected';
  if (['Closed', 'Cancelled', 'Inactive', 'Disposed', 'Reversed', 'NoPO'].includes(s ?? '')) return 'canceled';
  return 'pending';
}
