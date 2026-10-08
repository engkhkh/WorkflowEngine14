using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace WorkflowEngine.Api.Data;

/// <summary>
/// Complex properties (List&lt;WorkflowNode&gt;, Dictionary&lt;string,object?&gt;, etc.) are stored
/// as a single JSON text column rather than mapped to extra relational tables. This keeps the
/// schema simple and matches how the objects are already used everywhere else in the app
/// (as plain in-memory graphs). Swap individual properties to real navigation/owned-entity
/// mappings later if you need to query inside them with SQL.
/// </summary>
public static class JsonColumn
{
    private static readonly JsonSerializerOptions Options = new() { PropertyNamingPolicy = null };

    // `class?` (unconstrained-nullable reference type) lets this apply to both non-nullable
    // properties (List<T>, Dictionary<..>) and nullable ones (FormDefinition?) without the
    // compiler complaining about a mismatched `class` constraint either way.
    public static PropertyBuilder<T> HasJsonConversion<T>(this PropertyBuilder<T> builder) where T : class?
    {
        builder.HasConversion(
            v => JsonSerializer.Serialize(v, Options),
            v => JsonSerializer.Deserialize<T>(v, Options)!);

        builder.Metadata.SetValueComparer(CreateComparer<T>());
        return builder;
    }

    private static ValueComparer<T> CreateComparer<T>() where T : class?
    {
        return new ValueComparer<T>(
            (a, b) => JsonSerializer.Serialize(a, Options) == JsonSerializer.Serialize(b, Options),
            v => v == null ? 0 : JsonSerializer.Serialize(v, Options).GetHashCode(),
            v => JsonSerializer.Deserialize<T>(JsonSerializer.Serialize(v, Options), Options)!);
    }
}
