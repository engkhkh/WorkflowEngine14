using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Models;
using WorkflowEngine.Api.Services;

namespace WorkflowEngine.Api.Controllers;

public class ReActDto
{
    public decimal? Amount { get; set; }   // collect: amount received
    public string? Method { get; set; }    // collect: Cash / Transfer / Cheque / Card
    public string? Note { get; set; }      // collect / terminate / complete / cancel
    public decimal? Percent { get; set; }  // renew: rent increase in percent
    public string? User { get; set; }      // maintenance: assigned to
    public decimal? Cost { get; set; }     // maintenance: final cost
}

/// <summary>
/// Real Estate (module "re"): properties and their units, owners, tenants, leases with their rent schedule (installments),
/// unit sales and maintenance requests. Same record table and privilege checks as the other ERP modules.
/// Lease  : Draft -> (activate: rent schedule is created, unit becomes Rented) Active -> Terminated / Expired; renew creates the next Draft lease.
/// Sale   : Reservation -> Contract -> Completed (unit becomes Sold) or Cancelled.
/// </summary>
public partial class ModulesController
{
    private static readonly string[] ReUnitTypes = { "Apartment", "Villa", "Office", "Shop", "Warehouse", "Land", "Studio", "Floor" };
    private static readonly string[] RePropTypes = { "Residential", "Commercial", "Mixed", "Land", "Industrial" };
    private static readonly string[] ReFrequencies = { "Monthly", "Quarterly", "SemiAnnual", "Annual" };
    private static readonly string[] ReMethods = { "Cash", "Transfer", "Cheque", "Card" };
    private static readonly string[] RePriorities = { "Low", "Normal", "High", "Urgent" };

    private static (string view, string manage)? KindPermsRe(string module, string kind) => (module, kind) switch
    {
        ("re", "property" or "owner") => ("re.view", "re.properties.manage"),
        ("re", "unit") => ("re.view", "re.units.manage"),
        ("re", "tenant" or "lease") => ("re.view", "re.leases.manage"),
        ("re", "installment") => ("re.view", "re.collect"),
        ("re", "sale") => ("re.view", "re.sales.manage"),
        ("re", "request") => ("re.view", "re.maintenance.manage"),
        _ => KindPermsLots(module, kind)
    };

    private static string? AutoPrefixRe(string module, string kind) => (module, kind) switch
    {
        ("re", "property") => "PRP", ("re", "unit") => "UNT", ("re", "owner") => "OWN", ("re", "tenant") => "TEN", ("re", "lease") => "LSE",
        ("re", "installment") => "INS", ("re", "sale") => "SAL", ("re", "request") => "MNT",
        _ => AutoPrefixGov(module, kind)
    };

    private static string DefaultStatusRe(string module, string kind) => (module, kind) switch
    {
        ("re", "unit") => "Available", ("re", "lease") => "Draft", ("re", "installment") => "Due", ("re", "sale") => "Reservation", ("re", "request") => "New",
        _ => DefaultStatusGov(module, kind)
    };

    /// <summary>Kinds whose status only moves through the action buttons.</summary>
    private static bool ReActionOnly(string module, string kind) => module == "re" && kind is "lease" or "installment" or "sale";
    private static bool ReSystemOnly(string module, string kind) => module == "re" && kind == "installment";

    private static bool IsFinalRe(string module, string kind, string? status) => module == "re" && (kind, status) switch
    {
        ("lease", "Draft") => false, ("lease", _) => true,
        ("installment", _) => true,
        ("sale", "Reservation") => false, ("sale", _) => true,
        ("request", "Done") => true,
        _ => false
    };

    private static readonly Dictionary<(string, string), string[]> ReKeep = new()
    {
        [("re", "lease")] = new[] { "activatedAt", "activatedBy", "terminatedAt", "terminatedBy", "terminateReason", "renewedTo", "renewedFrom", "installments" },
        [("re", "installment")] = new[] { "paid", "paidAt", "paidBy", "method", "payments" },
        [("re", "sale")] = new[] { "contractAt", "completedAt", "completedBy", "cancelReason" },
        [("re", "request")] = new[] { "completedAt", "completedBy" },
    };

    private static string? GuardRe(string kind, string? oldStatus, string? newStatus)
    {
        if (kind == "unit" && newStatus is "Rented" or "Sold" && newStatus != oldStatus) return "A unit becomes Rented when its lease is activated and Sold when its sale is completed.";
        if (kind == "unit" && oldStatus is "Rented" or "Sold" && !string.IsNullOrEmpty(newStatus) && newStatus != oldStatus) return "Terminate the lease (or cancel the sale) to release this unit.";
        if (kind == "request" && oldStatus == "Done" && newStatus != oldStatus && !string.IsNullOrEmpty(newStatus)) return "A finished request can't be reopened.";
        return null;
    }

    private static bool ReDate(string s, out DateTime dt) => DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.None, out dt);

    private async Task<ErpRecord?> ReByCode(string tenantId, string kind, string code, bool track = false)
    {
        if (string.IsNullOrWhiteSpace(code)) return null;
        var q = _db.ErpRecords.Where(x => x.TenantId == tenantId && x.Module == "re" && x.Kind == kind && x.Code == code);
        return track ? await q.FirstOrDefaultAsync() : await q.AsNoTracking().FirstOrDefaultAsync();
    }

    private async Task<string?> ValidateRe(string tenantId, string kind, ErpRecord r, JsonElement d)
    {
        var isNew = !await _db.ErpRecords.AnyAsync(x => x.Id == r.Id);
        var today = ClientClock.Today;
        switch (kind)
        {
            case "property":
                if (FinJson.S(d, "name") == "") return "Enter the property name.";
                if (FinJson.S(d, "type") != "" && !RePropTypes.Contains(FinJson.S(d, "type"))) return "Choose a property type: Residential, Commercial, Mixed, Land or Industrial.";
                if (FinJson.D(d, "floors") < 0 || FinJson.D(d, "yearBuilt") < 0) return "Floors and year built can't be negative.";
                if (FinJson.S(d, "owner") != "" && await ReByCode(tenantId, "owner", FinJson.S(d, "owner")) == null) return $"Owner {FinJson.S(d, "owner")} doesn't exist.";
                if (r.Status is not ("Active" or "UnderConstruction" or "Inactive" or "Sold")) return "Status must be Active, UnderConstruction, Inactive or Sold.";
                break;
            case "owner":
                if (FinJson.S(d, "name") == "") return "Enter the owner's name.";
                if (FinJson.D(d, "commissionPct") < 0 || FinJson.D(d, "commissionPct") > 100) return "Management commission must be between 0 and 100 percent.";
                if (r.Status is not ("Active" or "Inactive")) return "Status must be Active or Inactive.";
                break;
            case "tenant":
                if (FinJson.S(d, "name") == "") return "Enter the tenant's name.";
                var em = FinJson.S(d, "email"); if (em != "" && (!em.Contains('@') || em.StartsWith('@') || em.EndsWith('@'))) return "The e-mail address isn't valid.";
                if (r.Status is not ("Active" or "Inactive" or "Blacklisted")) return "Status must be Active, Inactive or Blacklisted.";
                break;
            case "unit":
                {
                    var prop = FinJson.S(d, "property");
                    if (prop == "") return "Choose the property.";
                    if (await ReByCode(tenantId, "property", prop) == null) return $"Property {prop} doesn't exist.";
                    if (FinJson.S(d, "unitNo") == "") return "Enter the unit number.";
                    var ut = FinJson.S(d, "type"); if (ut != "" && !ReUnitTypes.Contains(ut)) return "Choose a valid unit type.";
                    if (FinJson.D(d, "area") <= 0) return "The area must be more than zero.";
                    if (FinJson.D(d, "annualRent") < 0 || FinJson.D(d, "salePrice") < 0 || FinJson.D(d, "bedrooms") < 0 || FinJson.D(d, "bathrooms") < 0) return "Rent, price, bedrooms and bathrooms can't be negative.";
                    var no = FinJson.S(d, "unitNo");
                    var dup = await _db.ErpRecords.AsNoTracking().Where(x => x.TenantId == tenantId && x.Module == "re" && x.Kind == "unit" && x.Id != r.Id).ToListAsync();
                    if (dup.Any(x => { var o = FinJson.Obj(x.Data); return FinJson.S(o, "property") == prop && string.Equals(FinJson.S(o, "unitNo"), no, StringComparison.OrdinalIgnoreCase); })) return $"Unit {no} already exists in {prop}.";
                    if (r.Status is not ("Available" or "Reserved" or "Rented" or "Sold" or "Maintenance")) return "Status must be Available, Reserved, Rented, Sold or Maintenance.";
                    break;
                }
            case "lease":
                {
                    if (!isNew && r.Status != "Draft") break;   // an active lease is only changed by the action buttons
                    var unit = await ReByCode(tenantId, "unit", FinJson.S(d, "unit")); if (unit == null) return "Choose the unit.";
                    if (await ReByCode(tenantId, "tenant", FinJson.S(d, "tenant")) == null) return "Choose the tenant.";
                    if (!FinJson.TryDate(d, "startDate", out var st) || !FinJson.TryDate(d, "endDate", out var en)) return "Enter the start and end dates.";
                    if (en.Date <= st.Date) return "The end date must be after the start date.";
                    if ((en.Date - st.Date).TotalDays > 366 * 30) return "A lease can't be longer than 30 years.";
                    if (FinJson.D(d, "annualRent") <= 0) return "The annual rent must be more than zero.";
                    if (FinJson.D(d, "deposit") < 0) return "The deposit can't be negative.";
                    if (!ReFrequencies.Contains(FinJson.S(d, "frequency"))) return "Choose how the rent is paid: Monthly, Quarterly, SemiAnnual or Annual.";
                    break;
                }
            case "sale":
                {
                    if (!isNew && r.Status != "Reservation") break;
                    var unit = await ReByCode(tenantId, "unit", FinJson.S(d, "unit")); if (unit == null) return "Choose the unit.";
                    if (unit.Status is not ("Available" or "Reserved")) return $"Unit {unit.Code} is {unit.Status} and can't be sold now.";
                    if (FinJson.S(d, "buyer") == "") return "Enter the buyer's name.";
                    if (FinJson.D(d, "price") <= 0) return "The sale price must be more than zero.";
                    if (FinJson.D(d, "deposit") < 0 || FinJson.D(d, "deposit") > FinJson.D(d, "price")) return "The deposit must be between zero and the price.";
                    break;
                }
            case "request":
                if (FinJson.S(d, "title") == "") return "Describe the problem.";
                if (FinJson.S(d, "property") == "" && FinJson.S(d, "unit") == "") return "Choose the property or the unit.";
                if (FinJson.S(d, "unit") != "" && await ReByCode(tenantId, "unit", FinJson.S(d, "unit")) == null) return $"Unit {FinJson.S(d, "unit")} doesn't exist.";
                if (FinJson.S(d, "priority") != "" && !RePriorities.Contains(FinJson.S(d, "priority"))) return "Choose a priority: Low, Normal, High or Urgent.";
                if (FinJson.D(d, "cost") < 0) return "The cost can't be negative.";
                if (r.Status is not ("New" or "Assigned" or "InProgress" or "Done" or "Cancelled")) return "Status must be New, Assigned, InProgress, Done or Cancelled.";
                break;
        }
        return null;
    }

    // ------------------------------------------------------------------ actions

    [HttpPost("react/{kind}/{id}/{op}")]
    public async Task<IActionResult> ReAction(string module, string kind, string id, string op, [FromBody] ReActDto? b)
    {
        if (module != "re") return NotFound();
        var kp = KindPermsRe(module, kind); if (kp == null) return NotFound();
        b ??= new ReActDto();
        var need = (kind, op) switch { ("lease", "activate" or "terminate") => "re.leases.approve", _ => kp.Value.manage };
        if (!await Has(need)) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var rec = await Find(tenantId, "re", kind, id);
        if (rec == null) return NotFound();
        var d = FinJson.Obj(rec.Data);
        var now = DateTime.UtcNow; var today = ClientClock.Today;
        IDisposable? numLock = null;
        try
        {
            switch (kind, op)
            {
                case ("lease", "activate"):
                    {
                        if (rec.Status != "Draft") return Bad("Only a draft lease can be activated.");
                        { var gm = await GovGate(tenantId, "re", "lease", rec, "Active"); if (gm != null) return Bad(gm); }
                        var unit = await ReByCode(tenantId, "unit", FinJson.S(d, "unit"), true); if (unit == null) return Bad("The unit of this lease doesn't exist any more.");
                        if (unit.Status != "Available" && unit.Status != "Reserved") return Bad($"Unit {unit.Code} is {unit.Status}; only an available unit can be rented.");
                        if (!FinJson.TryDate(d, "startDate", out var st) || !FinJson.TryDate(d, "endDate", out var en)) return Bad("Enter the start and end dates.");
                        var overlap = (await _db.ErpRecords.AsNoTracking().Where(x => x.TenantId == tenantId && x.Module == "re" && x.Kind == "lease" && x.Status == "Active" && x.Id != rec.Id).ToListAsync())
                            .Any(x => { var o = FinJson.Obj(x.Data); return FinJson.S(o, "unit") == unit.Code; });
                        if (overlap) return Bad($"Unit {unit.Code} already has an active lease.");
                        var step = FinJson.S(d, "frequency") switch { "Quarterly" => 3, "SemiAnnual" => 6, "Annual" => 12, _ => 1 };
                        var months = Math.Max(1, (int)Math.Round((en.Date - st.Date).TotalDays / 30.4375));
                        var n = (int)Math.Ceiling(months / (double)step);
                        var annual = FinJson.D(d, "annualRent");
                        var total = Math.Round(annual * months / 12m, 2);
                        var each = Math.Round(total / n, 2);
                        numLock = await NumberingLock.Enter(tenantId + "|erp|re|installment");
                        decimal given = 0;
                        for (var i = 0; i < n; i++)
                        {
                            var amt = i == n - 1 ? Math.Round(total - given, 2) : each; given += amt;
                            _db.ErpRecords.Add(new ErpRecord
                            {
                                TenantId = tenantId, Module = "re", Kind = "installment", Code = await NextCode(tenantId, "re", "installment", "INS"), Company = rec.Company, Branch = rec.Branch, Status = "Due", Ref = rec.Code, CreatedBy = Username,
                                Data = J(new() { ["lease"] = rec.Code, ["unit"] = unit.Code, ["tenant"] = FinJson.S(d, "tenant"), ["seq"] = i + 1, ["of"] = n, ["dueDate"] = st.Date.AddMonths(i * step).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), ["amount"] = amt, ["paid"] = 0m })
                            });
                        }
                        rec.Status = "Active";
                        rec.Data = FinJson.WithValues(rec.Data, new() { ["activatedAt"] = now, ["activatedBy"] = Username, ["installments"] = n });
                        unit.Status = "Rented"; unit.UpdatedAt = now;
                        break;
                    }
                case ("lease", "terminate"):
                    {
                        if (rec.Status != "Active") return Bad("Only an active lease can be terminated.");
                        if (Clean(b.Note) == null) return Bad("Write the reason for terminating the lease.");
                        var unit = await ReByCode(tenantId, "unit", FinJson.S(d, "unit"), true);
                        if (unit != null && unit.Status == "Rented") { unit.Status = "Available"; unit.UpdatedAt = now; }
                        var open = await _db.ErpRecords.Where(x => x.TenantId == tenantId && x.Module == "re" && x.Kind == "installment" && x.Ref == rec.Code && x.Status == "Due").ToListAsync();
                        foreach (var ins in open)
                            if (FinJson.TryDate(FinJson.Obj(ins.Data), "dueDate", out var dd) && dd.Date > today) { ins.Status = "Cancelled"; ins.UpdatedAt = now; }
                        rec.Status = "Terminated";
                        rec.Data = FinJson.WithValues(rec.Data, new() { ["terminatedAt"] = now, ["terminatedBy"] = Username, ["terminateReason"] = Clean(b.Note) });
                        break;
                    }
                case ("lease", "renew"):
                    {
                        if (rec.Status is not ("Active" or "Expired")) return Bad("Only an active or expired lease can be renewed.");
                        if (FinJson.S(d, "renewedTo") != "") return Bad("This lease was renewed already (" + FinJson.S(d, "renewedTo") + ").");
                        if (!FinJson.TryDate(d, "startDate", out var st) || !FinJson.TryDate(d, "endDate", out var en)) return Bad("The lease has no valid dates.");
                        var pct = b.Percent ?? 0m; if (pct < -50 || pct > 100) return Bad("The rent change must be between -50 and 100 percent.");
                        var len = en.Date - st.Date;
                        numLock = await NumberingLock.Enter(tenantId + "|erp|re|lease");
                        var next = new ErpRecord
                        {
                            TenantId = tenantId, Module = "re", Kind = "lease", Code = await NextCode(tenantId, "re", "lease", "LSE"), Company = rec.Company, Branch = rec.Branch, Status = "Draft", CreatedBy = Username,
                            Data = FinJson.WithValues(rec.Data, new()
                            {
                                ["startDate"] = en.Date.AddDays(1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), ["endDate"] = en.Date.AddDays(1).Add(len).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                                ["annualRent"] = Math.Round(FinJson.D(d, "annualRent") * (1 + pct / 100m), 2), ["renewedFrom"] = rec.Code, ["renewedTo"] = null, ["activatedAt"] = null, ["activatedBy"] = null,
                                ["terminatedAt"] = null, ["terminatedBy"] = null, ["terminateReason"] = null, ["installments"] = null
                            })
                        };
                        _db.ErpRecords.Add(next);
                        rec.Data = FinJson.WithValues(rec.Data, new() { ["renewedTo"] = next.Code });
                        break;
                    }
                case ("installment", "collect"):
                    {
                        if (rec.Status is not ("Due" or "Partial")) return Bad("This installment isn't open.");
                        var total = FinJson.D(d, "amount"); var paid = FinJson.D(d, "paid");
                        var amt = b.Amount ?? (total - paid);
                        if (amt <= 0) return Bad("Enter the amount received.");
                        if (paid + amt > total + 0.001m) return Bad($"Only {Math.Round(total - paid, 2)} is still due on this installment.");
                        var method = Clean(b.Method) ?? "Cash"; if (!ReMethods.Contains(method)) return Bad("Choose Cash, Transfer, Cheque or Card.");
                        paid = Math.Round(paid + amt, 2);
                        rec.Status = paid >= total - 0.001m ? "Paid" : "Partial";
                        rec.Data = FinJson.WithValues(rec.Data, new() { ["paid"] = paid, ["paidAt"] = now, ["paidBy"] = Username, ["method"] = method, ["lastNote"] = Clean(b.Note) });
                        break;
                    }
                case ("sale", "contract"):
                    {
                        if (rec.Status != "Reservation") return Bad("Only a reservation can become a contract.");
                        var unit = await ReByCode(tenantId, "unit", FinJson.S(d, "unit"), true); if (unit == null) return Bad("The unit doesn't exist any more.");
                        if (unit.Status is not ("Available" or "Reserved")) return Bad($"Unit {unit.Code} is {unit.Status}.");
                        unit.Status = "Reserved"; unit.UpdatedAt = now;
                        rec.Status = "Contract"; rec.Data = FinJson.WithValues(rec.Data, new() { ["contractAt"] = now });
                        break;
                    }
                case ("sale", "complete"):
                    {
                        if (rec.Status != "Contract") return Bad("Sign the contract before completing the sale.");
                        var unit = await ReByCode(tenantId, "unit", FinJson.S(d, "unit"), true);
                        if (unit != null) { unit.Status = "Sold"; unit.UpdatedAt = now; }
                        rec.Status = "Completed"; rec.Data = FinJson.WithValues(rec.Data, new() { ["completedAt"] = now, ["completedBy"] = Username });
                        break;
                    }
                case ("sale", "cancel"):
                    {
                        if (rec.Status is not ("Reservation" or "Contract")) return Bad("This sale can't be cancelled any more.");
                        if (Clean(b.Note) == null) return Bad("Write the reason for cancelling.");
                        var unit = await ReByCode(tenantId, "unit", FinJson.S(d, "unit"), true);
                        if (unit != null && unit.Status == "Reserved") { unit.Status = "Available"; unit.UpdatedAt = now; }
                        rec.Status = "Cancelled"; rec.Data = FinJson.WithValues(rec.Data, new() { ["cancelReason"] = Clean(b.Note) });
                        break;
                    }
                case ("request", "assign"):
                    {
                        if (rec.Status is not ("New" or "Assigned")) return Bad("Only a new request can be assigned.");
                        var user = Clean(b.User); if (user == null) return Bad("Choose who will handle the request.");
                        if (!await _db.Users.AnyAsync(u => u.TenantId == tenantId && u.Username == user && u.IsActive)) return Bad("That person isn't an active user of this workspace.");
                        rec.Status = "Assigned"; rec.Data = FinJson.WithValues(rec.Data, new() { ["assignedTo"] = user });
                        break;
                    }
                case ("request", "start"):
                    if (rec.Status is not ("New" or "Assigned")) return Bad("Only a new or assigned request can be started.");
                    rec.Status = "InProgress"; break;
                case ("request", "complete"):
                    {
                        if (rec.Status is not ("New" or "Assigned" or "InProgress")) return Bad("This request is finished already.");
                        var cost = b.Cost ?? FinJson.D(d, "cost"); if (cost < 0) return Bad("The cost can't be negative.");
                        rec.Status = "Done"; rec.Data = FinJson.WithValues(rec.Data, new() { ["cost"] = cost, ["completedAt"] = now, ["completedBy"] = Username, ["resolution"] = Clean(b.Note) });
                        break;
                    }
                default:
                    return NotFound();
            }
            rec.UpdatedAt = now;
            await _db.SaveChangesAsync();
            return Ok(ErpRecordDto.From(rec));
        }
        finally { numLock?.Dispose(); }
    }

    // ------------------------------------------------------------------ overview

    private void ReSummary(SummaryDto s, List<(ErpRecord r, JsonElement d)> all, DateTime today)
    {
        IEnumerable<(ErpRecord r, JsonElement d)> Kd(string k) => all.Where(x => x.r.Kind == k);
        var units = Kd("unit").ToList();
        var rented = units.Count(x => x.r.Status == "Rented"); var vacant = units.Count(x => x.r.Status == "Available");
        var rentable = units.Count(x => x.r.Status is "Rented" or "Available" or "Reserved");
        var open = Kd("installment").Where(x => x.r.Status is "Due" or "Partial").ToList();
        decimal Left(JsonElement d) => Math.Max(0, FinJson.D(d, "amount") - FinJson.D(d, "paid"));
        var late = open.Where(x => FinJson.TryDate(x.d, "dueDate", out var du) && du.Date < today).ToList();
        var leases = Kd("lease").Where(x => x.r.Status == "Active").ToList();
        var in90 = today.AddDays(90);
        var thisMonth = new DateTime(today.Year, today.Month, 1);
        decimal collected = Kd("installment").Where(x => FinJson.TryDate(x.d, "paidAt", out var pa) && pa.Date >= thisMonth).Sum(x => FinJson.D(x.d, "paid"));
        var sales = Kd("sale").ToList();
        s.Kpis.AddRange(new[] {
            K("properties", Kd("property").Count(x => x.r.Status != "Inactive")), K("units", units.Count), K("vacant", vacant),
            K("occupancyPct", rentable == 0 ? 0 : Math.Round(100m * rented / rentable, 1), "p"),
            K("activeLeases", leases.Count), K("expiring", leases.Count(x => FinJson.TryDate(x.d, "endDate", out var en) && en.Date <= in90)),
            K("rentDue", R2(open.Sum(x => Left(x.d))), "m"), K("overdueAmount", R2(late.Sum(x => Left(x.d))), "m"), K("overdueCount", late.Count),
            K("collectedMonth", R2(collected), "m"), K("requestsOpen", Kd("request").Count(x => x.r.Status is "New" or "Assigned" or "InProgress")),
            K("salesPipeline", R2(sales.Where(x => x.r.Status is "Reservation" or "Contract").Sum(x => FinJson.D(x.d, "price"))), "m"),
            K("soldYear", R2(sales.Where(x => x.r.Status == "Completed" && FinJson.TryDate(x.d, "completedAt", out var ca) && ca.Year == today.Year).Sum(x => FinJson.D(x.d, "price"))), "m") });
        IEnumerable<(string, decimal)> Cnt(string k) => Kd(k).GroupBy(x => x.r.Status ?? "").Select(g => (g.Key, (decimal)g.Count()));
        s.Lists.Add(S("unitsByStatus", Cnt("unit")));
        s.Lists.Add(S("unitsByType", units.GroupBy(x => FinJson.S(x.d, "type")).Select(g => (g.Key == "" ? "-" : g.Key, (decimal)g.Count()))));
        s.Lists.Add(S("leasesByStatus", Cnt("lease")));
        s.Lists.Add(S("requestsByStatus", Cnt("request")));
        s.Lists.Add(S("overdueByTenant", late.GroupBy(x => FinJson.S(x.d, "tenant")).Select(g => (g.Key, g.Sum(x => Left(x.d)))).OrderByDescending(x => x.Item2).Take(8)));
    }
}
