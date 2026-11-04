"""Operations calculations shared in spirit with the portal (erp.calc.ts): standard BOM cost, material requirements planning and project billing figures."""


def r2(v):
    return round(float(v or 0) + 1e-9, 2)


def num(v):
    try:
        x = float(v)
        return x if x == x and abs(x) != float('inf') else 0.0
    except (TypeError, ValueError):
        return 0.0


def bom_cost(bom, items, rate, overhead_pct):
    d = bom.get('data') or {}
    out = max(0.0001, num(d.get('qty')) or 1)
    material = r2(sum(num(l.get('qty')) * (1 + num(l.get('scrapPct')) / 100) * num((items.get(l.get('sku')) or {}).get('cost')) for l in d.get('lines') or []))
    labor = r2(num(d.get('routingMinutes')) / 60 * rate)
    overhead = r2(labor * overhead_pct / 100)
    total = r2(material + labor + overhead)
    return dict(material=material, labor=labor, overhead=overhead, total=total, unit=r2(total / out))


def mrp(demands, boms, on_hand, scheduled, items, max_levels=12):
    """Explodes the demand through every bill of materials, nets against stock and open work orders -> rows (make / buy / ok)."""
    bom_by = {str(b.get('code')): b for b in boms if b.get('status') != 'Inactive'}
    free, sched, rows = dict(on_hand), dict(scheduled), {}

    def need(sku, qty, level, due=None):
        if qty <= 0 or level > max_levels:
            return
        row = rows.get(sku)
        if not row:
            row = rows[sku] = dict(sku=sku, name=(items.get(sku) or {}).get('name', ''), gross=0, onHand=max(0, on_hand.get(sku, 0)), scheduled=max(0, scheduled.get(sku, 0)), net=0, action='ok', level=level, due=due)
        row['gross'] = r2(row['gross'] + qty)
        row['level'] = max(row['level'], level)
        from_stock = min(max(0, free.get(sku, 0)), qty)
        free[sku] = free.get(sku, 0) - from_stock
        left = qty - from_stock
        from_orders = min(max(0, sched.get(sku, 0)), left)
        sched[sku] = sched.get(sku, 0) - from_orders
        left = r2(left - from_orders)
        if left <= 0:
            return
        row['net'] = r2(row['net'] + left)
        bom = bom_by.get(sku)
        row['action'] = 'make' if bom else 'buy'
        if bom:
            d = bom.get('data') or {}
            out = max(0.0001, num(d.get('qty')) or 1)
            for l in d.get('lines') or []:
                need(l.get('sku'), r2(left / out * num(l.get('qty')) * (1 + num(l.get('scrapPct')) / 100)), level + 1, due)

    for d in demands:
        need(d['sku'], num(d['qty']), 0, d.get('due'))
    return sorted(rows.values(), key=lambda r: (r['level'], r['sku']))


def project_ready(p, timesheets, costs, milestones):
    """Amount ready to bill and amount already billed for one project (time and material, or achieved milestones)."""
    code = p.get('code')
    d = p.get('data') or {}
    ts = [t for t in timesheets if t.get('ref') == code and t.get('status') != 'Rejected']
    cs = [c for c in costs if c.get('ref') == code]
    ms = [m for m in milestones if m.get('ref') == code]
    model = d.get('billingModel') or ''
    ready = 0.0
    if model == 'tm':
        ready += sum(num((t.get('data') or {}).get('hours')) * num((t.get('data') or {}).get('rate')) for t in ts if t.get('status') == 'Approved' and (t.get('data') or {}).get('billable'))
        ready += sum(num((c.get('data') or {}).get('amount')) * (1 + num((c.get('data') or {}).get('markupPct')) / 100) for c in cs if c.get('status') == 'Open' and (c.get('data') or {}).get('billable'))
    else:
        ready += sum(num((m.get('data') or {}).get('amount')) for m in ms if m.get('status') == 'Achieved')
    return r2(ready), r2(num(d.get('billed')))
