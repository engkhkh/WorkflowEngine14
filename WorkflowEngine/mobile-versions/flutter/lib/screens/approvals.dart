import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api.dart';
import '../app_state.dart';
import '../ui.dart';

class ApprovalsScreen extends StatefulWidget {
  const ApprovalsScreen({super.key});
  @override
  State<ApprovalsScreen> createState() => _ApprovalsScreenState();
}

class _ApprovalsScreenState extends State<ApprovalsScreen> {
  List<WfTask> tasks = [];
  List<ErpRec> approvals = [];
  bool busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => busy = true);
    final tk = await Api.I.tasks().catchError((_) => <WfTask>[]);
    final ap = Api.I.can('gov.view') ? await Api.I.records('gov', 'approval').catchError((_) => <ErpRec>[]) : <ErpRec>[];
    if (!mounted) return;
    setState(() {
      tasks = tk;
      approvals = ap.where((a) => a.status == 'Pending').toList();
      busy = false;
    });
  }

  Future<void> _sheet({WfTask? task, ErpRec? appr}) async {
    final st = context.read<AppState>();
    final comment = TextEditingController();
    String err = '';
    bool working = false;
    final done = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(builder: (ctx, setS) {
        Future<void> act(String decision) async {
          setS(() { working = true; err = ''; });
          try {
            if (task != null) {
              await Api.I.completeTask(task.id, decision, comment.text);
            } else {
              await Api.I.approvalAct(appr!.id, decision == 'reject' ? 'reject' : 'approve', comment.text);
            }
            if (ctx.mounted) Navigator.pop(ctx, true);
          } catch (e) {
            setS(() { err = e.toString(); working = false; });
          }
        }

        final can = appr == null || appr.data['canAct'] != false;
        return Directionality(
          textDirection: st.rtl ? TextDirection.rtl : TextDirection.ltr,
          child: Padding(
            padding: EdgeInsets.fromLTRB(18, 18, 18, MediaQuery.of(ctx).viewInsets.bottom + 18),
            child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(task?.nodeName ?? '${appr!.data['target'] ?? ''} ${appr.data['code'] ?? appr.code ?? ''}', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700)),
              if (appr != null) ...[
                const SizedBox(height: 8),
                Text('${st.t('appr.amount')}: ${appr.data['amount'] ?? '-'}'),
                Text('${st.t('appr.requestedBy')}: ${appr.data['requestedBy'] ?? appr.createdBy ?? ''}'),
                if (!can) Text(st.t('appr.cantAct'), style: const TextStyle(color: kDanger)),
              ],
              const SizedBox(height: 12),
              TextField(controller: comment, maxLines: 2, decoration: InputDecoration(labelText: st.t('appr.comment'))),
              if (err.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(err, style: const TextStyle(color: kDanger))),
              const SizedBox(height: 12),
              if (task != null)
                for (final d in task.decisions)
                  Padding(padding: const EdgeInsets.only(bottom: 6), child: SizedBox(width: double.infinity, child: FilledButton(
                      style: RegExp('reject|deny|decline', caseSensitive: false).hasMatch(d) ? FilledButton.styleFrom(backgroundColor: kDanger) : null,
                      onPressed: working ? null : () => act(d), child: Text(d))))
              else ...[
                SizedBox(width: double.infinity, child: FilledButton(onPressed: working || !can ? null : () => act('approve'), child: Text(st.t('appr.approve')))),
                const SizedBox(height: 6),
                SizedBox(width: double.infinity, child: FilledButton(style: FilledButton.styleFrom(backgroundColor: kDanger), onPressed: working || !can ? null : () => act('reject'), child: Text(st.t('appr.reject')))),
              ],
            ]),
          ),
        );
      }),
    );
    if (done == true) _load();
  }

  @override
  Widget build(BuildContext context) {
    final st = context.watch<AppState>();
    final empty = tasks.isEmpty && approvals.isEmpty;
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(children: [
        if (busy) const LinearProgressIndicator(),
        if (empty && !busy) EmptyText(st.t('appr.none')),
        for (final t in tasks)
          Pad(child: Card(child: ListTile(onTap: () => _sheet(task: t), title: Text(t.nodeName), subtitle: Text(t.priority), trailing: Chip2(st.t('appr.workflow'))))),
        for (final a in approvals)
          Pad(child: Card(child: ListTile(
              onTap: () => _sheet(appr: a),
              title: Text('${a.data['target'] ?? ''} ${a.data['code'] ?? a.code ?? ''}'),
              subtitle: Text('${st.t('appr.requestedBy')}: ${a.data['requestedBy'] ?? a.createdBy ?? ''}'),
              trailing: Chip2(st.t('appr.erp'), color: const Color(0xFF7C3AED))))),
      ]),
    );
  }
}
