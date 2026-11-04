using System.Text.Json;

namespace WorkflowEngine.Api.Services;

/// <summary>Field-level difference between two JSON objects, used by the audit trail.</summary>
public static class AuditDiff
{
    private static readonly string[] Secret = { "hash", "password", "secret", "token" };

    public static List<Dictionary<string, string?>> Diff(string? oldJson, string? newJson, int max = 60)
    {
        var res = new List<Dictionary<string, string?>>();
        var o = Parse(oldJson); var n = Parse(newJson);
        foreach (var k in o.Keys.Union(n.Keys).OrderBy(x => x, StringComparer.Ordinal))
        {
            o.TryGetValue(k, out var a); n.TryGetValue(k, out var b);
            if (string.Equals(a, b, StringComparison.Ordinal)) continue;
            var hide = Secret.Any(s => k.Contains(s, StringComparison.OrdinalIgnoreCase));
            res.Add(new() { ["f"] = k, ["from"] = hide ? (a == null ? null : "***") : a, ["to"] = hide ? (b == null ? null : "***") : b });
            if (res.Count >= max) break;
        }
        return res;
    }

    /// <summary>Top level properties as short text. Arrays and objects are shown by size, so a long line list is not copied into every audit row.</summary>
    private static Dictionary<string, string?> Parse(string? json)
    {
        var d = new Dictionary<string, string?>(StringComparer.Ordinal);
        if (string.IsNullOrWhiteSpace(json)) return d;
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return d;
            foreach (var p in doc.RootElement.EnumerateObject())
            {
                var v = p.Value;
                string? t = v.ValueKind switch
                {
                    JsonValueKind.Null => null,
                    JsonValueKind.String => v.GetString(),
                    JsonValueKind.Array => "[" + v.GetArrayLength() + " items] " + Cut(v.GetRawText(), 120) + "#" + Fp(v.GetRawText()),
                    JsonValueKind.Object => "{…} " + Cut(v.GetRawText(), 120) + "#" + Fp(v.GetRawText()),
                    _ => v.GetRawText()
                };
                d[p.Name] = t == null ? null : Cut(t, 300);
            }
        }
        catch (JsonException) { }
        return d;
    }

    private static string Cut(string s, int n) => s.Length <= n ? s : s.Substring(0, n - 1) + "…";
    /// <summary>Short fingerprint so a change deep inside a long array/object is still noticed.</summary>
    private static string Fp(string s) { unchecked { int h = 17; foreach (var c in s) h = h * 31 + c; return h.ToString("x"); } }
}
