import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api.dart';
import '../app_state.dart';
import '../ui.dart';

class DocumentsScreen extends StatefulWidget {
  const DocumentsScreen({super.key});
  @override
  State<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends State<DocumentsScreen> {
  List<WfInstance> list = [];
  bool busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => busy = true);
    final l = await Api.I.instances().catchError((_) => <WfInstance>[]);
    if (!mounted) return;
    setState(() { list = l; busy = false; });
  }

  Future<void> _new() async {
    final defs = await Api.I.definitions().catchError((_) => <WfDefinition>[]);
    if (!mounted) return;
    final ok = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => NewRequestScreen(defs: defs)));
    if (ok == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    final st = context.watch<AppState>();
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: FloatingActionButton.extended(onPressed: _new, icon: const Icon(Icons.add), label: Text(st.t('docs.new'))),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.only(bottom: 90), children: [
          if (busy) const LinearProgressIndicator(),
          if (list.isEmpty && !busy) EmptyText(st.t('docs.none')),
          for (final i in list)
            Pad(child: Card(child: ListTile(
                title: Text(i.definitionName),
                subtitle: Text(i.startedAt.length >= 16 ? i.startedAt.substring(0, 16).replaceFirst('T', ' ') : i.startedAt),
                trailing: Chip2(i.status, color: statusColor(i.status)),
                onTap: () async {
                  final d = await Api.I.instance(i.id).catchError((_) => i);
                  if (!context.mounted) return;
                  final changed = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => InstanceScreen(inst: d)));
                  if (changed == true) _load();
                }))),
        ]),
      ),
    );
  }
}

class InstanceScreen extends StatelessWidget {
  const InstanceScreen({super.key, required this.inst});
  final WfInstance inst;
  @override
  Widget build(BuildContext context) {
    final st = context.watch<AppState>();
    return Scaffold(
      appBar: AppBar(title: Text(inst.definitionName)),
      body: ListView(padding: const EdgeInsets.all(14), children: [
        Align(alignment: AlignmentDirectional.centerStart, child: Chip2(inst.status, color: statusColor(inst.status))),
        const SizedBox(height: 12),
        Text(st.t('docs.history'), style: const TextStyle(fontWeight: FontWeight.w600)),
        for (final h in inst.history)
          Card(child: ListTile(title: Text('${h.nodeName} · ${h.action}'), subtitle: Text('${h.actor ?? ''} ${h.timestamp ?? ''}${(h.comment ?? '').isEmpty ? '' : '\n${h.comment}'}'))),
        if (inst.status == 'Running')
          Padding(padding: const EdgeInsets.only(top: 12), child: FilledButton(
              style: FilledButton.styleFrom(backgroundColor: kDanger),
              onPressed: () async {
                final sure = await showDialog<bool>(context: context, builder: (c) => AlertDialog(title: Text(st.t('docs.cancel')), actions: [
                  TextButton(onPressed: () => Navigator.pop(c, false), child: Text(st.t('common.no'))),
                  TextButton(onPressed: () => Navigator.pop(c, true), child: Text(st.t('common.yes')))]));
                if (sure != true) return;
                try {
                  await Api.I.cancelInstance(inst.id);
                  if (context.mounted) Navigator.pop(context, true);
                } catch (e) {
                  if (context.mounted) snack(context, e.toString());
                }
              },
              child: Text(st.t('docs.cancel')))),
      ]),
    );
  }
}

class NewRequestScreen extends StatefulWidget {
  const NewRequestScreen({super.key, required this.defs});
  final List<WfDefinition> defs;
  @override
  State<NewRequestScreen> createState() => _NewRequestScreenState();
}

class _NewRequestScreenState extends State<NewRequestScreen> {
  WfDefinition? pick;
  final note = TextEditingController();
  bool busy = false;
  String err = '';

  Future<void> _start() async {
    setState(() { busy = true; err = ''; });
    try {
      await Api.I.startInstance(pick!.id, note.text.isEmpty ? <String, dynamic>{} : {'note': note.text});
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      setState(() { err = e.toString(); busy = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final st = context.watch<AppState>();
    return Scaffold(
      appBar: AppBar(title: Text(st.t('docs.choose'))),
      body: ListView(padding: const EdgeInsets.all(14), children: [
        for (final d in widget.defs)
          Card(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: pick?.id == d.id ? kPrimary : Colors.transparent, width: 2)),
            child: ListTile(title: Text(d.name), subtitle: d.description.isEmpty ? null : Text(d.description), onTap: () => setState(() => pick = d)),
          ),
        if (pick != null) Padding(padding: const EdgeInsets.only(top: 12), child: TextField(controller: note, maxLines: 3, decoration: InputDecoration(labelText: st.t('appr.comment')))),
        if (err.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(err, style: const TextStyle(color: kDanger))),
        const SizedBox(height: 12),
        FilledButton(onPressed: pick == null || busy ? null : _start, child: Text(st.t('docs.start'))),
      ]),
    );
  }
}
