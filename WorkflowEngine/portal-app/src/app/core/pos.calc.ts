import { PosRec, PosSettings, POS_DEFAULTS } from './pos.models';

/** The till previews a basket with the same rules the server applies at checkout; the server's figures are the ones that count. */
export interface PricedLine {
  sku: string; name: string; qty: number; price: number; gross: number; promo: number; promoCode?: string;
  manual: number; cust: number; order: number; discount: number; taxRate: number; tax: number; total: number; discountPct: number; track: boolean;
}
export interface PricedCart { lines: PricedLine[]; subtotal: number; discount: number; tax: number; total: number; }

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function inWindow(d: Record<string, any>): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (d['from'] && today < String(d['from']).slice(0, 10)) return false;
  if (d['to'] && today > String(d['to']).slice(0, 10)) return false;
  return true;
}

export function bestPromo(promos: PosRec[], branch: string, sku: string, category: string, qty: number, price: number): { disc: number; code?: string } {
  let best = 0, code: string | undefined;
  for (const pr of promos) {
    if (pr.status && pr.status !== 'Active') continue;
    const p = pr.data ?? {};
    if (!inWindow(p)) continue;
    const br = String(p['branches'] ?? '').split(',').map(x => x.trim()).filter(Boolean);
    if (br.length && branch && !br.includes(branch)) continue;
    const scope = p['scope'] ?? 'all', target = String(p['target'] ?? '').toLowerCase();
    if (scope === 'sku' && target !== sku.toLowerCase()) continue;
    if (scope === 'category' && target !== category.toLowerCase()) continue;
    const gross = price * qty, v = Number(p['value']) || 0;
    let disc = 0;
    if (p['type'] === 'pct') disc = gross * v / 100;
    else if (p['type'] === 'amount') disc = Math.min(gross, v * qty);
    else if (p['type'] === 'qty' && qty >= Math.max(1, Number(p['minQty']) || 1)) disc = gross * v / 100;
    if (disc > best) { best = disc; code = pr.code ?? undefined; }
  }
  return { disc: r2(best), code };
}

export function priceCart(
  items: { sku: string; qty: number; discountPct: number }[], products: PosRec[], promos: PosRec[],
  customer: PosRec | undefined, orderPct: number, cfg: PosSettings, branch: string
): PricedCart {
  const s = { ...POS_DEFAULTS, ...cfg };
  const custPct = Number(customer?.data?.['discountPct']) || 0;
  const lines: PricedLine[] = [];
  for (const it of items) {
    const p = products.find(x => x.code?.toLowerCase() === it.sku.toLowerCase());
    if (!p) continue;
    const price = Number(p.data['price']) || 0;
    const gross = r2(price * it.qty);
    const bp = bestPromo(promos, branch, p.code!, String(p.data['category'] ?? ''), it.qty, price);
    let rest = gross - bp.disc;
    const manual = r2(rest * it.discountPct / 100); rest -= manual;
    const cust = r2(rest * custPct / 100); rest -= cust;
    const order = r2(rest * orderPct / 100); rest -= order;
    let net = r2(rest);
    const taxRate = p.data['taxRate'] === null || p.data['taxRate'] === undefined || p.data['taxRate'] === '' ? s.taxRate : Number(p.data['taxRate']);
    let tax: number;
    if (s.pricesIncludeTax) tax = r2(net - net / (1 + taxRate / 100));
    else { tax = r2(net * taxRate / 100); net = r2(net + tax); }
    lines.push({ sku: p.code!, name: p.data['name'] ?? p.code!, qty: it.qty, price, gross, promo: bp.disc, promoCode: bp.code, manual, cust, order,
      discount: r2(bp.disc + manual + cust + order), taxRate, tax, total: net, discountPct: it.discountPct, track: !!p.data['trackStock'] });
  }
  return { lines, subtotal: r2(lines.reduce((a, l) => a + l.gross, 0)), discount: r2(lines.reduce((a, l) => a + l.discount, 0)),
    tax: r2(lines.reduce((a, l) => a + l.tax, 0)), total: r2(lines.reduce((a, l) => a + l.total, 0)) };
}
