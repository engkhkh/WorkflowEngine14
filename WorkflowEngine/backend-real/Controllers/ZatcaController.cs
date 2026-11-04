using System.Globalization;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Xml;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using WorkflowEngine.Api.Data;
using WorkflowEngine.Api.Models;
using WorkflowEngine.Api.Security;
using WorkflowEngine.Api.Services;

namespace WorkflowEngine.Api.Controllers;

public class ZatcaProfileDto
{
    public string SellerName { get; set; } = "";
    public string SellerNameAr { get; set; } = "";
    public string VatNo { get; set; } = "";
    public string CrNo { get; set; } = "";
    public string Street { get; set; } = "";
    public string Building { get; set; } = "";
    public string District { get; set; } = "";
    public string City { get; set; } = "";
    public string PostalCode { get; set; } = "";
    public string Country { get; set; } = "SA";
}

/// <summary>
/// Saudi e-invoicing (ZATCA / FATOORA) and the VAT return.
///  - profile  : the seller's legal data (name, 15-digit VAT number, address) kept as the Finance setting "zatca"
///  - issue    : turns an issued customer invoice into an e-invoice: UUID, running counter (ICV), hash chained to the previous
///               invoice (PIH), the UBL 2.1 XML and the QR code (TLV, tags 1-5 = what a simplified invoice must show)
///  - vat-return : output VAT (sales) and input VAT (purchases) for a date range, by tax code and category
/// Phase 2 needs the taxpayer's own certificate (CSID) from ZATCA to sign the XML and to report / clear it; that onboarding is a step the
/// taxpayer does with ZATCA, so this controller prepares everything up to it and marks the invoice <c>signed: false</c>.
/// </summary>
[ApiController]
[Route("api/finance/zatca")]
[Authorize]
public class ZatcaController : ControllerBase
{
    private const string SeedPih = "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==";   // base64 of the SHA-256 hex of "0": the first invoice's previous hash
    private readonly WorkflowDbContext _db;
    private readonly IPermissionService _perms;
    private readonly ITenantScope _tenant;
    public ZatcaController(WorkflowDbContext db, IPermissionService perms, ITenantScope tenant) { _db = db; _perms = perms; _tenant = tenant; }

    private string Username => User.FindFirstValue(ClaimTypes.Name)!;
    private Task<bool> Has(string p) => _perms.Has(User, p);
    private BadRequestObjectResult Bad(string m) => BadRequest(new { message = m });
    private static string R2s(decimal v) => Math.Round(v, 2, MidpointRounding.AwayFromZero).ToString("0.00", CultureInfo.InvariantCulture);

    // ------------------------------------------------------------------ seller profile

    [HttpGet("profile")]
    public async Task<IActionResult> GetProfile()
    {
        if (!(await Has("finance.view") || await Has("gov.zatca.manage"))) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var rec = await _db.FinRecords.AsNoTracking().FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Kind == "setting" && r.Code == "zatca");
        var d = FinJson.Obj(rec?.Data);
        return Ok(new ZatcaProfileDto
        {
            SellerName = FinJson.S(d, "sellerName"), SellerNameAr = FinJson.S(d, "sellerNameAr"), VatNo = FinJson.S(d, "vatNo"), CrNo = FinJson.S(d, "crNo"),
            Street = FinJson.S(d, "street"), Building = FinJson.S(d, "building"), District = FinJson.S(d, "district"), City = FinJson.S(d, "city"),
            PostalCode = FinJson.S(d, "postalCode"), Country = FinJson.S(d, "country") == "" ? "SA" : FinJson.S(d, "country")
        });
    }

    [HttpPut("profile")]
    public async Task<IActionResult> SaveProfile([FromBody] ZatcaProfileDto b)
    {
        if (!(await Has("gov.zatca.manage") || await Has("finance.setup"))) return Forbid();
        if (string.IsNullOrWhiteSpace(b.SellerName)) return Bad("Enter the seller's name as registered with ZATCA.");
        var vat = (b.VatNo ?? "").Trim();
        if (vat.Length != 15 || !vat.All(char.IsDigit) || vat[0] != '3' || vat[14] != '3') return Bad("The VAT registration number has 15 digits and starts and ends with 3.");
        if (!string.IsNullOrWhiteSpace(b.PostalCode) && !(b.PostalCode.Trim().Length == 5 && b.PostalCode.Trim().All(char.IsDigit))) return Bad("The postal code has 5 digits.");
        var tenantId = await _tenant.TenantIdOf(User);
        var rec = await _db.FinRecords.FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Kind == "setting" && r.Code == "zatca");
        var data = JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["sellerName"] = b.SellerName.Trim(), ["sellerNameAr"] = (b.SellerNameAr ?? "").Trim(), ["vatNo"] = vat, ["crNo"] = (b.CrNo ?? "").Trim(),
            ["street"] = (b.Street ?? "").Trim(), ["building"] = (b.Building ?? "").Trim(), ["district"] = (b.District ?? "").Trim(), ["city"] = (b.City ?? "").Trim(),
            ["postalCode"] = (b.PostalCode ?? "").Trim(), ["country"] = string.IsNullOrWhiteSpace(b.Country) ? "SA" : b.Country.Trim().ToUpperInvariant()
        });
        if (rec == null) _db.FinRecords.Add(new FinRecord { TenantId = tenantId, Kind = "setting", Code = "zatca", Status = "Active", Data = data, CreatedBy = Username });
        else { rec.Data = data; rec.UpdatedAt = DateTime.UtcNow; }
        _db.FinAudits.Add(new FinAudit { TenantId = tenantId, Kind = "setting", RecordId = rec?.Id ?? "-", Code = "zatca", Action = rec == null ? "Created" : "Updated", UserName = Username, Summary = "ZATCA seller profile saved" });
        await _db.SaveChangesAsync();
        return Ok(new { saved = true });
    }

    // ------------------------------------------------------------------ e-invoice

    /// <summary>Tag-length-value QR payload (tags 1-5), base64.</summary>
    public static string Tlv(string seller, string vatNo, DateTime utc, decimal total, decimal vat)
    {
        var bytes = new List<byte>();
        void Add(int tag, string v) { var b = Encoding.UTF8.GetBytes(v); bytes.Add((byte)tag); bytes.Add((byte)b.Length); bytes.AddRange(b); }
        Add(1, seller); Add(2, vatNo); Add(3, utc.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'", CultureInfo.InvariantCulture)); Add(4, R2s(total)); Add(5, R2s(vat));
        return Convert.ToBase64String(bytes.ToArray());
    }

    [HttpGet("invoice/{id}")]
    public async Task<IActionResult> GetInvoice(string id)
    {
        if (!(await Has("finance.ar.view") || await Has("gov.zatca.manage"))) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var inv = await _db.FinRecords.AsNoTracking().FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == "arinvoice");
        if (inv == null) return NotFound();
        var d = FinJson.Obj(inv.Data);
        if (d.ValueKind != JsonValueKind.Object || !d.TryGetProperty("zatca", out var z) || z.ValueKind != JsonValueKind.Object) return Ok(new { issued = false });
        return Ok(new
        {
            issued = true, uuid = FinJson.S(z, "uuid"), icv = (int)FinJson.D(z, "icv"), pih = FinJson.S(z, "pih"), hash = FinJson.S(z, "hash"), qr = FinJson.S(z, "qr"),
            type = FinJson.S(z, "type"), issuedAt = FinJson.S(z, "issuedAt"), issuedBy = FinJson.S(z, "issuedBy"), signed = FinJson.B(z, "signed"), xml = FinJson.S(z, "xml")
        });
    }

    [HttpPost("issue/{id}")]
    public async Task<IActionResult> Issue(string id)
    {
        if (!(await Has("finance.ar.manage") || await Has("gov.zatca.manage"))) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        using var numLock = await NumberingLock.Enter(tenantId + "|zatca");
        var inv = await _db.FinRecords.FirstOrDefaultAsync(r => r.Id == id && r.TenantId == tenantId && r.Kind == "arinvoice");
        if (inv == null) return NotFound();
        var d = FinJson.Obj(inv.Data);
        if (d.TryGetProperty("zatca", out var already) && already.ValueKind == JsonValueKind.Object) return Bad("This invoice already has its e-invoice (counter " + (int)FinJson.D(already, "icv") + ").");
        if (inv.Status is "Draft" or "Cancelled" or "Rejected" or null) return Bad("Issue the invoice first: only an issued invoice can become an e-invoice.");

        var prof = await _db.FinRecords.AsNoTracking().FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Kind == "setting" && r.Code == "zatca");
        if (prof == null) return Bad("Save the seller profile (name, VAT number, address) first.");
        var p = FinJson.Obj(prof.Data);
        var sellerName = FinJson.S(p, "sellerName"); var sellerVat = FinJson.S(p, "vatNo");
        if (sellerName == "" || sellerVat == "") return Bad("The seller profile is incomplete.");

        var cust = await _db.FinRecords.AsNoTracking().FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Kind == "customer" && r.Code == FinJson.S(d, "customer"));
        var cd = FinJson.Obj(cust?.Data);
        var buyerName = FinJson.S(cd, "name") != "" ? FinJson.S(cd, "name") : FinJson.S(d, "customer");
        var buyerVat = FinJson.S(cd, "taxNo");
        var standard = buyerVat != "";                      // business customer with a VAT number = standard (B2B) invoice, otherwise simplified (B2C)

        var rate = FinJson.Rate(d);
        var curr = FinJson.S(d, "currency") == "" ? "SAR" : FinJson.S(d, "currency");
        var net = FinJson.D(d, "amount"); var tax = FinJson.D(d, "taxAmount");
        var total = FinJson.D(d, "total") > 0 ? FinJson.D(d, "total") : net + tax;
        if (total <= 0) return Bad("The invoice total must be greater than zero.");
        var totalSar = Math.Round(total * rate, 2); var taxSar = Math.Round(tax * rate, 2);

        // counter and hash chain: the previous e-invoice of this workspace
        var prevs = await _db.FinRecords.AsNoTracking().Where(r => r.TenantId == tenantId && r.Kind == "arinvoice").ToListAsync();
        int icv = 0; string pih = SeedPih;
        foreach (var r in prevs)
        {
            var od = FinJson.Obj(r.Data);
            if (od.ValueKind == JsonValueKind.Object && od.TryGetProperty("zatca", out var oz) && oz.ValueKind == JsonValueKind.Object)
            {
                var n = (int)FinJson.D(oz, "icv");
                if (n > icv) { icv = n; pih = FinJson.S(oz, "hash"); }
            }
        }
        icv++;
        var now = DateTime.UtcNow; var uuid = Guid.NewGuid().ToString();
        var xml = BuildXml(inv, d, p, sellerName, sellerVat, buyerName, buyerVat, standard, curr, rate, net, tax, total, totalSar, taxSar, icv, pih, uuid, now);
        var hash = Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(xml)));
        var qr = Tlv(sellerName, sellerVat, now, totalSar, taxSar);

        inv.Data = FinJson.WithValues(inv.Data, new()
        {
            ["zatca"] = new Dictionary<string, object?>
            {
                ["uuid"] = uuid, ["icv"] = icv, ["pih"] = pih, ["hash"] = hash, ["qr"] = qr, ["type"] = standard ? "standard" : "simplified",
                ["issuedAt"] = now.ToString("o", CultureInfo.InvariantCulture), ["issuedBy"] = Username, ["signed"] = false, ["xml"] = xml
            }
        });
        inv.UpdatedAt = now;
        _db.FinAudits.Add(new FinAudit { TenantId = tenantId, Kind = "arinvoice", RecordId = inv.Id, Code = inv.Code, Action = "Updated", UserName = Username, Summary = $"E-invoice issued (counter {icv}, {(standard ? "standard" : "simplified")})" });
        await _db.SaveChangesAsync();
        return Ok(new { issued = true, uuid, icv, pih, hash, qr, type = standard ? "standard" : "simplified", issuedAt = now, issuedBy = Username, signed = false, xml });
    }

    private static string BuildXml(FinRecord inv, JsonElement d, JsonElement p, string sellerName, string sellerVat, string buyerName, string buyerVat, bool standard,
        string curr, decimal rate, decimal net, decimal tax, decimal total, decimal totalSar, decimal taxSar, int icv, string pih, string uuid, DateTime now)
    {
        var sb = new StringBuilder();
        var ws = new XmlWriterSettings { OmitXmlDeclaration = false, Encoding = new UTF8Encoding(false), Indent = false };
        const string inv_ = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2";
        const string cac = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2";
        const string cbc = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2";
        using (var sw = new StringWriterUtf8(sb))
        using (var w = XmlWriter.Create(sw, ws))
        {
            w.WriteStartDocument();
            w.WriteStartElement("Invoice", inv_);
            w.WriteAttributeString("xmlns", "cac", null, cac);
            w.WriteAttributeString("xmlns", "cbc", null, cbc);
            void E(string ns, string name, string value, params (string, string)[] attrs)
            {
                w.WriteStartElement(name, ns);
                foreach (var (k, v) in attrs) w.WriteAttributeString(k, v);
                w.WriteString(value); w.WriteEndElement();
            }
            E(cbc, "ProfileID", "reporting:1.0");
            E(cbc, "ID", inv.Code ?? inv.Id);
            E(cbc, "UUID", uuid);
            var date = FinJson.TryDate(d, "date", out var idt) ? idt : now;
            E(cbc, "IssueDate", date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
            E(cbc, "IssueTime", now.ToString("HH:mm:ss", CultureInfo.InvariantCulture) + "Z");
            E(cbc, "InvoiceTypeCode", "388", ("name", standard ? "0100000" : "0200000"));
            E(cbc, "DocumentCurrencyCode", curr);
            E(cbc, "TaxCurrencyCode", "SAR");
            w.WriteStartElement("AdditionalDocumentReference", cac); E(cbc, "ID", "ICV"); E(cbc, "UUID", icv.ToString(CultureInfo.InvariantCulture)); w.WriteEndElement();
            w.WriteStartElement("AdditionalDocumentReference", cac); E(cbc, "ID", "PIH");
            w.WriteStartElement("Attachment", cac); E(cbc, "EmbeddedDocumentBinaryObject", pih, ("mimeCode", "text/plain")); w.WriteEndElement(); w.WriteEndElement();

            void Party(string tag, string name, string vat, string crn, JsonElement addr, bool seller)
            {
                w.WriteStartElement(tag, cac); w.WriteStartElement("Party", cac);
                if (crn != "") { w.WriteStartElement("PartyIdentification", cac); E(cbc, "ID", crn, ("schemeID", "CRN")); w.WriteEndElement(); }
                if (seller)
                {
                    w.WriteStartElement("PostalAddress", cac);
                    E(cbc, "StreetName", FinJson.S(addr, "street")); E(cbc, "BuildingNumber", FinJson.S(addr, "building")); E(cbc, "CitySubdivisionName", FinJson.S(addr, "district"));
                    E(cbc, "CityName", FinJson.S(addr, "city")); E(cbc, "PostalZone", FinJson.S(addr, "postalCode"));
                    w.WriteStartElement("Country", cac); E(cbc, "IdentificationCode", FinJson.S(addr, "country") == "" ? "SA" : FinJson.S(addr, "country")); w.WriteEndElement();
                    w.WriteEndElement();
                }
                if (vat != "") { w.WriteStartElement("PartyTaxScheme", cac); E(cbc, "CompanyID", vat); w.WriteStartElement("TaxScheme", cac); E(cbc, "ID", "VAT"); w.WriteEndElement(); w.WriteEndElement(); }
                w.WriteStartElement("PartyLegalEntity", cac); E(cbc, "RegistrationName", name); w.WriteEndElement();
                w.WriteEndElement(); w.WriteEndElement();
            }
            Party("AccountingSupplierParty", sellerName, sellerVat, FinJson.S(p, "crNo"), p, true);
            Party("AccountingCustomerParty", buyerName, buyerVat, "", default, false);

            w.WriteStartElement("TaxTotal", cac); E(cbc, "TaxAmount", R2s(taxSar), ("currencyID", "SAR")); w.WriteEndElement();
            w.WriteStartElement("TaxTotal", cac); E(cbc, "TaxAmount", R2s(tax), ("currencyID", curr));
            w.WriteStartElement("TaxSubtotal", cac); E(cbc, "TaxableAmount", R2s(net), ("currencyID", curr)); E(cbc, "TaxAmount", R2s(tax), ("currencyID", curr));
            w.WriteStartElement("TaxCategory", cac); E(cbc, "ID", tax > 0 ? "S" : "Z"); E(cbc, "Percent", net > 0 ? R2s(tax / net * 100m) : "0.00");
            w.WriteStartElement("TaxScheme", cac); E(cbc, "ID", "VAT"); w.WriteEndElement(); w.WriteEndElement(); w.WriteEndElement(); w.WriteEndElement();
            w.WriteStartElement("LegalMonetaryTotal", cac);
            E(cbc, "LineExtensionAmount", R2s(net), ("currencyID", curr)); E(cbc, "TaxExclusiveAmount", R2s(net), ("currencyID", curr));
            E(cbc, "TaxInclusiveAmount", R2s(total), ("currencyID", curr)); E(cbc, "PayableAmount", R2s(total), ("currencyID", curr)); w.WriteEndElement();

            var lines = FinJson.Lines(d).ToList(); var n = 0;
            if (lines.Count == 0)
            {
                n = 1; w.WriteStartElement("InvoiceLine", cac); E(cbc, "ID", "1"); E(cbc, "InvoicedQuantity", "1.000000", ("unitCode", "PCE"));
                E(cbc, "LineExtensionAmount", R2s(net), ("currencyID", curr));
                w.WriteStartElement("Item", cac); E(cbc, "Name", FinJson.S(d, "notes") != "" ? FinJson.S(d, "notes") : "Invoice " + inv.Code); w.WriteEndElement();
                w.WriteStartElement("Price", cac); E(cbc, "PriceAmount", R2s(net), ("currencyID", curr)); w.WriteEndElement(); w.WriteEndElement();
            }
            else foreach (var l in lines)
            {
                n++; var q = FinJson.D(l, "qty") > 0 ? FinJson.D(l, "qty") : 1m; var pr = FinJson.D(l, "price");
                var ext = FinJson.D(l, "amount") > 0 ? FinJson.D(l, "amount") : q * pr;
                w.WriteStartElement("InvoiceLine", cac); E(cbc, "ID", n.ToString(CultureInfo.InvariantCulture)); E(cbc, "InvoicedQuantity", q.ToString("0.######", CultureInfo.InvariantCulture), ("unitCode", "PCE"));
                E(cbc, "LineExtensionAmount", R2s(ext), ("currencyID", curr));
                w.WriteStartElement("Item", cac); var nm = FinJson.S(l, "desc"); if (nm == "") nm = FinJson.S(l, "name"); if (nm == "") nm = FinJson.S(l, "sku"); E(cbc, "Name", nm == "" ? "Item " + n : nm); w.WriteEndElement();
                w.WriteStartElement("Price", cac); E(cbc, "PriceAmount", R2s(q == 0 ? 0 : ext / q), ("currencyID", curr)); w.WriteEndElement(); w.WriteEndElement();
            }
            w.WriteEndElement(); w.WriteEndDocument(); w.Flush();
        }
        return sb.ToString();
    }

    private sealed class StringWriterUtf8 : StringWriter { public StringWriterUtf8(StringBuilder sb) : base(sb, CultureInfo.InvariantCulture) { } public override Encoding Encoding => new UTF8Encoding(false); }

    // ------------------------------------------------------------------ VAT return

    private static string Category(JsonElement taxCode, decimal pct)
    {
        var c = FinJson.S(taxCode, "category");
        if (c is "S" or "Z" or "E" or "O") return c;
        return pct > 0 ? "S" : "Z";
    }

    [HttpGet("vat-return")]
    public async Task<IActionResult> VatReturn([FromQuery] string? from, [FromQuery] string? to, [FromQuery] string? company)
    {
        if (!(await Has("gov.vat.view") || await Has("finance.reports.view"))) return Forbid();
        var tenantId = await _tenant.TenantIdOf(User);
        var today = ClientClock.Today;
        var f = DateTime.TryParse(from, CultureInfo.InvariantCulture, DateTimeStyles.None, out var f0) ? f0.Date : new DateTime(today.Year, today.Month, 1);
        var t = DateTime.TryParse(to, CultureInfo.InvariantCulture, DateTimeStyles.None, out var t0) ? t0.Date : f.AddMonths(1).AddDays(-1);
        if (t < f) return Bad("The end date is before the start date.");
        if ((t - f).TotalDays > 400) return Bad("Choose a period of up to 13 months.");

        var q = _db.FinRecords.AsNoTracking().Where(r => r.TenantId == tenantId && (r.Kind == "arinvoice" || r.Kind == "apinvoice" || r.Kind == "taxcode"));
        if (!string.IsNullOrWhiteSpace(company) && company != "ALL") q = q.Where(r => r.Company == company || r.Company == null || r.Company == "");
        var all = await q.ToListAsync();
        var codes = all.Where(r => r.Kind == "taxcode").ToDictionary(r => r.Code ?? "", r => FinJson.Obj(r.Data), StringComparer.OrdinalIgnoreCase);
        var salesOk = new[] { "Issued", "Paid", "PartiallyPaid", "Partial" };
        var purchOk = new[] { "Approved", "Paid" };

        var rows = new List<(string side, string code, string cat, decimal net, decimal vat, bool zatca)>();
        var missingTax = new List<object>(); int issuedNoEinv = 0;
        foreach (var r in all.Where(x => x.Kind is "arinvoice" or "apinvoice"))
        {
            var sales = r.Kind == "arinvoice";
            if (!(sales ? salesOk : purchOk).Contains(r.Status ?? "")) continue;
            var d = FinJson.Obj(r.Data);
            if (!FinJson.TryDate(d, "date", out var dt) || dt.Date < f || dt.Date > t) continue;
            var rate = FinJson.Rate(d); var net = Math.Round(FinJson.D(d, "amount") * rate, 2); var vat = Math.Round(FinJson.D(d, "taxAmount") * rate, 2);
            var code = FinJson.S(d, "taxCode");
            decimal pct = 0; JsonElement tc = default;
            if (code != "" && codes.TryGetValue(code, out var found)) { tc = found; pct = FinJson.D(found, "rate"); }
            else if (net > 0) pct = Math.Round(vat / net * 100m, 2);
            if (code == "" && vat > 0) missingTax.Add(new { code = r.Code, side = sales ? "sales" : "purchases", vat });
            var hasZ = d.ValueKind == JsonValueKind.Object && d.TryGetProperty("zatca", out var zz) && zz.ValueKind == JsonValueKind.Object;
            if (sales && !hasZ) issuedNoEinv++;
            rows.Add((sales ? "sales" : "purchases", code == "" ? "—" : code, Category(tc, pct), net, vat, hasZ));
        }
        object Block(string side) => rows.Where(x => x.side == side).GroupBy(x => x.cat).OrderBy(g => g.Key)
            .Select(g => new { category = g.Key, count = g.Count(), net = g.Sum(x => x.net), vat = g.Sum(x => x.vat) }).ToList();
        object ByCode(string side) => rows.Where(x => x.side == side).GroupBy(x => x.code).OrderBy(g => g.Key)
            .Select(g => new { code = g.Key, count = g.Count(), net = g.Sum(x => x.net), vat = g.Sum(x => x.vat) }).ToList();
        var outVat = rows.Where(x => x.side == "sales").Sum(x => x.vat); var inVat = rows.Where(x => x.side == "purchases").Sum(x => x.vat);
        return Ok(new
        {
            from = f.ToString("yyyy-MM-dd"), to = t.ToString("yyyy-MM-dd"),
            sales = Block("sales"), purchases = Block("purchases"), salesByCode = ByCode("sales"), purchasesByCode = ByCode("purchases"),
            salesNet = rows.Where(x => x.side == "sales").Sum(x => x.net), purchasesNet = rows.Where(x => x.side == "purchases").Sum(x => x.net),
            outputVat = outVat, inputVat = inVat, netVatDue = outVat - inVat,
            salesInvoices = rows.Count(x => x.side == "sales"), purchaseInvoices = rows.Count(x => x.side == "purchases"),
            einvoiced = rows.Count(x => x.side == "sales" && x.zatca), notEinvoiced = issuedNoEinv,
            warnings = new { missingTaxCode = missingTax }
        });
    }
}
