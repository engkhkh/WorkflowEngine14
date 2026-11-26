using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace WorkflowErp.Services;

public class Session
{
    public string Server { get; set; } = "";
    public string Token { get; set; } = "";
    public string Id { get; set; } = "";
    public string Username { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string Role { get; set; } = "";
    public List<string> Permissions { get; set; } = new();
    public string? TenantName { get; set; }
}

public class ErpRec
{
    public string Id { get; set; } = "";
    public string Module { get; set; } = "";
    public string Kind { get; set; } = "";
    public string? Code { get; set; }
    public string? Company { get; set; }
    public string? Branch { get; set; }
    public string? Status { get; set; }
    public string? Ref { get; set; }
    public string? CreatedBy { get; set; }
    public JsonObject Data { get; set; } = new();

    public string Label => !string.IsNullOrEmpty(Code) ? Code! : (Str("name") ?? Str("title") ?? Str("nameEn") ?? (Id.Length >= 8 ? Id[..8] : Id));
    public string Sub => Str("name") ?? Str("title") ?? Str("description") ?? Ref ?? "";
    public string? Str(string key) => Data.TryGetPropertyValue(key, out var n) && n is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
}

public class WfTask
{
    public string Id { get; set; } = "";
    public string NodeName { get; set; } = "";
    public string? Priority { get; set; }
    public string? InstanceId { get; set; }
    public JsonObject? Form { get; set; }
    public List<string> AvailableDecisions { get; set; } = new();
}

public class WfHistory
{
    public string NodeName { get; set; } = "";
    public string Action { get; set; } = "";
    public string? Actor { get; set; }
    public string? Comment { get; set; }
    public string? Timestamp { get; set; }
}

public class WfInstance
{
    public string Id { get; set; } = "";
    public string DefinitionName { get; set; } = "";
    public string Status { get; set; } = "";
    public string StartedAt { get; set; } = "";
    public List<WfHistory> History { get; set; } = new();
}

public class WfDefinition
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Description { get; set; }
}

public class CatalogKind
{
    public string Kind { get; set; } = "";
    public string En { get; set; } = "";
    public string Ar { get; set; } = "";
    public string View { get; set; } = "";
    public string Manage { get; set; } = "";
    public bool ReadOnly { get; set; }
    public JsonObject? Template { get; set; }
    public List<CatalogAction> Actions { get; set; } = new();
    public string Name(bool ar) => ar ? Ar : En;
}

/// <summary>A workflow action of a record type (confirm, approve, resolve ...): POST erp/{module}/bizact/{kind}/{id}/{op}.</summary>
public class CatalogAction
{
    public string Op { get; set; } = "";
    public string En { get; set; } = "";
    public string Ar { get; set; } = "";
    public List<string> When { get; set; } = new();
    public string Priv { get; set; } = "";
    public List<string> Ask { get; set; } = new();
    public bool Danger { get; set; }
    public string? NoteEn { get; set; }
    public string? NoteAr { get; set; }
    public string Name(bool ar) => ar ? Ar : En;
}

public class CatalogModule
{
    public string Id { get; set; } = "";
    public string En { get; set; } = "";
    public string Ar { get; set; } = "";
    public List<CatalogKind> Kinds { get; set; } = new();
    public string Name(bool ar) => ar ? Ar : En;
}

public class Catalog { public List<CatalogModule> Modules { get; set; } = new(); }

public class ApiException : Exception
{
    public bool Offline { get; init; }
    public int Status { get; init; }
    public System.Text.Json.Nodes.JsonObject? Body { get; init; }
    public ApiException(string message) : base(message) { }
}

public class ChatTurn { public string From { get; set; } = ""; public string Text { get; set; } = ""; }
public class ChatAction { public string Label { get; set; } = ""; public string Module { get; set; } = ""; public string Kind { get; set; } = ""; public string? Id { get; set; } }
public class ChatReply
{
    public string Reply { get; set; } = "";
    public List<ChatAction> Actions { get; set; } = new();
    public List<string> Suggestions { get; set; } = new();
}
