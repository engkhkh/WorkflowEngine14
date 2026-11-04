import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api.dart';
import '../app_state.dart';
import '../ui.dart';

class ErpModulesScreen extends StatelessWidget {
  const ErpModulesScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final st = context.watch<AppState>();
    final mods = st.visibleModules();
    if (mods.isEmpty) return EmptyText(st.t('erp.noModules'));
    return ListView(children: [
      for (final m in mods)
        Pad(child: Card(child: ListTile(title: Text(m.name(st.rtl), style: const TextStyle(fontWeight: FontWeight.w600)), trailing: const Icon(Icons.chevron_right),
            onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ErpKindsScreen(module: m)))))),
    ]);
  }
}

class ErpKindsScreen extends StatelessWidget {
  const ErpKindsScreen({super.key, required this.module});
  final CatalogModule module;
  @override
  Widget build(BuildContext context) {
    final st = context.watch<AppState>();
    return Scaffold(
      appBar: AppBar(title: Text(module.name(st.rtl))),
      body: ListView(children: [
        for (final k in module.kinds.where((k) => Api.I.can(k.view)))
          Pad(child: Card(child: ListTile(title: Text(k.name(st.rtl)), trailing: const Icon(Icons.chevron_right),
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ErpListScreen(module: module, kind: k)))))),
      ]),
    );
  }
}

class ErpListScreen extends StatefulWidget {
  const ErpListScreen({super.key, required this.module, required this.kind});
  final CatalogModule module;
  final CatalogKind kind;
  @override
  State<ErpListScreen> createState() => _ErpListScreenState();
}

class _ErpListScreenState extends State<ErpListScreen> {
  List<ErpRec> rows = [];
  String q = '';
  bool busy = false;
  String err = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { busy = true; err = ''; });
    try {
      final r = await Api.I.records(widget.module.id, widget.kind.kind);
      if (mounted) setState(() => rows = r);
    } catch (e) {
      if (mounted) setState(() => err = e.toString());
    }
    if (mounted) setState(() => busy = false);
  }

  String _label(ErpRec r) => (r.code != null && r.code!.isNotEmpty) ? r.code! : '${r.data['name'] ?? r.data['title'] ?? r.data['nameEn'] ?? r.id.substring(0, 8)}';
  String _sub(ErpRec r) => '${r.data['name'] ?? r.data['title'] ?? r.data['description'] ?? r.ref ?? ''}';

  Future<void> _open([ErpRec? rec]) async {
    final changed = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => ErpFormScreen(module: widget.module, kind: widget.kind, rec: rec)));
    if (changed == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    final st = context.watch<AppState>();
    final s = q.trim().toLowerCase();
    final shown = s.isEmpty ? rows : rows.where((r) => '${r.code} ${r.status} ${r.ref} ${r.data}'.toLowerCase().contains(s)).toList();
    final canManage = Api.I.can(widget.kind.manage) && !widget.kind.readOnly;
    return Scaffold(
      appBar: AppBar(title: Text(widget.kind.name(st.rtl))),
      floatingActionButton: canManage ? FloatingActionButton(onPressed: () => _open(), child: const Icon(Icons.add)) : null,
      body: Column(children: [
        Padding(padding: const EdgeInsets.all(12), child: TextField(onChanged: (v) => setState(() => q = v), decoration: InputDecoration(hintText: st.t('erp.search'), prefixIcon: const Icon(Icons.search)))),
        if (err.isNotEmpty) Padding(padding: const EdgeInsets.symmetric(horizontal: 14), child: Text(err, style: const TextStyle(color: kDanger))),
        if (busy) const LinearProgressIndicator(),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _load,
            child: ListView(padding: const EdgeInsets.only(bottom: 90), children: [
              if (shown.isEmpty && !busy) EmptyText(st.t('erp.none')),
              for (final r in shown)
                Pad(child: Card(child: ListTile(
                    title: Text(_label(r)),
                    subtitle: _sub(r).isEmpty ? null : Text(_sub(r), maxLines: 2, overflow: TextOverflow.ellipsis),
                    trailing: (r.status ?? '').isEmpty ? null : Chip2(r.status!, color: statusColor(r.status)),
                    onTap: () => _open(r)))),
            ]),
          ),
        ),
      ]),
    );
  }
}

/// Free-form record editor: header fields plus one row per key of `data`. Numbers and yes/no values keep their type.
class ErpFormScreen extends StatefulWidget {
  const ErpFormScreen({super.key, required this.module, required this.kind, this.rec});
  final CatalogModule module;
  final CatalogKind kind;
  final ErpRec? rec;
  @override
  State<ErpFormScreen> createState() => _ErpFormScreenState();
}

class _ErpFormScreenState extends State<ErpFormScreen> {
  late final TextEditingController code, status, company, ref, newKey;
  late Map<String, dynamic> data;
  final Map<String, TextEditingController> ctl = {};
  String err = '';
  bool busy = false;

  bool _simple(dynamic v) => v == null || v is String || v is num || v is bool;
  bool get editable => Api.I.can(widget.kind.manage) && !widget.kind.readOnly;

  @override
  void initState() {
    super.initState();
    final r = widget.rec;
    code = TextEditingController(text: r?.code ?? '');
    status = TextEditingController(text: r?.status ?? '');
    company = TextEditingController(text: r?.company ?? '');
    ref = TextEditingController(text: r?.ref ?? '');
    newKey = TextEditingController();
    data = Map<String, dynamic>.from(r?.data ?? {});
    for (final e in data.entries) {
      if (_simple(e.value) && e.value is! bool) ctl[e.key] = TextEditingController(text: e.value == null ? '' : '${e.value}');
    }
  }

  Map<String, dynamic> _collect() {
    final out = Map<String, dynamic>.from(data);
    ctl.forEach((k, c) {
      final old = data[k];
      out[k] = old is num ? (num.tryParse(c.text) ?? c.text) : c.text;
    });
    return out;
  }

  Future<void> _save() async {
    setState(() { busy = true; err = ''; });
    String? n(TextEditingController c) => c.text.isEmpty ? null : c.text;
    final body = {'code': n(code), 'status': n(status), 'company': n(company), 'ref': n(ref), 'data': _collect()};
    try {
      if (widget.rec == null) {
        await Api.I.createRecord(widget.module.id, widget.kind.kind, body);
      } else {
        await Api.I.updateRecord(widget.module.id, widget.kind.kind, widget.rec!.id, body);
      }
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      setState(() { err = e.toString(); busy = false; });
    }
  }

  Future<void> _delete() async {
    final st = context.read<AppState>();
    final sure = await showDialog<bool>(context: context, builder: (c) => AlertDialog(title: Text(st.t('erp.confirmDelete')), actions: [
      TextButton(onPressed: () => Navigator.pop(c, false), child: Text(st.t('common.cancel'))),
      TextButton(onPressed: () => Navigator.pop(c, true), child: Text(st.t('erp.delete')))]));
    if (sure != true) return;
    try {
      await Api.I.deleteRecord(widget.module.id, widget.kind.kind, widget.rec!.id);
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      setState(() => err = e.toString());
    }
  }

  Widget _f(String label, TextEditingController c, {bool enabled = true, bool number = false}) => Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: TextField(controller: c, enabled: enabled && editable, keyboardType: number ? TextInputType.number : TextInputType.text, decoration: InputDecoration(labelText: label)),
      );

  @override
  Widget build(BuildContext context) {
    final st = context.watch<AppState>();
    final keys = data.keys.where((k) => _simple(data[k])).toList();
    final complex = data.keys.where((k) => !_simple(data[k])).toList();
    return Scaffold(
      appBar: AppBar(title: Text(widget.rec?.code ?? st.t('erp.new'))),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        if (!editable) Align(alignment: AlignmentDirectional.centerStart, child: Chip2(st.t('erp.readOnly'), color: kDim)),
        const SizedBox(height: 8),
        _f(st.t('erp.code'), code, enabled: widget.rec == null),
        _f(st.t('erp.status'), status),
        _f(st.t('erp.company'), company),
        _f(st.t('erp.ref'), ref),
        Text(st.t('erp.data'), style: const TextStyle(fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        for (final k in keys)
          if (data[k] is bool)
            SwitchListTile(title: Text(k), value: data[k] as bool, onChanged: editable ? (v) => setState(() => data[k] = v) : null)
          else
            _f(k, ctl[k]!, number: data[k] is num),
        for (final k in complex)
          Padding(padding: const EdgeInsets.only(bottom: 8), child: Text('$k: ${data[k].toString().length > 160 ? data[k].toString().substring(0, 160) : data[k]}', style: const TextStyle(color: kDim))),
        if (editable)
          Row(children: [
            Expanded(child: TextField(controller: newKey, autocorrect: false, onChanged: (_) => setState(() {}), decoration: InputDecoration(labelText: st.t('erp.fieldName')))),
            const SizedBox(width: 8),
            OutlinedButton(
                onPressed: RegExp(r'^[A-Za-z]\w*$').hasMatch(newKey.text) && !data.containsKey(newKey.text)
                    ? () => setState(() { data[newKey.text] = ''; ctl[newKey.text] = TextEditingController(); newKey.clear(); })
                    : null,
                child: Text(st.t('erp.addField'))),
          ]),
        if (err.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(err, style: const TextStyle(color: kDanger))),
        const SizedBox(height: 12),
        if (editable) FilledButton(onPressed: busy ? null : _save, child: Text(st.t('erp.save'))),
        if (editable && widget.rec != null)
          Padding(padding: const EdgeInsets.only(top: 8), child: FilledButton(style: FilledButton.styleFrom(backgroundColor: kDanger), onPressed: _delete, child: Text(st.t('erp.delete')))),
      ]),
    );
  }
}
