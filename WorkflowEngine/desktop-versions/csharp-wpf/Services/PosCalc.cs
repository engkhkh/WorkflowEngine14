using System.Globalization;
using System.IO;
using System.Net;
using System.Text;
using System.Text.Json.Nodes;

namespace WorkflowErp.Services;

/// <summary>Point of sale: pricing (the same rules the server applies at checkout), shared state and the receipt (port of the portal's pos.calc.ts and pos-receipt).</summary>
public static class PosCalc
{
    public static double N(JsonNode? n)
    {
        if (n is not JsonValue v) return 0;
        if (v.TryGetValue<double>(out var d)) return d;
        if (v.TryGetValue<int>(out var i)) return i;
        if (v.TryGetValue<long>(out var l)) return l;
        if (v.TryGetValue<decimal>(out var m)) return (double)m;
        if (v.TryGetValue<string>(out var s)) return double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var x) ? x : 0;
        return 0;
    }

    public static string S(JsonNode? n)
    {
        if (n == null) return "";
        try { return n.GetValueKind() == System.Text.Json.JsonValueKind.String ? n.GetValue<string>() : n.ToJsonString().Trim('"'); } catch { return ""; }
    }

    public static JsonObject D(JsonNode? rec) => rec?["data"] as JsonObject ?? new JsonObject();
    public static double R2(double n) => Math.Round(n + 1e-9, 2, MidpointRounding.AwayFromZero);
    public static string Money(double v) => v.ToString("N2", CultureInfo.InvariantCulture);
    public static string Num(double v) => v == Math.Floor(v) ? ((long)v).ToString(CultureInfo.InvariantCulture) : v.ToString(CultureInfo.InvariantCulture);

    public static JsonObject Defaults() => new()
    {
        ["taxRate"] = 15, ["pricesIncludeTax"] = true, ["pointsPerCurrency"] = 1, ["pointValue"] = 0.05, ["requireShift"] = true, ["allowNegativeStock"] = false,
        ["maxDiscountPct"] = 20, ["receiptHeader"] = "", ["receiptFooter"] = ""
    };

    public sealed class Priced
    {
        public List<JsonObject> Lines = new();
        public double Subtotal, Discount, Tax, Total;
    }

    private static (double disc, string code) BestPromo(IEnumerable<JsonNode> promos, string sku, string category, double qty, double price)
    {
        double best = 0; var code = "";
        var today = DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        foreach (var pr in promos)
        {
            var st = S(pr["status"]);
            if (st.Length > 0 && st != "Active") continue;
            var p = D(pr);
            var from = S(p["from"]); var to = S(p["to"]);
            if (from.Length > 0 && string.CompareOrdinal(today, from[..Math.Min(10, from.Length)]) < 0) continue;
            if (to.Length > 0 && string.CompareOrdinal(today, to[..Math.Min(10, to.Length)]) > 0) continue;
            var scope = S(p["scope"]).Length == 0 ? "all" : S(p["scope"]); var target = S(p["target"]).ToLowerInvariant();
            if (scope == "sku" && target != sku.ToLowerInvariant()) continue;
            if (scope == "category" && target != category.ToLowerInvariant()) continue;
            double gross = price * qty, v = N(p["value"]), d = 0;
            var ty = S(p["type"]);
            if (ty == "pct") d = gross * v / 100;
            else if (ty == "amount") d = Math.Min(gross, v * qty);
            else if (ty == "qty" && qty >= Math.Max(1, N(p["minQty"]))) d = gross * v / 100;
            if (d > best) { best = d; code = S(pr["code"]); }
        }
        return (R2(best), code);
    }

    public static Priced PriceCart(IEnumerable<JsonObject> items, IEnumerable<JsonNode> products, IEnumerable<JsonNode> promos, JsonNode? customer, double orderPct, JsonObject cfgIn)
    {
        var cfg = Defaults();
        foreach (var kv in cfgIn.ToList()) cfg[kv.Key] = kv.Value?.DeepClone();
        var custPct = N(D(customer)["discountPct"]);
        var prods = products.ToList(); var proms = promos.ToList();
        var o = new Priced();
        foreach (var it in items)
        {
            var sku = S(it["sku"]);
            var p = prods.FirstOrDefault(x => string.Equals(S(x["code"]), sku, StringComparison.OrdinalIgnoreCase));
            if (p == null) continue;
            var d = D(p);
            double qty = N(it["qty"]), price = N(d["price"]), gross = R2(price * qty);
            var (pd, pcode) = BestPromo(proms, S(p["code"]), S(d["category"]), qty, price);
            var rest = gross - pd;
            var manual = R2(rest * N(it["discountPct"]) / 100); rest -= manual;
            var cust = R2(rest * custPct / 100); rest -= cust;
            var ord = R2(rest * orderPct / 100); rest -= ord;
            var net = R2(rest); double tax;
            var tr = d["taxRate"];
            var rate = tr == null || S(tr).Length == 0 ? N(cfg["taxRate"]) : N(tr);
            if (cfg["pricesIncludeTax"]?.GetValue<bool>() ?? true) tax = R2(net - net / (1 + rate / 100));
            else { tax = R2(net * rate / 100); net = R2(net + tax); }
            o.Lines.Add(new JsonObject
            {
                ["sku"] = S(p["code"]), ["name"] = S(d["name"]).Length == 0 ? S(p["code"]) : S(d["name"]), ["qty"] = qty, ["price"] = price, ["gross"] = gross, ["promo"] = pd, ["promoCode"] = pcode,
                ["discount"] = R2(pd + manual + cust + ord), ["tax"] = tax, ["total"] = net, ["discountPct"] = N(it["discountPct"])
            });
        }
        o.Subtotal = R2(o.Lines.Sum(l => N(l["gross"]))); o.Discount = R2(o.Lines.Sum(l => N(l["discount"]))); o.Tax = R2(o.Lines.Sum(l => N(l["tax"]))); o.Total = R2(o.Lines.Sum(l => N(l["total"])));
        return o;
    }

    public sealed class State
    {
        public JsonArray Products = new(), Categories = new(), Customers = new(), Promos = new(), Registers = new();
        public JsonObject Settings = Defaults();
        public JsonObject? Shift;
        public Dictionary<string, double> Stock = new();
        public bool Loaded;

        public async Task Load()
        {
            Products = await Api.I.PosRecords("product");
            Categories = await Safe("category"); Customers = await Safe("customer"); Promos = await Safe("promotion"); Registers = await Safe("register");
            var cfg = Defaults();
            foreach (var x in await Safe("setting"))
                if (S(x?["code"]) == "pos") foreach (var kv in D(x).ToList()) cfg[kv.Key] = kv.Value?.DeepClone();
            Settings = cfg;
            Shift = await Api.I.PosShift();
            Stock = new();
            foreach (var x in await Safe("stock")) Stock[S(D(x)["sku"])] = N(D(x)["qty"]);
            Loaded = true;
        }

        private static async Task<JsonArray> Safe(string kind)
        {
            try { return await Api.I.PosRecords(kind); }
            catch (ApiException e) when (!e.Offline) { return new JsonArray(); }
        }
    }

    private static string Esc(string x) => WebUtility.HtmlEncode(x);

    public static string ReceiptHtml(JsonObject sale, JsonObject settings)
    {
        var d = D(sale);
        var rows = new StringBuilder();
        foreach (var l in (d["lines"] as JsonArray ?? new JsonArray()).OfType<JsonObject>())
            rows.Append("<tr><td>").Append(Esc(S(l["name"]))).Append("<br><small>").Append(Num(N(l["qty"]))).Append(" × ").Append(Money(N(l["price"])))
                .Append(N(l["discount"]) != 0 ? " · −" + Money(N(l["discount"])) : "").Append("</small></td><td align='right'>").Append(Money(N(l["total"]))).Append("</td></tr>");
        var pays = new StringBuilder();
        foreach (var p in (d["payments"] as JsonArray ?? new JsonArray()).OfType<JsonObject>())
            pays.Append("<tr><td>").Append(Loc.T("pos.pay." + S(p["method"]))).Append("</td><td align='right'>").Append(Money(N(p["amount"]))).Append("</td></tr>");
        var title = S(d["type"]) == "Return" ? Loc.T("pos.rc.return") : Loc.T("pos.rc.receipt");
        var at = S(sale["createdAt"]);
        var h = new StringBuilder();
        h.Append("<html><body dir='").Append(Loc.Rtl ? "rtl" : "ltr").Append("' style='font-family:Consolas,monospace;font-size:12px;width:290px'><div align='center'><b>")
         .Append(Esc(Api.I.Session?.TenantName ?? "")).Append("</b><br>").Append(Esc(S(settings["receiptHeader"]))).Append("</div><hr>");
        h.Append("<table width='100%'><tr><td>").Append(title).Append("</td><td align='right'>").Append(Esc(S(sale["code"]))).Append("</td></tr>");
        if (S(sale["parent"]).Length > 0) h.Append("<tr><td>").Append(Loc.T("pos.rc.original")).Append("</td><td align='right'>").Append(Esc(S(sale["parent"]))).Append("</td></tr>");
        h.Append("<tr><td>").Append(Esc(at[..Math.Min(16, at.Length)].Replace('T', ' '))).Append("</td><td align='right'>").Append(Esc(S(d["cashier"]))).Append("</td></tr>");
        if (S(d["customerName"]).Length > 0) h.Append("<tr><td>").Append(Loc.T("pos.customer")).Append("</td><td align='right'>").Append(Esc(S(d["customerName"]))).Append("</td></tr>");
        h.Append("</table><hr><table width='100%'>").Append(rows).Append("</table><hr><table width='100%'>");
        if (N(d["subtotal"]) != 0) h.Append("<tr><td>").Append(Loc.T("pos.subtotal")).Append("</td><td align='right'>").Append(Money(N(d["subtotal"]))).Append("</td></tr>");
        if (N(d["discount"]) != 0) h.Append("<tr><td>").Append(Loc.T("pos.discount")).Append("</td><td align='right'>−").Append(Money(N(d["discount"]))).Append("</td></tr>");
        h.Append("<tr><td>").Append(Loc.T("pos.tax")).Append("</td><td align='right'>").Append(Money(N(d["tax"]))).Append("</td></tr><tr><td><b>").Append(Loc.T("pos.total")).Append("</b></td><td align='right'><b>")
         .Append(Money(N(d["total"]))).Append("</b></td></tr>").Append(pays);
        if (N(d["change"]) != 0) h.Append("<tr><td>").Append(Loc.T("pos.change")).Append("</td><td align='right'>").Append(Money(N(d["change"]))).Append("</td></tr>");
        if (N(d["earned"]) != 0) h.Append("<tr><td>").Append(Loc.T("pos.pointsEarned")).Append("</td><td align='right'>").Append(Num(N(d["earned"]))).Append("</td></tr>");
        h.Append("</table><hr><div align='center'>").Append(Esc(S(settings["receiptFooter"]))).Append("<br><small>").Append(Loc.T("pos.rc.thanks")).Append("</small></div></body></html>");
        return h.ToString();
    }
}
