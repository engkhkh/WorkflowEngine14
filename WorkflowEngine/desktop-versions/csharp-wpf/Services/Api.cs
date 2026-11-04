using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace WorkflowErp.Services;

public sealed class Api
{
    public static Api I { get; } = new();
    private Api() { }

    public const string DefaultServer = "http://localhost:63353";
    private static readonly JsonSerializerOptions Json = new() { PropertyNameCaseInsensitive = true };
    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(40) };
    private static readonly string Dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "WorkflowErpWpf");
    private static readonly string SessionFile = Path.Combine(Dir, "session.json");

    public Session? Session { get; private set; }
    public bool Can(string p) => Session != null && Session.Permissions.Contains(p);

    public void Load()
    {
        try { Session = File.Exists(SessionFile) ? JsonSerializer.Deserialize<Session>(File.ReadAllText(SessionFile), Json) : null; }
        catch { Session = null; }
    }

    private void Save(Session? s)
    {
        Session = s;
        try
        {
            Directory.CreateDirectory(Dir);
            if (s == null) { if (File.Exists(SessionFile)) File.Delete(SessionFile); }
            else File.WriteAllText(SessionFile, JsonSerializer.Serialize(s));
        }
        catch { /* storage is optional */ }
    }

    public void SignOut() => Save(null);

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
        Save(new Session
        {
            Server = server.Trim(), Token = j["token"]?.GetValue<string>() ?? "", Id = j["id"]?.ToString() ?? "", Username = j["username"]?.ToString() ?? "",
            DisplayName = j["displayName"]?.ToString() ?? "", Role = j["role"]?.ToString() ?? "", TenantName = j["tenantName"]?.ToString(),
            Permissions = (j["permissions"] as JsonArray)?.Select(x => x?.ToString() ?? "").ToList() ?? new()
        });
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
        HttpResponseMessage res;
        try { res = await _http.SendAsync(req); }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException) { throw new ApiException(e.Message) { Offline = true }; }
        if (res.StatusCode == System.Net.HttpStatusCode.Unauthorized) { SignOut(); throw new ApiException("401"); }
        var text = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode)
        {
            var msg = text; JsonObject? errBody = null;
            try { errBody = JsonNode.Parse(text) as JsonObject; msg = errBody?["message"]?.ToString() ?? errBody?["error"]?.ToString() ?? errBody?["title"]?.ToString() ?? text; } catch { /* plain text */ }
            throw new ApiException(string.IsNullOrEmpty(msg) ? ((int)res.StatusCode).ToString() : msg) { Status = (int)res.StatusCode, Body = errBody };
        }
        return string.IsNullOrWhiteSpace(text) ? null : JsonNode.Parse(text);
    }

    private async Task<List<T>> List<T>(string path) => (await Call(HttpMethod.Get, path))?.Deserialize<List<T>>(Json) ?? new();

    // ---- hospital (generic: the screens are described by data/hospital.json)
    public async Task<JsonNode?> Hos(HttpMethod method, string path, JsonObject? body = null) => await Call(method, "/hospital/" + path, body);

    // ---- point of sale
    public async Task<JsonArray> PosRecords(string kind, string query = "") => await Call(HttpMethod.Get, $"/pos/records/{kind}?take=5000" + (query.Length > 0 ? "&" + query : "")) as JsonArray ?? new JsonArray();
    public async Task<JsonObject> PosCheckout(JsonObject body) => await Call(HttpMethod.Post, "/pos/sales/checkout", body) as JsonObject ?? new JsonObject();
    public async Task<JsonObject> PosReturn(string id, JsonArray lines, string method, string reason) => await Call(HttpMethod.Post, $"/pos/sales/{id}/return", new JsonObject { ["lines"] = lines, ["method"] = method, ["reason"] = reason }) as JsonObject ?? new JsonObject();
    public async Task<JsonObject> PosVoid(string id) => await Call(HttpMethod.Post, $"/pos/sales/{id}/void", new { }) as JsonObject ?? new JsonObject();
    public async Task<JsonObject?> PosShift() => await Call(HttpMethod.Get, "/pos/shifts/current") as JsonObject;
    public async Task<JsonObject> PosOpen(JsonObject body) => await Call(HttpMethod.Post, "/pos/shifts/open", body) as JsonObject ?? new JsonObject();
    public async Task<JsonObject> PosCash(string id, string type, double amount, string reason) => await Call(HttpMethod.Post, $"/pos/shifts/{id}/cash", new JsonObject { ["type"] = type, ["amount"] = amount, ["reason"] = reason }) as JsonObject ?? new JsonObject();
    public async Task<JsonObject> PosClose(string id, double counted, string note) => await Call(HttpMethod.Post, $"/pos/shifts/{id}/close", new JsonObject { ["countedCash"] = counted, ["note"] = note }) as JsonObject ?? new JsonObject();

    public Task<List<WfTask>> Tasks() => List<WfTask>("/tasks");
    public Task CompleteTask(string id, string decision, string comment, JsonObject? form = null)
        => Call(HttpMethod.Post, $"/tasks/{id}/complete", new JsonObject { ["decision"] = decision, ["formData"] = form ?? new JsonObject(), ["comment"] = comment });
    public async Task<JsonArray> InstancesRaw() => await Call(HttpMethod.Get, "/instances") as JsonArray ?? new JsonArray();
    public async Task<JsonArray> TasksRaw() => await Call(HttpMethod.Get, "/tasks") as JsonArray ?? new JsonArray();
    public Task<List<WfInstance>> Instances() => List<WfInstance>("/instances");
    public async Task<WfInstance?> Instance(string id) => (await Call(HttpMethod.Get, $"/instances/{id}"))?.Deserialize<WfInstance>(Json);
    public Task CancelInstance(string id) => Call(HttpMethod.Post, $"/instances/{id}/cancel", new { });
    public Task<List<WfDefinition>> Definitions() => List<WfDefinition>("/definitions");
    public async Task<JsonObject?> StartInstance(string defId, Dictionary<string, object> data) => await Call(HttpMethod.Post, "/instances/start", new { definitionId = defId, initialData = data }) as JsonObject;

    // Collaboration: notes, attachments and saved filters (same store as the portal).
    public async Task<JsonArray> Notes(string m, string k, string id) => await Call(HttpMethod.Get, $"/collab/{m}/{k}/{id}/notes") as JsonArray ?? new JsonArray();
    public Task AddNote(string m, string k, string id, string text) => Call(HttpMethod.Post, $"/collab/{m}/{k}/{id}/notes", new JsonObject { ["text"] = text, ["system"] = false });
    public Task DeleteNote(string nid) => Call(HttpMethod.Delete, $"/collab/notes/{nid}");
    public async Task<JsonArray> Files(string m, string k, string id) => await Call(HttpMethod.Get, $"/collab/{m}/{k}/{id}/files") as JsonArray ?? new JsonArray();
    public Task AddFile(string m, string k, string id, string name, string type, string contentB64) => Call(HttpMethod.Post, $"/collab/{m}/{k}/{id}/files", new JsonObject { ["name"] = name, ["type"] = type, ["content"] = contentB64 });
    public Task DeleteFile(string fid) => Call(HttpMethod.Delete, $"/collab/files/{fid}");
    public async Task<byte[]> FileBytes(string fid)
    {
        var s = Session ?? throw new ApiException("not signed in");
        var req = new HttpRequestMessage(HttpMethod.Get, BaseUrl(s.Server) + $"/collab/files/{fid}");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", s.Token);
        var res = await _http.SendAsync(req);
        if (!res.IsSuccessStatusCode) throw new ApiException(((int)res.StatusCode).ToString());
        return await res.Content.ReadAsByteArrayAsync();
    }
    /// <summary>GET a non-JSON answer (for example an .ics file)</summary>
    public async Task<byte[]> Raw(string path)
    {
        var s = Session ?? throw new ApiException("not signed in");
        var req = new HttpRequestMessage(HttpMethod.Get, BaseUrl(s.Server) + path);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", s.Token);
        var res = await _http.SendAsync(req);
        if (!res.IsSuccessStatusCode) throw new ApiException(((int)res.StatusCode).ToString());
        return await res.Content.ReadAsByteArrayAsync();
    }

    /// <summary>calendar and meetings</summary>
    /// <summary>finance reports (the records themselves are the generic /finance/records/&lt;kind&gt;)</summary>
    public async Task<JsonNode?> Fin(HttpMethod method, string path, JsonObject? body = null) => await Call(method, "/finance/" + path, body);
    /// <summary>HR reports and the employee import (the lists are the generic /hr/records/&lt;kind&gt; and /hr/employees)</summary>
    /// <summary>any backend path (the operations page reads /erp/mfg, /erp/prj and /finance/zatca)</summary>
    public async Task<JsonNode?> Ops(HttpMethod method, string path, JsonObject? body = null) => await Call(method, path, body);
    public async Task<JsonNode?> Hr(HttpMethod method, string path, JsonObject? body = null) => await Call(method, "/hr/" + path, body);
    public async Task<JsonNode?> Cal(HttpMethod method, string path, JsonObject? body = null) => await Call(method, "/calendar/" + path, body);

    public async Task<JsonArray> Filters(string view) => await Call(HttpMethod.Get, "/collab/configs/filter?view=" + Uri.EscapeDataString(view)) as JsonArray ?? new JsonArray();
    public Task SaveFilter(string view, string name, bool shared, JsonObject data) => Call(HttpMethod.Post, "/collab/configs/filter?view=" + Uri.EscapeDataString(view), new JsonObject { ["name"] = name, ["shared"] = shared, ["data"] = data });
    public async Task<JsonArray> Configs(string kind, string view) => await Call(HttpMethod.Get, $"/collab/configs/{kind}?view=" + Uri.EscapeDataString(view)) as JsonArray ?? new JsonArray();
    public Task SaveConfig(string kind, string view, string name, bool shared, JsonObject data) => Call(HttpMethod.Post, $"/collab/configs/{kind}?view=" + Uri.EscapeDataString(view), new JsonObject { ["name"] = name, ["shared"] = shared, ["data"] = data });
    public Task DeleteConfig(string kind, string id) => Call(HttpMethod.Delete, $"/collab/configs/{kind}/{id}");
    public Task DeleteFilter(string fid) => Call(HttpMethod.Delete, $"/collab/configs/filter/{fid}");

    // Record APIs: most modules live under /erp/<module>; finance, HR, POS and hospital have their own controllers.
    private static string Base(string module, string kind)
    {
        if (module == "hr" && kind == "employee") return "/hr/employees";
        var pre = module switch { "fin" => "/finance", "hr" => "/hr", "pos" => "/pos", "hos" => "/hospital", _ => "/erp/" + module };
        return $"{pre}/records/{kind}";
    }
    private static bool IsEmp(string module, string kind) => module == "hr" && kind == "employee";

    private static ErpRec EmpToRec(JsonObject e)
    {
        var data = new JsonObject();
        foreach (var kv in e)
            if (kv.Key is not ("id" or "empNo" or "status" or "tenantId" or "createdAt" or "updatedAt")) data[kv.Key] = kv.Value?.DeepClone();
        return new ErpRec { Id = e["id"]?.ToString() ?? "", Module = "hr", Kind = "employee", Code = e["empNo"]?.ToString(), Status = e["status"]?.ToString(), Data = data };
    }

    private static JsonObject EmpBody(JsonObject body, string? id)
    {
        var o = body["data"] is JsonObject d ? (JsonObject)d.DeepClone() : new JsonObject();
        o["empNo"] = body["code"]?.DeepClone();
        o["status"] = body["status"]?.DeepClone();
        if (id != null) o["id"] = id;
        return o;
    }

    // ---- Setup & administration (users, roles, companies, branches): the portal's Setup screens as record lists
    private static JsonNode? Dup(JsonNode? n) => n?.DeepClone();
    private static string Str(JsonObject o, string k) => o[k]?.ToString() ?? "";

    private static ErpRec AdmRec(string kind, JsonObject x)
    {
        var data = new JsonObject();
        string id, code, status;
        if (kind == "user")
        {
            foreach (var k in new[] { "displayName", "email", "role" }) if (x[k] != null) data[k] = Dup(x[k]);
            if (x["branches"] is JsonArray) data["branches"] = Dup(x["branches"]);
            if (x["permissions"] is JsonArray) data["permissions"] = Dup(x["permissions"]);
            data["newPassword"] = "";
            id = Str(x, "id"); code = Str(x, "username"); status = x["isActive"]?.GetValue<bool>() == false ? "Inactive" : "Active";
        }
        else if (kind == "role")
        {
            data["name"] = Str(x, "name"); data["users"] = Dup(x["users"]); data["permissions"] = x["permissions"] is JsonArray ? Dup(x["permissions"]) : new JsonArray();
            id = code = Str(x, "role"); status = x["isSystem"]?.GetValue<bool>() == true ? "System" : "Custom";
        }
        else
        {
            foreach (var kv in x) if (kv.Key != "code") data[kv.Key] = Dup(kv.Value);
            id = code = Str(x, "code"); status = "Active";
        }
        return new ErpRec { Id = id, Module = "adm", Kind = kind, Code = code, Status = status, Data = data };
    }

    private async Task<List<ErpRec>> AdmRecords(string kind)
    {
        var node = await Call(HttpMethod.Get, kind == "user" ? "/users/admin" : kind == "role" ? "/admin/rbac" : "/org");
        JsonArray src = kind == "user" ? node as JsonArray ?? new JsonArray()
            : kind == "role" ? (node as JsonObject)?["roles"] as JsonArray ?? new JsonArray()
            : (node as JsonObject)?[kind == "company" ? "companies" : "branches"] as JsonArray ?? new JsonArray();
        return src.OfType<JsonObject>().Select(x => AdmRec(kind, x)).ToList();
    }

    private async Task AdmWrite(bool create, string kind, string? id, JsonObject body)
    {
        var d = body["data"] as JsonObject ?? new JsonObject();
        var code = Str(body, "code"); if (code == "") code = id ?? "";
        if (kind == "user")
        {
            var req = new JsonObject
            {
                ["displayName"] = Str(d, "displayName"), ["email"] = Str(d, "email"), ["role"] = d["role"] != null ? Str(d, "role") : "employee",
                ["isActive"] = Str(body, "status") != "Inactive", ["permissions"] = Dup(d["permissions"]), ["branches"] = Dup(d["branches"])
            };
            if (create)
            {
                req["username"] = code; req["password"] = Str(d, "password") != "" ? Str(d, "password") : Str(d, "newPassword");
                await Call(HttpMethod.Post, "/users/admin", req);
            }
            else
            {
                await Call(HttpMethod.Put, "/users/admin/" + id, req);
                if (Str(d, "newPassword") != "") await Call(HttpMethod.Post, $"/users/admin/{id}/reset-password", new { password = Str(d, "newPassword") });
            }
        }
        else if (kind == "role")
        {
            if (create)
            {
                var req = new JsonObject { ["role"] = code, ["name"] = Dup(d["name"]), ["copyFrom"] = Dup(d["copyFrom"]) };
                if (d["permissions"] is JsonArray pa && pa.Count > 0) req["permissions"] = Dup(pa);
                await Call(HttpMethod.Post, "/admin/rbac/roles", req);
            }
            else await Call(HttpMethod.Put, "/admin/rbac/roles/" + id, new JsonObject { ["name"] = Dup(d["name"]), ["permissions"] = d["permissions"] is JsonArray ? Dup(d["permissions"]) : new JsonArray() });
        }
        else
        {
            var path = kind == "company" ? "/org/companies" : "/org/branches";
            var req = (JsonObject)d.DeepClone(); req["code"] = code;
            if (create) await Call(HttpMethod.Post, path, req); else await Call(HttpMethod.Put, path + "/" + id, req);
        }
    }

    private static string AdmPath(string kind) => kind switch { "user" => "/users/admin", "role" => "/admin/rbac/roles", "company" => "/org/companies", _ => "/org/branches" };

    // ---- Workflow designer (definitions are handled as raw JSON so every node property round-trips untouched)
    public async Task<JsonObject> WfDefinition(string id) => await Call(HttpMethod.Get, $"/definitions/{id}") as JsonObject ?? new JsonObject();
    public async Task<JsonArray> WfList(string path) => await Call(HttpMethod.Get, path) as JsonArray ?? new JsonArray();
    public async Task<JsonObject> WfSave(string? id, JsonObject body) => (string.IsNullOrEmpty(id) ? await Call(HttpMethod.Post, "/definitions", body) : await Call(HttpMethod.Put, $"/definitions/{id}", body)) as JsonObject ?? new JsonObject();
    public async Task<JsonObject> WfPublish(string id) => await Call(HttpMethod.Post, $"/definitions/{id}/publish", new { }) as JsonObject ?? new JsonObject();
    public Task WfDelete(string id) => Call(HttpMethod.Delete, $"/definitions/{id}");
    public async Task<JsonObject> WfTest(string expr, JsonObject data) => await Call(HttpMethod.Post, "/definitions/test-condition", new JsonObject { ["expression"] = expr, ["data"] = data }) as JsonObject ?? new JsonObject();
    public async Task<JsonObject> WfInstance(string id) => await Call(HttpMethod.Get, $"/instances/{id}") as JsonObject ?? new JsonObject();
    public async Task<JsonObject> WfStart(string defId) => await Call(HttpMethod.Post, "/instances/start", new JsonObject { ["definitionId"] = defId }) as JsonObject ?? new JsonObject();
    public async Task<JsonObject> WfCancel(string id) => await Call(HttpMethod.Post, $"/instances/{id}/cancel", new { }) as JsonObject ?? new JsonObject();

    public async Task<List<ErpRec>> Records(string module, string kind)
    {
        if (module == "adm") return await AdmRecords(kind);
        if (IsEmp(module, kind))
            return ((await Call(HttpMethod.Get, "/hr/employees")) as JsonArray ?? new JsonArray()).OfType<JsonObject>().Select(EmpToRec).ToList();
        return await List<ErpRec>(Base(module, kind) + "?take=500");
    }
    public Task CreateRecord(string module, string kind, JsonObject body) => module == "adm" ? AdmWrite(true, kind, null, body) : IsEmp(module, kind) ? Call(HttpMethod.Post, "/hr/employees", EmpBody(body, null)) : Call(HttpMethod.Post, Base(module, kind), body);
    public Task UpdateRecord(string module, string kind, string id, JsonObject body) => module == "adm" ? AdmWrite(false, kind, id, body) : Call(HttpMethod.Put, Base(module, kind) + "/" + id, IsEmp(module, kind) ? EmpBody(body, id) : body);
    public Task DeleteRecord(string module, string kind, string id) => module == "adm" ? Call(HttpMethod.Delete, AdmPath(kind) + "/" + id) : Call(HttpMethod.Delete, Base(module, kind) + "/" + id);
    /// <summary>The shared ERP assistant (POST api/assistant/chat): answers from the live data this user may see.</summary>
    public async Task<ChatReply> Chat(string message, string lang, List<ChatTurn> history)
        => (await Call(HttpMethod.Post, "/assistant/chat", new { message, lang, history }))?.Deserialize<ChatReply>(Json) ?? new ChatReply();
    public Task ApprovalAct(string id, string op, string note) => Call(HttpMethod.Post, $"/erp/gov/approvals/{id}/{op}", new { note });
}
