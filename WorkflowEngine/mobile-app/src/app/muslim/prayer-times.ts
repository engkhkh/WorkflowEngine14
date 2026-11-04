/**
 * Prayer times by the astronomical method (the "PrayTimes" algorithm): the sun's position gives noon, sunrise and sunset;
 * Fajr and Isha are the moments the sun is a given angle below the horizon. Works offline for any place on earth.
 * Different authorities use different Fajr / Isha angles, so the method is a setting (and is pre-selected from the country).
 */
export interface Method { id: string; name: string; fajr: number; isha: number | { min: number }; maghrib?: number | { min: number }; }
export const METHODS: Method[] = [
  { id: 'mwl', name: 'Muslim World League', fajr: 18, isha: 17 },
  { id: 'isna', name: 'ISNA (North America)', fajr: 15, isha: 15 },
  { id: 'egypt', name: 'Egyptian General Authority', fajr: 19.5, isha: 17.5 },
  { id: 'makkah', name: 'Umm al-Qura (Makkah)', fajr: 18.5, isha: { min: 90 } },
  { id: 'karachi', name: 'Univ. of Islamic Sciences, Karachi', fajr: 18, isha: 18 },
  { id: 'tehran', name: 'Institute of Geophysics, Tehran', fajr: 17.7, isha: 14, maghrib: 4.5 },
  { id: 'jafari', name: 'Shia Ithna-Ashari (Jafari)', fajr: 16, isha: 14, maghrib: 4 },
  { id: 'gulf', name: 'Gulf Region', fajr: 19.5, isha: { min: 90 } },
  { id: 'dubai', name: 'UAE (Dubai)', fajr: 18.2, isha: 18.2 },
  { id: 'kuwait', name: 'Kuwait', fajr: 18, isha: 17.5 },
  { id: 'qatar', name: 'Qatar', fajr: 18, isha: { min: 90 } },
  { id: 'singapore', name: 'Singapore / Indonesia / Malaysia', fajr: 20, isha: 18 },
  { id: 'turkey', name: 'Turkey (Diyanet)', fajr: 18, isha: 17 },
  { id: 'france', name: 'France (UOIF)', fajr: 12, isha: 12 },
  { id: 'morocco', name: 'Morocco', fajr: 19, isha: 17 },
];
export const method = (id: string) => METHODS.find(m => m.id === id) ?? METHODS[0];

/** default calculation method per country (ISO-3166 alpha-2) */
const BY_COUNTRY: Record<string, string> = {
  SA: 'makkah', YE: 'makkah', BH: 'makkah', OM: 'makkah', AE: 'dubai', KW: 'kuwait', QA: 'qatar',
  EG: 'egypt', SD: 'egypt', LY: 'egypt', SY: 'egypt', LB: 'egypt', IQ: 'egypt', JO: 'egypt', PS: 'egypt', SO: 'egypt',
  IR: 'tehran', TR: 'turkey', PK: 'karachi', IN: 'karachi', BD: 'karachi', AF: 'karachi', LK: 'karachi',
  SG: 'singapore', MY: 'singapore', ID: 'singapore', BN: 'singapore', MA: 'morocco', FR: 'france', US: 'isna', CA: 'isna',
};
export const defaultMethod = (cc: string) => BY_COUNTRY[cc.toUpperCase()] ?? 'mwl';
/** Hanafi schools (shadow = 2x) are the majority in these countries */
export const defaultHanafi = (cc: string) => ['PK', 'IN', 'BD', 'AF', 'UZ', 'KZ'].includes(cc.toUpperCase());

export type Prayer = 'fajr' | 'sunrise' | 'dhuhr' | 'asr' | 'maghrib' | 'isha';
export const PRAYERS: Prayer[] = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];

const R = Math.PI / 180;
const sin = (d: number) => Math.sin(d * R), cos = (d: number) => Math.cos(d * R), tan = (d: number) => Math.tan(d * R);
const arcsin = (x: number) => Math.asin(x) / R, arccos = (x: number) => Math.acos(x) / R, arctan2 = (y: number, x: number) => Math.atan2(y, x) / R, arccot = (x: number) => Math.atan(1 / x) / R;
const fixAngle = (a: number) => { a -= 360 * Math.floor(a / 360); return a; };
const fixHour = (a: number) => { a -= 24 * Math.floor(a / 24); return a; };

function julian(y: number, m: number, d: number) {
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
}
function sunPosition(jd: number) {
  const D = jd - 2451545.0;
  const g = fixAngle(357.529 + 0.98560028 * D), q = fixAngle(280.459 + 0.98564736 * D);
  const L = fixAngle(q + 1.915 * sin(g) + 0.020 * sin(2 * g));
  const e = 23.439 - 0.00000036 * D;
  const RA = arctan2(cos(e) * sin(L), cos(L)) / 15;
  return { decl: arcsin(sin(e) * sin(L)), eqt: q / 15 - fixHour(RA) };
}

export interface Place { lat: number; lng: number; elevation?: number; }
export type HighLat = 'angle' | 'seventh' | 'middle';
export interface Options { method: string; hanafi?: boolean; highLat?: HighLat; adjust?: Partial<Record<Prayer, number>>; }

/** Times of one civil day, in decimal hours of local time (NaN when the sun does not reach the angle). tz = hours east of UTC for that day. */
export function computeHours(year: number, month: number, day: number, place: Place, tz: number, o: Options): Record<Prayer, number> {
  const m = method(o.method), lat = place.lat, lng = place.lng, elev = place.elevation ?? 0;
  const jd = julian(year, month, day) - lng / (15 * 24);
  const midDay = (t: number) => fixHour(12 - sunPosition(jd + t).eqt);
  const angleTime = (angle: number, t: number, ccw: boolean, la = lat) => {
    const decl = sunPosition(jd + t).decl;
    const v = (-sin(angle) - sin(decl) * sin(la)) / (cos(decl) * cos(la));
    return midDay(t) + (arccos(v) / 15) * (ccw ? -1 : 1);
  };
  const asrTime = (factor: number, t: number) => { const decl = sunPosition(jd + t).decl; return angleTime(-arccot(factor + tan(Math.abs(lat - decl))), t, false); };
  const riseSet = 0.0347 * Math.sqrt(Math.max(0, elev)) + 0.833;
  const raw = (la: number) => ({
    fajr: angleTime(m.fajr, 5 / 24, true, la), sunrise: angleTime(riseSet, 6 / 24, true, la), dhuhr: midDay(12 / 24),
    asr: asrTime(o.hanafi ? 2 : 1, 13 / 24), sunset: angleTime(riseSet, 18 / 24, false, la),
    maghrib: typeof m.maghrib === 'number' ? angleTime(m.maghrib, 18 / 24, false, la) : NaN,
    isha: typeof m.isha === 'number' ? angleTime(m.isha, 18 / 24, false, la) : NaN,
  });
  let t = raw(lat);
  // polar summer / winter: the sun may never rise or set -> use the latest latitude where it does (the usual "nearest latitude" rule)
  if (isNaN(t.sunrise) || isNaN(t.sunset)) { const c = raw(Math.sign(lat) * 48.6); t = { ...c, dhuhr: t.dhuhr, asr: isNaN(t.asr) ? c.asr : t.asr }; }
  const maghrib = typeof m.maghrib === 'object' ? t.sunset + m.maghrib.min / 60 : (typeof m.maghrib === 'number' ? t.maghrib : t.sunset);
  let fajr = t.fajr, isha = typeof m.isha === 'object' ? maghrib + m.isha.min / 60 : t.isha;
  // high latitudes: Fajr / Isha may not exist or may be unreasonably far from sunrise / sunset -> angle-based portion of the night
  if (Math.abs(lat) > 48) {
    const night = fixHour(t.sunrise - t.sunset);
    const portion = (a: number) => o.highLat === 'middle' ? night / 2 : o.highLat === 'seventh' ? night / 7 : (a / 60) * night;
    const fajrLimit = portion(m.fajr);   // 'angle': angle/60 of the night, 'seventh': 1/7, 'middle': 1/2
    if (isNaN(fajr) || fixHour(t.sunrise - fajr) > fajrLimit) fajr = t.sunrise - fajrLimit;
    if (typeof m.isha === 'number') { const il = portion(m.isha); if (isNaN(isha) || fixHour(isha - t.sunset) > il) isha = t.sunset + il; }
  }
  const shift = tz - lng / 15;
  const out: Record<Prayer, number> = { fajr, sunrise: t.sunrise, dhuhr: t.dhuhr, asr: t.asr, maghrib, isha };
  for (const p of PRAYERS) out[p] = out[p] + shift + (o.adjust?.[p] ?? 0) / 60;
  return out;
}

/** UTC offset (hours) of an IANA time zone at a given instant - handles daylight saving. */
export function tzOffsetHours(tz: string, at: Date): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(at);
    const g = (t: string) => +(parts.find(p => p.type === t)?.value ?? 0);
    const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
    return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000) / 60;
  } catch { return -at.getTimezoneOffset() / 60; }
}

export interface DayTimes { date: Date; ymd: [number, number, number]; tz: number; at: Record<Prayer, Date | null>; hours: Record<Prayer, number>; }
/** Prayer times for the civil day y-m-d at a place in time zone `tzName`, as real instants. */
export function prayerDay(y: number, m: number, d: number, place: Place, tzName: string, o: Options): DayTimes {
  const noon = new Date(Date.UTC(y, m - 1, d, 12));                         // offset sampled at local-ish noon of that civil day
  const tz = tzOffsetHours(tzName, new Date(noon.getTime() - tzOffsetHours(tzName, noon) * 3600000));
  const hours = computeHours(y, m, d, place, tz, o);
  const at = {} as Record<Prayer, Date | null>;
  for (const p of PRAYERS) {
    const h = hours[p];
    at[p] = isNaN(h) ? null : new Date(Date.UTC(y, m - 1, d) + Math.round(((h - tz) * 3600) ) * 1000);
  }
  return { date: new Date(Date.UTC(y, m - 1, d)), ymd: [y, m, d], tz, at, hours };
}

/** civil date (y, m, d) of an instant in a time zone */
export function civilDate(at: Date, tzName: string): [number, number, number] {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tzName, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at).split('-').map(Number);
  return [f[0], f[1], f[2]];
}

/** the next prayer after `now` (tomorrow's Fajr after Isha) */
export function nextPrayer(now: Date, place: Place, tzName: string, o: Options): { prayer: Prayer; at: Date } {
  const [y, m, d] = civilDate(now, tzName);
  for (let k = 0; k < 3; k++) {
    const day = new Date(Date.UTC(y, m - 1, d + k));
    const t = prayerDay(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), place, tzName, o);
    for (const p of PRAYERS) { const a = t.at[p]; if (a && a.getTime() > now.getTime()) return { prayer: p, at: a }; }
  }
  return { prayer: 'fajr', at: now };
}

/** Qibla: compass bearing (degrees from true north) from a place to the Kaaba, and the great-circle distance in km. */
export function qibla(lat: number, lng: number): { bearing: number; km: number } {
  const kLat = 21.422487, kLng = 39.826206, dL = (kLng - lng) * R;
  const y = Math.sin(dL), x = Math.cos(lat * R) * Math.tan(kLat * R) - Math.sin(lat * R) * Math.cos(dL);
  const a = Math.sin((kLat - lat) * R / 2) ** 2 + Math.cos(lat * R) * Math.cos(kLat * R) * Math.sin(dL / 2) ** 2;
  return { bearing: (Math.atan2(y, x) / R + 360) % 360, km: 12742 * Math.asin(Math.sqrt(a)) };
}
