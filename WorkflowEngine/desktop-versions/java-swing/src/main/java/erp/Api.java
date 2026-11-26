package erp;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** HTTP client for the Workflow ERP backend. */
public final class Api {
    public static final Api I = new Api();
    public static final String DEFAULT_SERVER = "http://localhost:63353";
    private static final Path FILE = Path.of(System.getProperty("user.home"), ".workflow_erp_swing.json");

    public static class ApiException extends RuntimeException {
        public boolean offline;
        public int status;
        public Map<String, Object> body = new LinkedHashMap<>();
        public ApiException(String m) { super(m); }
        public ApiException(String m, boolean offline) { super(m); this.offline = offline; }
    }

    public String server = "", token = "", username = "", displayName = "", role = "", tenant = "";
    public List<String> permissions = new ArrayList<>();
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build();

    private Api() { }

    public boolean signedIn() { return !token.isEmpty(); }
    public boolean can(String p) { return permissions.contains(p); }

    public void load() {
        try {
            Map<String, Object> m = Json.obj(Json.parse(Files.readString(FILE, StandardCharsets.UTF_8)));
            server = Json.str(m.get("server")); token = Json.str(m.get("token")); username = Json.str(m.get("username"));
            displayName = Json.str(m.get("displayName")); role = Json.str(m.get("role")); tenant = Json.str(m.get("tenant"));
            permissions = new ArrayList<>();
            for (Object o : Json.arr(m.get("permissions"))) permissions.add(String.valueOf(o));
        } catch (Exception e) { token = ""; }
    }

    private void save() {
        try {
            if (!signedIn()) { Files.deleteIfExists(FILE); return; }
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("server", server); m.put("token", token); m.put("username", username); m.put("displayName", displayName);
            m.put("role", role); m.put("tenant", tenant); m.put("permissions", permissions);
            Files.writeString(FILE, Json.write(m), StandardCharsets.UTF_8);
        } catch (IOException ignored) { /* storage is optional */ }
    }

    public void signOut() { token = ""; permissions = new ArrayList<>(); save(); }

    private static String base(String srv) {
        String s = srv.trim().replaceAll("/+$", "");
        if (s.toLowerCase().endsWith("/api")) s = s.substring(0, s.length() - 4);
        return s + "/api";
    }

    private Object call(String method, String path, Object body, String srv, boolean auth) {
        try {
            HttpRequest.Builder rb = HttpRequest.newBuilder(URI.create(base(srv) + path)).timeout(Duration.ofSeconds(40))
                    .header("Content-Type", "application/json");
            if (auth) rb.header("Authorization", "Bearer " + token);
            HttpRequest.BodyPublisher pub = body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(Json.write(body));
            rb.method(method, pub);
            HttpResponse<String> res = http.send(rb.build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            String text = res.body() == null ? "" : res.body();
            if (res.statusCode() == 401 && auth) { signOut(); throw new ApiException("401"); }
            if (res.statusCode() < 200 || res.statusCode() >= 300) {
                String msg = text;
                Map<String, Object> j = new LinkedHashMap<>();
                try {
                    j = Json.obj(Json.parse(text));
                    for (String k : new String[]{"message", "error", "title"}) if (j.get(k) != null) { msg = Json.str(j.get(k)); break; }
                } catch (Exception ignored) { /* plain text */ }
                ApiException ex = new ApiException(msg.isEmpty() ? String.valueOf(res.statusCode()) : msg);
                ex.status = res.statusCode(); ex.body = j;
                throw ex;
            }
            return text.isBlank() ? null : Json.parse(text);
        } catch (IOException e) {
            throw new ApiException(e.getMessage() == null ? e.toString() : e.getMessage(), true);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ApiException("interrupted");
        } catch (IllegalArgumentException e) {
            throw new ApiException(e.getMessage());
        }
    }

    private Object call(String method, String path, Object body) {
        if (!signedIn()) throw new ApiException("not signed in");
        return call(method, path, body, server, true);
    }

    private static Map<String, Object> map(Object... kv) {
        Map<String, Object> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    public void login(String srv, String user, String pass) {
        Map<String, Object> j;
        try { j = Json.obj(call("POST", "/auth/login", map("username", user, "password", pass), srv, false)); }
        catch (ApiException e) { throw new ApiException("login"); }
        server = srv.trim(); token = Json.str(j.get("token")); username = Json.str(j.get("username")); displayName = Json.str(j.get("displayName"));
        role = Json.str(j.get("role")); tenant = Json.str(j.get("tenantName"));
        permissions = new ArrayList<>();
        for (Object o : Json.arr(j.get("permissions"))) permissions.add(String.valueOf(o));
        save();
    }

    public void refreshMe() {
        try {
            Map<String, Object> j = Json.obj(call("GET", "/users/me", null));
            List<Object> eff = Json.arr(j.get("effectivePermissions"));
            if (!eff.isEmpty()) { permissions = new ArrayList<>(); for (Object o : eff) permissions.add(String.valueOf(o)); }
            if (j.get("displayName") != null) displayName = Json.str(j.get("displayName"));
            if (j.get("role") != null) role = Json.str(j.get("role"));
            save();
        } catch (RuntimeException ignored) { /* keep cached privileges */ }
    }

    private static List<Map<String, Object>> list(Object o) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (Object x : Json.arr(o)) out.add(Json.obj(x));
        return out;
    }

    public List<Map<String, Object>> tasks() { return list(call("GET", "/tasks", null)); }
    public void completeTask(String id, String decision, String comment) { completeTask(id, decision, comment, map()); }
    public void completeTask(String id, String decision, String comment, Map<String, Object> form) { call("POST", "/tasks/" + id + "/complete", map("decision", decision, "formData", form == null ? map() : form, "comment", comment)); }

    // notes, files and saved filters of a record (same endpoints as the portal's chatter)
    public List<Map<String, Object>> notes(String mod, String kind, String id) { return list(call("GET", "/collab/" + mod + "/" + kind + "/" + id + "/notes", null)); }
    public void addNote(String mod, String kind, String id, String text) { call("POST", "/collab/" + mod + "/" + kind + "/" + id + "/notes", map("text", text, "system", false)); }
    public void deleteNote(String id) { call("DELETE", "/collab/notes/" + id, null); }
    public List<Map<String, Object>> files(String mod, String kind, String id) { return list(call("GET", "/collab/" + mod + "/" + kind + "/" + id + "/files", null)); }
    public void addFile(String mod, String kind, String id, String name, String type, String b64) { call("POST", "/collab/" + mod + "/" + kind + "/" + id + "/files", map("name", name, "type", type, "content", b64)); }
    public void deleteFile(String id) { call("DELETE", "/collab/files/" + id, null); }

    /** GET a non-JSON answer (for example an .ics file) */
    public byte[] raw(String path) {
        try {
            HttpRequest rq = HttpRequest.newBuilder(URI.create(base(server) + path)).timeout(Duration.ofSeconds(60)).header("Authorization", "Bearer " + token).GET().build();
            HttpResponse<byte[]> res = http.send(rq, HttpResponse.BodyHandlers.ofByteArray());
            if (res.statusCode() < 200 || res.statusCode() >= 300) throw new ApiException(new String(res.body(), StandardCharsets.UTF_8));
            return res.body();
        } catch (IOException e) { throw new ApiException(e.getMessage() == null ? e.toString() : e.getMessage()); }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new ApiException("interrupted"); }
    }

    /** calendar and meetings */
    public Object cal(String method, String path, Object body) { return call(method, "/calendar/" + path, body); }

    public byte[] fileBytes(String id) {
        try {
            HttpRequest rq = HttpRequest.newBuilder(URI.create(base(server) + "/collab/files/" + id)).timeout(Duration.ofSeconds(60)).header("Authorization", "Bearer " + token).GET().build();
            HttpResponse<byte[]> res = http.send(rq, HttpResponse.BodyHandlers.ofByteArray());
            if (res.statusCode() < 200 || res.statusCode() >= 300) throw new ApiException(new String(res.body(), StandardCharsets.UTF_8));
            return res.body();
        } catch (IOException e) { throw new ApiException(e.getMessage() == null ? e.toString() : e.getMessage()); }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new ApiException("interrupted"); }
    }

    private static String enc(String s) { return java.net.URLEncoder.encode(s, StandardCharsets.UTF_8); }
    public List<Map<String, Object>> filters(String view) { return list(call("GET", "/collab/configs/filter?view=" + enc(view), null)); }
    public void saveFilter(String view, String name, boolean shared, Map<String, Object> data) { call("POST", "/collab/configs/filter?view=" + enc(view), map("name", name, "shared", shared, "data", data)); }
    public List<Map<String, Object>> configs(String kind, String view) { return list(call("GET", "/collab/configs/" + kind + "?view=" + enc(view), null)); }
    public void saveConfig(String kind, String view, String name, boolean shared, Map<String, Object> data) { call("POST", "/collab/configs/" + kind + "?view=" + enc(view), map("name", name, "shared", shared, "data", data)); }
    public void deleteConfig(String kind, String id) { call("DELETE", "/collab/configs/" + kind + "/" + id, null); }
    public void deleteFilter(String id) { call("DELETE", "/collab/configs/filter/" + id, null); }
    public List<Map<String, Object>> instances() { return list(call("GET", "/instances", null)); }
    public Map<String, Object> instance(String id) { return Json.obj(call("GET", "/instances/" + id, null)); }
    public void cancelInstance(String id) { call("POST", "/instances/" + id + "/cancel", map()); }
    public List<Map<String, Object>> definitions() { return list(call("GET", "/definitions", null)); }
    // ---- workflow designer
    public Map<String, Object> definition(String id) { return Json.obj(call("GET", "/definitions/" + id, null)); }
    public Map<String, Object> saveDefinition(String id, Map<String, Object> body) {
        return Json.obj(id == null || id.isEmpty() ? call("POST", "/definitions", body) : call("PUT", "/definitions/" + id, body));
    }
    public Map<String, Object> publishDefinition(String id) { return Json.obj(call("POST", "/definitions/" + id + "/publish", map())); }
    public void deleteDefinition(String id) { call("DELETE", "/definitions/" + id, null); }
    public List<Map<String, Object>> users() { return list(call("GET", "/users", null)); }
    public Map<String, Object> testCondition(String expr, Map<String, Object> data) { return Json.obj(call("POST", "/definitions/test-condition", map("expression", expr, "data", data))); }
    public List<Map<String, Object>> activityLog(String id) { return list(call("GET", "/instances/" + id + "/activity-log", null)); }
    public Map<String, Object> startRun(String defId) { return Json.obj(call("POST", "/instances/start", map("definitionId", defId, "initialData", null))); }
    public Map<String, Object> cancelRun(String id) { return Json.obj(call("POST", "/instances/" + id + "/cancel", map())); }
    public Map<String, Object> startInstance(String defId, Map<String, Object> data) { return Json.obj(call("POST", "/instances/start", map("definitionId", defId, "initialData", data))); }

    // Record APIs: most modules live under /erp/<module>; finance, HR, POS and hospital have their own controllers.
    private static String base(String module, String kind) {
        if ("hr".equals(module) && "employee".equals(kind)) return "/hr/employees";
        String pre;
        switch (module) {
            case "fin": pre = "/finance"; break;
            case "hr": pre = "/hr"; break;
            case "pos": pre = "/pos"; break;
            case "hos": pre = "/hospital"; break;
            default: pre = "/erp/" + module;
        }
        return pre + "/records/" + kind;
    }
    private static boolean isEmp(String module, String kind) { return "hr".equals(module) && "employee".equals(kind); }
    private static Map<String, Object> empToRec(Map<String, Object> e) {
        Map<String, Object> data = new LinkedHashMap<>(e);
        for (String k : new String[]{"id", "empNo", "status", "tenantId", "createdAt", "updatedAt"}) data.remove(k);
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("id", e.get("id")); r.put("module", "hr"); r.put("kind", "employee"); r.put("code", e.get("empNo")); r.put("status", e.get("status")); r.put("data", data);
        return r;
    }
    @SuppressWarnings("unchecked")
    private static Map<String, Object> empBody(Map<String, Object> body, String id) {
        Map<String, Object> out = new LinkedHashMap<>(Json.obj(body.get("data")));
        out.put("empNo", body.get("code")); out.put("status", body.get("status"));
        if (id != null) out.put("id", id);
        return out;
    }

    // ---- Setup & administration (users, roles, companies, branches): the portal's Setup screens as record lists
    private static Map<String, Object> admRec(String kind, Map<String, Object> x) {
        Map<String, Object> r = new LinkedHashMap<>(), data = new LinkedHashMap<>();
        r.put("module", "adm"); r.put("kind", kind);
        if (kind.equals("user")) {
            for (String k : new String[]{"displayName", "email", "role"}) if (x.containsKey(k)) data.put(k, x.get(k));
            if (x.get("branches") != null) data.put("branches", x.get("branches"));
            if (x.get("permissions") != null) data.put("permissions", x.get("permissions"));
            data.put("newPassword", "");
            r.put("id", x.get("id")); r.put("code", x.get("username")); r.put("status", Boolean.FALSE.equals(x.get("isActive")) ? "Inactive" : "Active");
        } else if (kind.equals("role")) {
            data.put("name", x.get("name") == null ? "" : x.get("name")); data.put("users", x.get("users")); data.put("permissions", x.get("permissions") == null ? new ArrayList<>() : x.get("permissions"));
            r.put("id", x.get("role")); r.put("code", x.get("role")); r.put("status", Boolean.TRUE.equals(x.get("isSystem")) ? "System" : "Custom");
        } else {
            for (Map.Entry<String, Object> e : x.entrySet()) if (!e.getKey().equals("code")) data.put(e.getKey(), e.getValue());
            r.put("id", x.get("code")); r.put("code", x.get("code")); r.put("status", "Active");
        }
        r.put("data", data);
        return r;
    }
    private List<Map<String, Object>> admRecords(String kind) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (kind.equals("user")) { for (Map<String, Object> u : list(call("GET", "/users/admin", null))) out.add(admRec(kind, u)); }
        else if (kind.equals("role")) { for (Object r : Json.arr(Json.obj(call("GET", "/admin/rbac", null)).get("roles"))) out.add(admRec(kind, Json.obj(r))); }
        else { for (Object r : Json.arr(Json.obj(call("GET", "/org", null)).get(kind.equals("company") ? "companies" : "branches"))) out.add(admRec(kind, Json.obj(r))); }
        return out;
    }
    private void admWrite(boolean create, String kind, String id, Map<String, Object> body) {
        Map<String, Object> d = Json.obj(body.get("data"));
        String code = Json.str(body.get("code")).isEmpty() ? id : Json.str(body.get("code"));
        if (kind.equals("user")) {
            Map<String, Object> req = new LinkedHashMap<>();
            req.put("displayName", Json.str(d.get("displayName"))); req.put("email", Json.str(d.get("email"))); req.put("role", d.get("role") == null ? "employee" : d.get("role"));
            req.put("isActive", !"Inactive".equals(Json.str(body.get("status")))); req.put("permissions", d.get("permissions")); req.put("branches", d.get("branches"));
            if (create) { req.put("username", code); req.put("password", !Json.str(d.get("password")).isEmpty() ? d.get("password") : d.get("newPassword")); call("POST", "/users/admin", req); }
            else { call("PUT", "/users/admin/" + id, req); if (!Json.str(d.get("newPassword")).isEmpty()) call("POST", "/users/admin/" + id + "/reset-password", map("password", d.get("newPassword"))); }
        } else if (kind.equals("role")) {
            if (create) {
                Map<String, Object> req = map("role", code, "name", d.get("name"), "copyFrom", d.get("copyFrom"));
                if (!Json.arr(d.get("permissions")).isEmpty()) req.put("permissions", d.get("permissions"));
                call("POST", "/admin/rbac/roles", req);
            } else call("PUT", "/admin/rbac/roles/" + id, map("name", d.get("name"), "permissions", d.get("permissions") == null ? new ArrayList<>() : d.get("permissions")));
        } else {
            String path = kind.equals("company") ? "/org/companies" : "/org/branches";
            Map<String, Object> req = new LinkedHashMap<>(d); req.put("code", code);
            if (create) call("POST", path, req); else call("PUT", path + "/" + id, req);
        }
    }
    private void admDelete(String kind, String id) {
        String path = kind.equals("user") ? "/users/admin" : kind.equals("role") ? "/admin/rbac/roles" : kind.equals("company") ? "/org/companies" : "/org/branches";
        call("DELETE", path + "/" + id, null);
    }

    public List<Map<String, Object>> records(String module, String kind) {
        if ("adm".equals(module)) return admRecords(kind);
        if (isEmp(module, kind)) { List<Map<String, Object>> out = new ArrayList<>(); for (Map<String, Object> e : list(call("GET", "/hr/employees", null))) out.add(empToRec(e)); return out; }
        return list(call("GET", base(module, kind) + "?take=500", null));
    }
    public void createRecord(String module, String kind, Map<String, Object> body) { if ("adm".equals(module)) { admWrite(true, kind, null, body); return; } call("POST", isEmp(module, kind) ? "/hr/employees" : base(module, kind), isEmp(module, kind) ? empBody(body, null) : body); }
    public void updateRecord(String module, String kind, String id, Map<String, Object> body) { if ("adm".equals(module)) { admWrite(false, kind, id, body); return; } call("PUT", base(module, kind) + "/" + id, isEmp(module, kind) ? empBody(body, id) : body); }
    public void deleteRecord(String module, String kind, String id) { if ("adm".equals(module)) { admDelete(kind, id); return; } call("DELETE", base(module, kind) + "/" + id, null); }
    /** The shared ERP assistant (POST api/assistant/chat): answers from the live data this user may see. */
    public Map<String, Object> chat(String message, String lang, List<Map<String, Object>> history) { return Json.obj(call("POST", "/assistant/chat", map("message", message, "lang", lang, "history", history))); }
    /** finance reports (the records themselves are the generic /finance/records/<kind>) */
    public Object fin(String method, String path, Object body) { return call(method, "/finance/" + path, body); }
    /** HR reports and the employee import (the lists are the generic /hr/records/<kind> and /hr/employees) */
    /** any backend path (the operations page reads /erp/mfg, /erp/prj and /finance/zatca) */
    public Object ops(String method, String path, Object body) { return call(method, path, body); }
    public Object hr(String method, String path, Object body) { return call(method, "/hr/" + path, body); }
    // ---- point of sale
    public List<Map<String, Object>> posRecords(String kind, String query) { return list(call("GET", "/pos/records/" + kind + "?take=5000" + (query == null || query.isEmpty() ? "" : "&" + query), null)); }
    /** hospital: the screens are described by hospital.json, so one generic call serves all of them */
    public Object hos(String method, String path, Object body) { return call(method, "/hospital/" + path, body); }
    public Map<String, Object> posCheckout(Map<String, Object> body) { return Json.obj(call("POST", "/pos/sales/checkout", body)); }
    public Map<String, Object> posReturn(String id, List<Object> lines, String method, String reason) { return Json.obj(call("POST", "/pos/sales/" + id + "/return", map("lines", lines, "method", method, "reason", reason))); }
    public Map<String, Object> posVoid(String id) { return Json.obj(call("POST", "/pos/sales/" + id + "/void", map())); }
    public Map<String, Object> posShift() { Object o = call("GET", "/pos/shifts/current", null); return o == null ? null : Json.obj(o); }
    public Map<String, Object> posOpen(Map<String, Object> body) { return Json.obj(call("POST", "/pos/shifts/open", body)); }
    public Map<String, Object> posCash(String id, String type, double amount, String reason) { return Json.obj(call("POST", "/pos/shifts/" + id + "/cash", map("type", type, "amount", amount, "reason", reason))); }
    public Map<String, Object> posClose(String id, double counted, String note) { return Json.obj(call("POST", "/pos/shifts/" + id + "/close", map("countedCash", counted, "note", note))); }

    public void bizAction(String module, String kind, String id, String op, Map<String, Object> body) { call("POST", "/erp/" + module + "/bizact/" + kind + "/" + id + "/" + op, body); }
    public void approvalAct(String id, String op, String note) { call("POST", "/erp/gov/approvals/" + id + "/" + op, map("note", note)); }
}
