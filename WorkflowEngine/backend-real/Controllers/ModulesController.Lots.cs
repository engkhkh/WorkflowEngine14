using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Models;
using WorkflowEngine.Api.Services;

namespace WorkflowEngine.Api.Controllers;

/// <summary>
/// Warehouse: batch / serial / expiry tracking.
///   wh/trackrule : which items are tracked (batch or serial), shelf life, and how close to expiry a lot may still be picked
///   wh/lot       : one batch of one item in one branch: quantity, expiry, serial numbers. Created when goods are received with a batch
///                  number (or by hand as an opening balance), used up first-expiry-first-out when a pick list is confirmed.
/// A lot never changes the stock figure itself: stock moves exactly as before, the lots say WHICH goods that stock is.
/// </summary>
public partial class ModulesController
{
    private sealed class TrackInfo { public string Tracking = ""; public int ShelfLifeDays; public int MinExpiryDays; public bool RequireExpiry; }

    private static (string view, string manage)? KindPermsLots(string module, string kind) => (module, kind) switch
    {
        ("wh", "lot") => ("wh.view", "wh.lots.manage"),
        ("wh", "trackrule") => ("wh.view", "wh.setup"),
        _ => KindPermsGov(module, kind)
    };

    private static bool LotActionOnly(string module, string kind) => module == "wh" && kind == "lot";

    private async Task<TrackInfo?> TrackRule(string tenantId, string sku)
    {
        var rec = await _db.ErpRecords.AsNoTracking().FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Module == "wh" && r.Kind == "trackrule" && r.Ref == sku && r.Status == "Active");
        if (rec == null) return null;
        var d = FinJson.Obj(rec.Data);
        var t = FinJson.S(d, "tracking");
        if (t is not ("batch" or "serial")) return null;
        return new TrackInfo { Tracking = t, ShelfLifeDays = (int)FinJson.D(d, "shelfLifeDays"), MinExpiryDays = (int)FinJson.D(d, "minExpiryDays"), RequireExpiry = FinJson.B(d, "requireExpiry") };
    }

    private static List<string> LotSerials(JsonElement d)
    {
        var res = new List<string>();
        if (d.ValueKind == JsonValueKind.Object && d.TryGetProperty("serials", out var s) && s.ValueKind == JsonValueKind.Array)
            foreach (var x in s.EnumerateArray()) { var v = x.ValueKind == JsonValueKind.String ? x.GetString() : x.ToString(); if (!string.IsNullOrWhiteSpace(v)) res.Add(v!.Trim()); }
        else if (d.ValueKind == JsonValueKind.Object && d.TryGetProperty("serials", out var s2) && s2.ValueKind == JsonValueKind.String)
            res.AddRange((s2.GetString() ?? "").Split(new[] { ',', ';', '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries).Select(v => v.Trim()).Where(v => v != ""));
        return res;
    }

    private async Task<string?> ValidateLots(string tenantId, string kind, ErpRecord r, JsonElement d)
    {
        if (kind == "trackrule")
        {
            var sku = Clean(r.Ref) ?? Clean(r.Code) ?? FinJson.S(d, "sku");
            if (string.IsNullOrWhiteSpace(sku)) return "Choose the item.";
            if (!await _db.PosRecords.AnyAsync(p => p.TenantId == tenantId && p.Kind == "product" && p.Code == sku)) return $"Item {sku} doesn't exist.";
            if (FinJson.S(d, "tracking") is not ("batch" or "serial")) return "Tracking must be batch or serial.";
            if (FinJson.D(d, "shelfLifeDays") < 0 || FinJson.D(d, "minExpiryDays") < 0) return "Days can't be negative.";
            r.Ref = sku; r.Code = sku;
            if (r.Status is not ("Active" or "Inactive")) return "Status must be Active or Inactive.";
            var dup = await _db.ErpRecords.AnyAsync(x => x.TenantId == tenantId && x.Module == "wh" && x.Kind == "trackrule" && x.Code == sku && x.Id != r.Id);
            if (dup) return $"Item {sku} already has a tracking rule.";
            return null;
        }
        // lot
        var lsku = FinJson.S(d, "sku"); var batch = FinJson.S(d, "batchNo");
        if (lsku == "") return "Choose the item.";
        if (batch == "") return "Enter the batch number.";
        if (!await _db.PosRecords.AnyAsync(p => p.TenantId == tenantId && p.Kind == "product" && p.Code == lsku)) return $"Item {lsku} doesn't exist.";
        var qty = FinJson.D(d, "qty");
        if (qty < 0) return "The quantity can't be negative.";
        DateTime? exp = null, mfg = null;
        if (FinJson.S(d, "expiry") != "") { if (!FinJson.TryDate(d, "expiry", out var e0)) return "Enter a valid expiry date."; exp = e0; }
        if (FinJson.S(d, "mfgDate") != "") { if (!FinJson.TryDate(d, "mfgDate", out var m0)) return "Enter a valid manufacturing date."; mfg = m0; }
        if (exp != null && mfg != null && exp < mfg) return "The expiry date is before the manufacturing date.";
        var serials = LotSerials(d);
        if (serials.Count != serials.Distinct(StringComparer.OrdinalIgnoreCase).Count()) return "A serial number appears twice.";
        var tr = await TrackRule(tenantId, lsku);
        if (tr?.Tracking == "serial" && serials.Count != (int)qty) return $"{lsku} is serial-tracked: enter exactly {(int)qty} serial numbers.";
        r.Ref = lsku;
        r.Data = FinJson.WithValues(r.Data, new() { ["serials"] = serials });   // a typed list ("A1, A2") is stored as an array
        var branch = Clean(r.Branch);
        var same = await _db.ErpRecords.AnyAsync(x => x.TenantId == tenantId && x.Module == "wh" && x.Kind == "lot" && x.Ref == lsku && x.Id != r.Id
            && (x.Branch ?? "") == (branch ?? "") && x.Data.Contains("\"" + batch + "\""));
        if (same)
        {   // the substring test is only a pre-filter; confirm on the real field
            var others = await _db.ErpRecords.AsNoTracking().Where(x => x.TenantId == tenantId && x.Module == "wh" && x.Kind == "lot" && x.Ref == lsku && x.Id != r.Id && (x.Branch ?? "") == (branch ?? "")).ToListAsync();
            if (others.Any(x => string.Equals(FinJson.S(FinJson.Obj(x.Data), "batchNo"), batch, StringComparison.OrdinalIgnoreCase))) return $"Batch {batch} of {lsku} already exists in this branch.";
        }
        if (serials.Count > 0)
        {
            var all = await _db.ErpRecords.AsNoTracking().Where(x => x.TenantId == tenantId && x.Module == "wh" && x.Kind == "lot" && x.Ref == lsku && x.Id != r.Id).ToListAsync();
            var used = all.SelectMany(x => LotSerials(FinJson.Obj(x.Data))).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var clash = serials.FirstOrDefault(s => used.Contains(s));
            if (clash != null) return $"Serial number {clash} already exists for {lsku}.";
        }
        if (r.Status is not ("Active" or "Quarantine" or "Depleted" or "Expired")) return "Status must be Active, Quarantine, Depleted or Expired.";
        return null;
    }

    /// <summary>Called for every received line: creates / tops up the lot, enforces batch and serial rules for tracked items.</summary>
    private async Task<string?> LotReceive(string tenantId, ErpRecord po, ProcReceiveLine w)
    {
        var tr = await TrackRule(tenantId, w.Sku);
        var batch = Clean(w.BatchNo);
        if (batch == null) return tr != null ? $"Enter the batch number for {w.Sku} (it is tracked by {tr.Tracking})." : null;
        var today = ClientClock.Today;
        DateTime? exp = null, mfg = null;
        if (Clean(w.Expiry) != null) { if (!DateTime.TryParse(w.Expiry, CultureInfo.InvariantCulture, DateTimeStyles.None, out var e0)) return $"Enter a valid expiry date for {w.Sku}."; exp = e0.Date; }
        if (Clean(w.Mfg) != null) { if (!DateTime.TryParse(w.Mfg, CultureInfo.InvariantCulture, DateTimeStyles.None, out var m0)) return $"Enter a valid manufacturing date for {w.Sku}."; mfg = m0.Date; }
        if (exp == null && tr != null && tr.ShelfLifeDays > 0) exp = (mfg ?? today).AddDays(tr.ShelfLifeDays);
        if (exp == null && tr != null && tr.RequireExpiry) return $"Enter the expiry date for {w.Sku}.";
        if (exp != null && exp < today) return $"Batch {batch} of {w.Sku} is already expired ({exp:yyyy-MM-dd}).";
        var serials = (w.Serials ?? new()).Select(s => (s ?? "").Trim()).Where(s => s != "").ToList();
        if (tr?.Tracking == "serial" && (w.Qty != Math.Floor(w.Qty) || serials.Count != (int)w.Qty)) return $"{w.Sku} is serial-tracked: enter exactly {(int)w.Qty} serial numbers.";
        if (serials.Count != serials.Distinct(StringComparer.OrdinalIgnoreCase).Count()) return "A serial number appears twice.";

        var lots = await _db.ErpRecords.Where(x => x.TenantId == tenantId && x.Module == "wh" && x.Kind == "lot" && x.Ref == w.Sku).ToListAsync();
        if (serials.Count > 0)
        {
            var used = lots.SelectMany(x => LotSerials(FinJson.Obj(x.Data))).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var clash = serials.FirstOrDefault(s => used.Contains(s));
            if (clash != null) return $"Serial number {clash} already exists for {w.Sku}.";
        }
        var found = lots.FirstOrDefault(x => (x.Branch ?? "") == (po.Branch ?? "") && string.Equals(FinJson.S(FinJson.Obj(x.Data), "batchNo"), batch, StringComparison.OrdinalIgnoreCase));
        if (found != null)
        {
            var fd = FinJson.Obj(found.Data);
            var oldExp = FinJson.TryDate(fd, "expiry", out var oe) ? oe.Date : (DateTime?)null;
            if (exp != null && oldExp != null && exp != oldExp) return $"Batch {batch} of {w.Sku} already exists with expiry {oldExp:yyyy-MM-dd}; a batch has one expiry date.";
            var all = LotSerials(fd); all.AddRange(serials);
            found.Data = FinJson.WithValues(found.Data, new() { ["qty"] = FinJson.D(fd, "qty") + w.Qty, ["received"] = FinJson.D(fd, "received") + w.Qty, ["serials"] = all, ["expiry"] = (exp ?? oldExp)?.ToString("yyyy-MM-dd") });
            if (found.Status == "Depleted") found.Status = "Active";
            found.UpdatedAt = DateTime.UtcNow;
            return null;
        }
        var vendor = FinJson.S(FinJson.Obj(po.Data), "vendor");
        _db.ErpRecords.Add(new ErpRecord
        {
            TenantId = tenantId, Module = "wh", Kind = "lot", Code = await NextCode(tenantId, "wh", "lot", "LOT"), Company = po.Company, Branch = po.Branch, Status = "Active", Ref = w.Sku, CreatedBy = Username,
            Data = J(new() { ["sku"] = w.Sku, ["batchNo"] = batch, ["qty"] = w.Qty, ["received"] = w.Qty, ["expiry"] = exp?.ToString("yyyy-MM-dd"), ["mfgDate"] = mfg?.ToString("yyyy-MM-dd"), ["serials"] = serials, ["po"] = po.Code, ["supplier"] = vendor, ["receivedAt"] = DateTime.UtcNow })
        });
        return null;
    }

    private sealed class LotTake { public ErpRecord Lot = null!; public decimal Qty; public List<string> Serials = new(); }

    /// <summary>First-expiry-first-out allocation of <paramref name="qty"/> from the valid lots of one item in one branch.</summary>
    private async Task<(List<LotTake> takes, decimal short_)> LotAllocate(string tenantId, string? branch, string sku, decimal qty, TrackInfo? tr)
    {
        var today = ClientClock.Today;
        var lots = await _db.ErpRecords.Where(x => x.TenantId == tenantId && x.Module == "wh" && x.Kind == "lot" && x.Ref == sku && x.Status == "Active").ToListAsync();
        var ok = lots.Select(l => (l, d: FinJson.Obj(l.Data))).Where(x => (x.l.Branch ?? "") == (branch ?? "") && FinJson.D(x.d, "qty") > 0)
            .Where(x => { if (!FinJson.TryDate(x.d, "expiry", out var e)) return true; return e.Date >= today.AddDays(tr?.MinExpiryDays ?? 0) && e.Date >= today; })
            .OrderBy(x => FinJson.TryDate(x.d, "expiry", out var e) ? e.Date : DateTime.MaxValue).ThenBy(x => x.l.CreatedAt).ToList();
        var takes = new List<LotTake>(); var left = qty;
        foreach (var (l, d) in ok)
        {
            if (left <= 0) break;
            var have = FinJson.D(d, "qty"); var take = Math.Min(have, left);
            var t = new LotTake { Lot = l, Qty = take };
            var ser = LotSerials(d);
            if (ser.Count > 0) { var n = (int)Math.Min(ser.Count, Math.Floor(take)); t.Serials = ser.Take(n).ToList(); }
            takes.Add(t); left -= take;
        }
        return (takes, left);
    }

    private void LotApply(LotTake t)
    {
        var d = FinJson.Obj(t.Lot.Data);
        var left = FinJson.D(d, "qty") - t.Qty;
        var ser = LotSerials(d); ser.RemoveAll(s => t.Serials.Contains(s, StringComparer.OrdinalIgnoreCase));
        var issued = new List<string>();
        if (d.TryGetProperty("issuedSerials", out var iss) && iss.ValueKind == JsonValueKind.Array) foreach (var x in iss.EnumerateArray()) issued.Add(x.GetString() ?? "");
        issued.AddRange(t.Serials);
        t.Lot.Data = FinJson.WithValues(t.Lot.Data, new() { ["qty"] = left, ["serials"] = ser, ["issuedSerials"] = issued });
        if (left <= 0) t.Lot.Status = "Depleted";
        t.Lot.UpdatedAt = DateTime.UtcNow;
    }

    /// <summary>Used by the pick confirmation: consumes lots for one line, returns the allocation record or an error text.</summary>
    private async Task<(object? alloc, string? err)> LotPick(string tenantId, string? branch, string sku, decimal qty)
    {
        var tr = await TrackRule(tenantId, sku);
        var anyLot = tr != null || await _db.ErpRecords.AnyAsync(x => x.TenantId == tenantId && x.Module == "wh" && x.Kind == "lot" && x.Ref == sku && x.Status == "Active");
        if (!anyLot) return (null, null);
        var (takes, left) = await LotAllocate(tenantId, branch, sku, qty, tr);
        if (tr != null && left > 0) return (null, $"Not enough valid batch stock of {sku}: {qty - left} available in lots that are active and not close to expiry, {qty} needed.");
        foreach (var t in takes) LotApply(t);
        return (new { sku, lots = takes.Select(t => new { lot = t.Lot.Code, batchNo = FinJson.S(FinJson.Obj(t.Lot.Data), "batchNo"), qty = t.Qty, serials = t.Serials }).ToList(), unlotted = left }, null);
    }

    [HttpGet("wh-lots")]
    public async Task<IActionResult> WhLots(string module, [FromQuery] string? sku, [FromQuery] string? branch, [FromQuery] int? expiringDays)
    {
        if (module != "wh" || !await Has("wh.view")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var q = _db.ErpRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Module == "wh" && r.Kind == "lot");
        if (!string.IsNullOrWhiteSpace(sku)) q = q.Where(r => r.Ref == sku);
        if (!string.IsNullOrWhiteSpace(branch) && branch != "ALL") q = q.Where(r => r.Branch == branch);
        var today = ClientClock.Today;
        var rows = (await q.ToListAsync()).Select(r =>
        {
            var d = FinJson.Obj(r.Data);
            int? days = FinJson.TryDate(d, "expiry", out var e) ? (int)(e.Date - today).TotalDays : null;
            return new { id = r.Id, code = r.Code, sku = FinJson.S(d, "sku"), batchNo = FinJson.S(d, "batchNo"), branch = r.Branch ?? "", status = r.Status, qty = FinJson.D(d, "qty"),
                expiry = FinJson.S(d, "expiry"), daysToExpiry = days, expired = days != null && days < 0, serials = LotSerials(d).Count };
        });
        if (expiringDays != null) rows = rows.Where(x => x.qty > 0 && x.daysToExpiry != null && x.daysToExpiry <= expiringDays);
        return Ok(rows.OrderBy(x => x.daysToExpiry ?? int.MaxValue).ThenBy(x => x.sku).Take(5000));
    }

    [HttpGet("lots/{id}/trace")]
    public async Task<IActionResult> LotTrace(string module, string id)
    {
        if (module != "wh" || !await Has("wh.view")) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var lot = await _db.ErpRecords.AsNoTracking().FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Module == "wh" && r.Kind == "lot");
        if (lot == null) return NotFound();
        var d = FinJson.Obj(lot.Data);
        var picks = await _db.ErpRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Module == "wh" && r.Kind == "pick" && r.Data.Contains(lot.Code!)).ToListAsync();
        var po = FinJson.S(d, "po");
        var order = po == "" ? null : await _db.ErpRecords.AsNoTracking().FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Module == "proc" && r.Kind == "po" && r.Code == po);
        return Ok(new
        {
            lot = ErpRecordDto.From(lot),
            receivedOn = order == null ? null : new { po = order.Code, vendor = FinJson.S(FinJson.Obj(order.Data), "vendor"), status = order.Status },
            issuedOn = picks.Select(p => new { pick = p.Code, at = FinJson.S(FinJson.Obj(p.Data), "pickedAt"), by = FinJson.S(FinJson.Obj(p.Data), "pickedBy") })
        });
    }

    [HttpPost("lots/{id}/{op}")]
    public async Task<IActionResult> LotAction(string module, string id, string op, [FromBody] GovActDto? b)
    {
        if (module != "wh") return NotFound();
        var tenantId = await _tenant.TenantIdOf(User);
        var lot = await Find(tenantId, "wh", "lot", id);
        if (lot == null) return NotFound();
        var note = Clean(b?.Note);
        var d = FinJson.Obj(lot.Data);
        switch (op)
        {
            case "quarantine":
                if (!await Has("wh.lots.manage")) return Forbid();
                if (lot.Status != "Active") return Bad("Only an active lot can be put on hold.");
                lot.Status = "Quarantine"; break;
            case "release":
                if (!await Has("wh.lots.manage")) return Forbid();
                if (lot.Status != "Quarantine") return Bad("This lot is not on hold.");
                if (FinJson.TryDate(d, "expiry", out var e) && e.Date < ClientClock.Today) return Bad("This lot is expired and can't be released.");
                lot.Status = "Active"; break;
            case "writeoff":
                {
                    if (!await Has("wh.count.approve")) return Forbid();
                    if (note == null) return Bad("Enter the reason for the write-off.");
                    var qty = FinJson.D(d, "qty");
                    if (qty <= 0) return Bad("This lot has nothing left.");
                    var st = await StockRec(tenantId, lot.Company, lot.Branch, lot.Ref ?? FinJson.S(d, "sku"));
                    StockMove(tenantId, st, lot.Company, lot.Branch, lot.Ref ?? FinJson.S(d, "sku"), -qty, "lot-writeoff", lot.Code ?? "");
                    lot.Data = FinJson.WithValues(lot.Data, new() { ["qty"] = 0m, ["serials"] = new string[0], ["writtenOff"] = qty, ["writeOffReason"] = note, ["writtenOffBy"] = Username, ["writtenOffAt"] = DateTime.UtcNow });
                    lot.Status = "Depleted"; break;
                }
            default: return NotFound();
        }
        lot.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(ErpRecordDto.From(lot));
    }
}
