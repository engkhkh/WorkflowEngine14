import { HttpErrorResponse } from '@angular/common/http';
import { I18nService } from '../core/i18n.service';
import { Employee, HrRecord } from '../core/hr.models';

export const initials = (n: string | null | undefined) => (n ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

/** Name in the UI language (Arabic name when the UI is Arabic and one exists). */
export function empName(e: Pick<Employee, 'fullName' | 'fullNameAr'> | null | undefined, i18n: I18nService): string {
  if (!e) return '';
  return i18n.lang() === 'ar' && e.fullNameAr ? e.fullNameAr : e.fullName;
}

/** Reference record -> display name (UI language). */
export function refLabel(r: HrRecord | undefined, i18n: I18nService): string {
  if (!r) return '';
  const d = r.data ?? {};
  return i18n.lang() === 'ar' && d['nameAr'] ? d['nameAr'] : (d['name'] ?? r.code ?? '');
}

/** Finds the reference record a stored value (code or name) points to. */
export function findRef(list: HrRecord[], value: string | null | undefined): HrRecord | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  return list.find(r => (r.code ?? '').toLowerCase() === v || String(r.data?.['name'] ?? '').toLowerCase() === v);
}

export function errMsg(e: unknown, i18n: I18nService): string {
  const err = e as HttpErrorResponse;
  if (err?.status === 403) return i18n.t('hr.err.forbidden');
  if (err?.status === 0) return i18n.t('hr.err.network');
  const b = err?.error;
  if (typeof b === 'string' && b.length < 200) return b;
  if (b?.title && typeof b.title === 'string') return b.title;
  return i18n.t('hr.err.generic');
}

export const todayStr = () => new Date().toISOString().slice(0, 10);

/** Whole calendar days between two yyyy-mm-dd dates, inclusive. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(from), b = Date.parse(to);
  if (isNaN(a) || isNaN(b) || b < a) return 0;
  return Math.round((b - a) / 86400000) + 1;
}

export const dateOnly = (v: string | null | undefined) => (v ?? '').slice(0, 10);
