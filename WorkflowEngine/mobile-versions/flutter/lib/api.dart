import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

class Session {
  Session({required this.server, required this.token, required this.id, required this.username, required this.displayName, required this.role, required this.permissions, this.tenantName});
  String server, token, id, username, displayName, role;
  List<String> permissions;
  String? tenantName;

  Map<String, dynamic> toJson() => {'server': server, 'token': token, 'id': id, 'username': username, 'displayName': displayName, 'role': role, 'permissions': permissions, 'tenantName': tenantName};
  factory Session.fromJson(Map<String, dynamic> j) => Session(
        server: j['server'] as String, token: j['token'] as String, id: (j['id'] ?? '') as String, username: (j['username'] ?? '') as String,
        displayName: (j['displayName'] ?? '') as String, role: (j['role'] ?? '') as String,
        permissions: ((j['permissions'] ?? []) as List).map((e) => e.toString()).toList(), tenantName: j['tenantName'] as String?);
}

class ErpRec {
  ErpRec({required this.id, required this.module, required this.kind, this.code, this.company, this.status, this.ref, this.createdBy, required this.data});
  String id, module, kind;
  String? code, company, status, ref, createdBy;
  Map<String, dynamic> data;
  factory ErpRec.fromJson(Map<String, dynamic> j) => ErpRec(
        id: j['id'] as String, module: (j['module'] ?? '') as String, kind: (j['kind'] ?? '') as String, code: j['code'] as String?,
        company: j['company'] as String?, status: j['status'] as String?, ref: j['ref'] as String?, createdBy: j['createdBy'] as String?,
        data: (j['data'] is Map) ? Map<String, dynamic>.from(j['data'] as Map) : <String, dynamic>{});
}

class WfTask {
  WfTask({required this.id, required this.nodeName, required this.priority, required this.decisions});
  String id, nodeName, priority;
  List<String> decisions;
  factory WfTask.fromJson(Map<String, dynamic> j) => WfTask(
        id: j['id'] as String, nodeName: (j['nodeName'] ?? '') as String, priority: (j['priority'] ?? 'Normal') as String,
        decisions: ((j['availableDecisions'] ?? []) as List).map((e) => e.toString()).toList());
}

class WfHistory {
  WfHistory({required this.nodeName, required this.action, this.actor, this.comment, this.timestamp});
  String nodeName, action;
  String? actor, comment, timestamp;
  factory WfHistory.fromJson(Map<String, dynamic> j) => WfHistory(
        nodeName: (j['nodeName'] ?? '') as String, action: (j['action'] ?? '') as String, actor: j['actor'] as String?, comment: j['comment'] as String?, timestamp: j['timestamp'] as String?);
}

class WfInstance {
  WfInstance({required this.id, required this.definitionName, required this.status, required this.startedAt, required this.history});
  String id, definitionName, status, startedAt;
  List<WfHistory> history;
  factory WfInstance.fromJson(Map<String, dynamic> j) => WfInstance(
        id: j['id'] as String, definitionName: (j['definitionName'] ?? '') as String, status: (j['status'] ?? '') as String, startedAt: (j['startedAt'] ?? '') as String,
        history: ((j['history'] ?? []) as List).map((e) => WfHistory.fromJson(Map<String, dynamic>.from(e as Map))).toList());
}

class WfDefinition {
  WfDefinition({required this.id, required this.name, required this.description});
  String id, name, description;
  factory WfDefinition.fromJson(Map<String, dynamic> j) => WfDefinition(id: j['id'] as String, name: (j['name'] ?? '') as String, description: (j['description'] ?? '') as String);
}

class ApiException implements Exception {
  ApiException(this.message, {this.unauthorized = false});
  final String message;
  final bool unauthorized;
  @override
  String toString() => message;
}

class Api {
  Api._();
  static final Api I = Api._();
  static const _key = 'wfe_flutter_session';
  Session? session;
  void Function()? onUnauthorized;

  static String defaultServer = 'http://10.0.2.2:5000';
  bool can(String p) => session?.permissions.contains(p) ?? false;

  String _base(String server) {
    var s = server.trim().replaceAll(RegExp(r'/+$'), '');
    if (s.endsWith('/api')) s = s.substring(0, s.length - 4);
    return '$s/api';
  }

  Future<Session?> load() async {
    try {
      final p = await SharedPreferences.getInstance();
      final raw = p.getString(_key);
      session = raw == null ? null : Session.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      session = null;
    }
    return session;
  }

  Future<void> _save(Session? s) async {
    session = s;
    try {
      final p = await SharedPreferences.getInstance();
      if (s == null) {
        await p.remove(_key);
      } else {
        await p.setString(_key, jsonEncode(s.toJson()));
      }
    } catch (_) {/* storage is optional */}
  }

  Future<void> signOut() => _save(null);

  Future<Session> login(String server, String user, String pass) async {
    final res = await http.post(Uri.parse('${_base(server)}/auth/login'), headers: {'Content-Type': 'application/json'}, body: jsonEncode({'username': user, 'password': pass}));
    if (res.statusCode != 200) throw ApiException('login');
    final j = jsonDecode(res.body) as Map<String, dynamic>;
    final s = Session(
        server: server.trim(), token: j['token'] as String, id: (j['id'] ?? '') as String, username: (j['username'] ?? '') as String,
        displayName: (j['displayName'] ?? '') as String, role: (j['role'] ?? '') as String,
        permissions: ((j['permissions'] ?? []) as List).map((e) => e.toString()).toList(), tenantName: j['tenantName'] as String?);
    await _save(s);
    return s;
  }

  Future<void> refreshMe() async {
    try {
      final j = await _call('GET', '/users/me') as Map<String, dynamic>;
      final s = session;
      if (s == null) return;
      s.permissions = ((j['effectivePermissions'] ?? s.permissions) as List).map((e) => e.toString()).toList();
      s.displayName = (j['displayName'] ?? s.displayName) as String;
      s.role = (j['role'] ?? s.role) as String;
      await _save(s);
    } catch (_) {/* keep cached privileges */}
  }

  Future<dynamic> _call(String method, String path, [Object? body]) async {
    final s = session;
    if (s == null) throw ApiException('not signed in', unauthorized: true);
    final uri = Uri.parse('${_base(s.server)}$path');
    final headers = {'Content-Type': 'application/json', 'Authorization': 'Bearer ${s.token}'};
    final enc = body == null ? null : jsonEncode(body);
    late http.Response res;
    switch (method) {
      case 'POST':
        res = await http.post(uri, headers: headers, body: enc);
        break;
      case 'PUT':
        res = await http.put(uri, headers: headers, body: enc);
        break;
      case 'DELETE':
        res = await http.delete(uri, headers: headers);
        break;
      default:
        res = await http.get(uri, headers: headers);
    }
    if (res.statusCode == 401) {
      await signOut();
      onUnauthorized?.call();
      throw ApiException('401', unauthorized: true);
    }
    final text = utf8.decode(res.bodyBytes);
    if (res.statusCode < 200 || res.statusCode >= 300) {
      var msg = text;
      try {
        final j = jsonDecode(text);
        if (j is Map) msg = (j['message'] ?? j['error'] ?? j['title'] ?? text).toString();
      } catch (_) {}
      throw ApiException(msg.isEmpty ? '${res.statusCode}' : msg);
    }
    return text.isEmpty ? null : jsonDecode(text);
  }

  List<Map<String, dynamic>> _list(dynamic v) => (v as List? ?? []).map((e) => Map<String, dynamic>.from(e as Map)).toList();

  Future<List<WfTask>> tasks() async => _list(await _call('GET', '/tasks')).map(WfTask.fromJson).toList();
  Future<void> completeTask(String id, String decision, String comment) => _call('POST', '/tasks/$id/complete', {'decision': decision, 'formData': {}, 'comment': comment});
  Future<List<WfInstance>> instances() async => _list(await _call('GET', '/instances')).map(WfInstance.fromJson).toList();
  Future<WfInstance> instance(String id) async => WfInstance.fromJson(Map<String, dynamic>.from(await _call('GET', '/instances/$id') as Map));
  Future<void> cancelInstance(String id) => _call('POST', '/instances/$id/cancel', {});
  Future<List<WfDefinition>> definitions() async => _list(await _call('GET', '/definitions')).map(WfDefinition.fromJson).toList();
  Future<void> startInstance(String defId, Map<String, dynamic> data) => _call('POST', '/instances/start', {'definitionId': defId, 'initialData': data});

  Future<List<ErpRec>> records(String module, String kind) async => _list(await _call('GET', '/erp/$module/records/$kind?take=500')).map(ErpRec.fromJson).toList();
  Future<void> createRecord(String module, String kind, Map<String, dynamic> body) => _call('POST', '/erp/$module/records/$kind', body);
  Future<void> updateRecord(String module, String kind, String id, Map<String, dynamic> body) => _call('PUT', '/erp/$module/records/$kind/$id', body);
  Future<void> deleteRecord(String module, String kind, String id) => _call('DELETE', '/erp/$module/records/$kind/$id');
  /// The shared ERP assistant (POST api/assistant/chat): answers from the live data this user may see.
  Future<ChatReply> chat(String message, String lang, List<Map<String, String>> history) async =>
      ChatReply.fromJson(Map<String, dynamic>.from(await _call('POST', '/assistant/chat', {'message': message, 'lang': lang, 'history': history}) as Map));
  Future<void> approvalAct(String id, String op, String note) => _call('POST', '/erp/gov/approvals/$id/$op', {'note': note});
}

class ChatAction {
  ChatAction(this.label, this.module, this.kind);
  final String label, module, kind;
}

class ChatReply {
  ChatReply(this.reply, this.actions, this.suggestions);
  final String reply;
  final List<ChatAction> actions;
  final List<String> suggestions;
  factory ChatReply.fromJson(Map<String, dynamic> j) => ChatReply(
        (j['reply'] ?? '').toString(),
        [for (final a in (j['actions'] as List? ?? [])) ChatAction('${a['label']}', '${a['module']}', '${a['kind']}')],
        [for (final s in (j['suggestions'] as List? ?? [])) '$s'],
      );
}
