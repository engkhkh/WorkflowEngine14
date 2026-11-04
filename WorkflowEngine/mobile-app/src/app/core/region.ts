/**
 * Regional defaults - used only to PRE-FILL a new workspace / new setting (currency, tax rate, weekend, country) from the
 * user's own browser region. Every value stays editable (Admin > Organization, POS / hospital setup), nothing is fixed to a country.
 * weekend: 0 = Sunday ... 6 = Saturday.
 */
interface Region { cur: string; vat: number; weekend?: number[]; }
const SAT_SUN = [0, 6], FRI_SAT = [5, 6], FRI = [5];
export const REGIONS: Record<string, Region> = {
  SA: { cur: 'SAR', vat: 15, weekend: FRI_SAT }, AE: { cur: 'AED', vat: 5, weekend: SAT_SUN }, KW: { cur: 'KWD', vat: 0, weekend: FRI_SAT }, QA: { cur: 'QAR', vat: 0, weekend: FRI_SAT },
  BH: { cur: 'BHD', vat: 10, weekend: FRI_SAT }, OM: { cur: 'OMR', vat: 5, weekend: FRI_SAT }, JO: { cur: 'JOD', vat: 16, weekend: FRI_SAT }, LB: { cur: 'LBP', vat: 11, weekend: SAT_SUN },
  EG: { cur: 'EGP', vat: 14, weekend: FRI_SAT }, IQ: { cur: 'IQD', vat: 0, weekend: FRI_SAT }, MA: { cur: 'MAD', vat: 20 }, DZ: { cur: 'DZD', vat: 19, weekend: FRI_SAT }, TN: { cur: 'TND', vat: 19 },
  TR: { cur: 'TRY', vat: 20 }, IL: { cur: 'ILS', vat: 17, weekend: FRI_SAT }, IR: { cur: 'IRR', vat: 10, weekend: FRI }, PK: { cur: 'PKR', vat: 18 }, IN: { cur: 'INR', vat: 18 },
  BD: { cur: 'BDT', vat: 15, weekend: FRI_SAT }, LK: { cur: 'LKR', vat: 18 }, ID: { cur: 'IDR', vat: 11 }, MY: { cur: 'MYR', vat: 8 }, SG: { cur: 'SGD', vat: 9 }, TH: { cur: 'THB', vat: 7 },
  PH: { cur: 'PHP', vat: 12 }, VN: { cur: 'VND', vat: 10 }, CN: { cur: 'CNY', vat: 13 }, JP: { cur: 'JPY', vat: 10 }, KR: { cur: 'KRW', vat: 10 }, AU: { cur: 'AUD', vat: 10 }, NZ: { cur: 'NZD', vat: 15 },
  GB: { cur: 'GBP', vat: 20 }, IE: { cur: 'EUR', vat: 23 }, DE: { cur: 'EUR', vat: 19 }, FR: { cur: 'EUR', vat: 20 }, ES: { cur: 'EUR', vat: 21 }, IT: { cur: 'EUR', vat: 22 }, NL: { cur: 'EUR', vat: 21 },
  BE: { cur: 'EUR', vat: 21 }, PT: { cur: 'EUR', vat: 23 }, AT: { cur: 'EUR', vat: 20 }, GR: { cur: 'EUR', vat: 24 }, FI: { cur: 'EUR', vat: 25 }, CH: { cur: 'CHF', vat: 8.1 }, SE: { cur: 'SEK', vat: 25 },
  NO: { cur: 'NOK', vat: 25 }, DK: { cur: 'DKK', vat: 25 }, PL: { cur: 'PLN', vat: 23 }, CZ: { cur: 'CZK', vat: 21 }, RU: { cur: 'RUB', vat: 20 }, UA: { cur: 'UAH', vat: 20 },
  US: { cur: 'USD', vat: 0 }, CA: { cur: 'CAD', vat: 5 }, MX: { cur: 'MXN', vat: 16 }, BR: { cur: 'BRL', vat: 17 }, AR: { cur: 'ARS', vat: 21 }, CL: { cur: 'CLP', vat: 19 }, CO: { cur: 'COP', vat: 19 },
  ZA: { cur: 'ZAR', vat: 15 }, NG: { cur: 'NGN', vat: 7.5 }, KE: { cur: 'KES', vat: 16 }, GH: { cur: 'GHS', vat: 15 }, ET: { cur: 'ETB', vat: 15 }, TZ: { cur: 'TZS', vat: 18 }, SD: { cur: 'SDG', vat: 17 },
};

/** ISO country of the user's browser (e.g. "en-GB" -> GB); '' when it cannot tell. */
export function userRegion(): string {
  try {
    const l = (new (Intl as any).Locale(navigator.language) as any);
    const r = (l.region ?? l.maximize?.().region ?? '') as string;
    return r.toUpperCase();
  } catch { return ''; }
}
export const defaultCurrency = (): string => REGIONS[userRegion()]?.cur ?? 'USD';
/** default sales-tax / VAT rate to pre-fill; 0 when unknown (the admin sets the real rate) */
export const defaultVat = (): number => REGIONS[userRegion()]?.vat ?? 0;
export const defaultWeekend = (): number[] => REGIONS[userRegion()]?.weekend ?? SAT_SUN;

export const ALL_CURRENCIES = Array.from(new Set(['USD', 'EUR', 'GBP', 'SAR', 'AED', 'KWD', 'QAR', 'BHD', 'OMR', 'JOD', 'EGP', 'MAD', 'TRY', 'PKR', 'INR', 'BDT', 'IDR', 'MYR', 'SGD', 'THB', 'PHP', 'CNY', 'JPY', 'KRW', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'RUB', 'CAD', 'MXN', 'BRL', 'ARS', 'CLP', 'COP', 'ZAR', 'NGN', 'KES', 'GHS', ...Object.values(REGIONS).map(r => r.cur)])).sort();
