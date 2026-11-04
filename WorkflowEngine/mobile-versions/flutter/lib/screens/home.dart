import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api.dart';
import '../app_state.dart';
import '../ui.dart';
import 'erp.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.goTo});
  final void Function(int) goTo;
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int tasks = 0, appr = 0, docs = 0;
  bool busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => busy = true);
    final api = Api.I;
    final tk = await api.tasks().catchError((_) => <WfTask>[]);
    final ap = api.can('gov.view') ? await api.records('gov', 'approval').catchError((_) => <ErpRec>[]) : <ErpRec>[];
    final dc = await api.instances().catchError((_) => <WfInstance>[]);
    if (!mounted) return;
    setState(() {
      tasks = tk.length;
      appr = ap.where((a) => a.status == 'Pending' && a.data['canAct'] == true).length;
      docs = dc.length;
      busy = false;
    });
  }

  Widget _stat(int v, String label, int tab) => Card(
        child: ListTile(onTap: () => widget.goTo(tab), title: Text('$v', style: const TextStyle(fontSize: 30, fontWeight: FontWeight.w700, color: kPrimary)), subtitle: Text(label)),
      );

  @override
  Widget build(BuildContext context) {
    final st = context.watch<AppState>();
    final mods = st.visibleModules();
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(padding: const EdgeInsets.all(14), children: [
        Text(st.t('home.hello', {'name': st.session?.displayName ?? ''}), style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
        const SizedBox(height: 8),
        if (busy) const LinearProgressIndicator(),
        _stat(tasks, st.t('home.pendingTasks'), 1),
        _stat(appr, st.t('home.pendingApprovals'), 1),
        _stat(docs, st.t('home.myDocs'), 2),
        const SizedBox(height: 12),
        Text(st.t('home.modules'), style: const TextStyle(fontWeight: FontWeight.w600)),
        const SizedBox(height: 8),
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final m in mods)
            ActionChip(label: Text(m.name(st.rtl)), onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => ErpKindsScreen(module: m)))),
        ]),
      ]),
    );
  }
}
