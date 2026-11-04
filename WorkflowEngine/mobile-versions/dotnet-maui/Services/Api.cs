using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace WorkflowErp.Services;

public sealed class Api
{
    public static Api I { get; } = new();
    private Api() { }

    public static string DefaultServer => DeviceInfo.Platform == DevicePlatform.Android ? "http://10.0.2.2:5000" : "http://localhost:5000";
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(40) };
    private const string Key = "wfe_maui_session";

    public Session? Session { get; private set; }
    public event Action? SignedOut;
    public bool Can(string p) => Session != null && Session.Permissions.Contains(p);

    public void Load()
    {
        try { var raw = Preferences.Default.Get(Key, ""); Session = string.IsNullOrEmpty(raw) ? null : JsonSerializer.Deserialize<Session>(raw, Json); }
        catch { Session = null; }
    }

    private void Save(Session? s)
    {
        Session = s;
        try { if (s == null) Preferences.Default.Remove(Key); else Preferences.Default.Set(Key, JsonSerializer.Serialize(s)); } catch { /* storage is optional */ }
    }

    public void SignOut() { Save(null); SignedOut?.Invoke(); }

    private static string BaseUrl(string server)
    {
        var s = server.Trim().TrimEnd('/');
        if (s.EndsWith("/api", StringComparison.OrdinalIgnoreCase)) s = s[..^4];
        return s + "/api";
    }

    public async Task Login(string server, string user, string pass)
    {
        var res = await _http.PostAsync(BaseUrl(server) + "/auth/login",
            new StringContent(JsonSerializer.Serialize(new { username = user, password = pass }), Encoding.UTF8, "application/json"));
        if (!res.IsSuccessStatusCode) throw new ApiException("login");
        var j = JsonNode.Parse(await res.Content.ReadAsStringAsync())!.AsObject();
        var s = new Session
        {
            Server = server.Trim(), Token = j["token"]?.GetValue<string>() ?? "", Id = j["id"]?.ToString() ?? "", Username = j["username"]?.ToString() ?? "",
            DisplayName = j["displayName"]?.ToString() ?? "", Role = j["role"]?.ToString() ?? "", TenantName = j["tenantName"]?.ToString(),
            Permissions = (j["permissions"] as JsonArray)?.Select(x => x?.ToString() ?? "").ToList() ?? new()
        };
        Save(s);
    }

    public async Task RefreshMe()
    {
        try
        {
            var j = (await Call(HttpMethod.Get, "/users/me")) as JsonObject;
            if (j == null || Session == null) return;
            if (j["effectivePermissions"] is JsonArray a) Session.Permissions = a.Select(x => x?.ToString() ?? "").ToList();
            Session.DisplayName = j["displayName"]?.ToString() ?? Session.DisplayName;
            Session.Role = j["role"]?.ToString() ?? Session.Role;
            Save(Session);
        }
        catch { /* keep cached privileges */ }
    }

    private async Task<JsonNode?> Call(HttpMethod method, string path, object? body = null)
    {
        var s = Session ?? throw new ApiException("not signed in");
        var req = new HttpRequestMessage(method, BaseUrl(s.Server) + path);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", s.Token);
        if (body != null) req.Content = new StringContent(body is JsonNode n ? n.ToJsonString() : JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        var res = await _http.SendAsync(req);
        if (res.StatusCode == System.Net.HttpStatusCode.Unauthorized) { SignOut(); throw new ApiException("401"); }
        var text = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode)
        {
            var msg = text;
            try { var o = JsonNode.Parse(text) as JsonObject; msg = o?["message"]?.ToString() ?? o?["error"]?.ToString() ?? o?["title"]?.ToString() ?? text; } catch { /* plain text */ }
            throw new ApiException(string.IsNullOrEmpty(msg) ? ((int)res.StatusCode).ToString() : msg);
        }
        return string.IsNullOrWhiteSpace(text) ? null : JsonNode.Parse(text);
    }

    private async Task<List<T>> List<T>(string path) => (await Call(HttpMethod.Get, path))?.Deserialize<List<T>>(Json) ?? new();

    public Task<List<WfTask>> Tasks() => List<WfTask>("/tasks");
    public Task CompleteTask(string id, string decision, string comment) => Call(HttpMethod.Post, $"/tasks/{id}/complete", new { decision, formData = new { }, comment });
    public Task<List<WfInstance>> Instances() => List<WfInstance>("/instances");
    public async Task<WfInstance?> Instance(string id) => (await Call(HttpMethod.Get, $"/instances/{id}"))?.Deserialize<WfInstance>(Json);
    public Task CancelInstance(string id) => Call(HttpMethod.Post, $"/instances/{id}/cancel", new { });
    public Task<List<WfDefinition>> Definitions() => List<WfDefinition>("/definitions");
    public Task StartInstance(string defId, Dictionary<string, object> data) => Call(HttpMethod.Post, "/instances/start", new { definitionId = defId, initialData = data });

    public Task<List<ErpRec>> Records(string module, string kind) => List<ErpRec>($"/erp/{module}/records/{kind}?take=500");
    public Task CreateRecord(string module, string kind, JsonObject body) => Call(HttpMethod.Post, $"/erp/{module}/records/{kind}", body);
    public Task UpdateRecord(string module, string kind, string id, JsonObject body) => Call(HttpMethod.Put, $"/erp/{module}/records/{kind}/{id}", body);
    public Task DeleteRecord(string module, string kind, string id) => Call(HttpMethod.Delete, $"/erp/{module}/records/{kind}/{id}");
    /// <summary>The shared ERP assistant (POST api/assistant/chat): answers from the live data this user may see.</summary>
    public async Task<ChatReply> Chat(string message, string lang, List<ChatTurn> history)
        => (await Call(HttpMethod.Post, "/assistant/chat", new { message, lang, history }))?.Deserialize<ChatReply>(Json) ?? new ChatReply();
    public Task ApprovalAct(string id, string op, string note) => Call(HttpMethod.Post, $"/erp/gov/approvals/{id}/{op}", new { note });
}
