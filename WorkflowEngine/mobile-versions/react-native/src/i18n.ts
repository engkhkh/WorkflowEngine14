import i18n from './data/i18n.json';

export type Lang = 'en' | 'ar';
const dict = i18n as Record<Lang, Record<string, string>>;

export function translate(lang: Lang, key: string, vars?: Record<string, string>): string {
  let s = dict[lang][key] ?? dict.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace('{' + k + '}', v);
  return s;
}
