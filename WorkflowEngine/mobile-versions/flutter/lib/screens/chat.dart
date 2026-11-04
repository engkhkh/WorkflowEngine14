import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api.dart';
import '../app_state.dart';
import 'approvals.dart';
import 'erp.dart';

class _Msg {
  _Msg(this.mine, this.text, [this.actions = const []]);
  final bool mine;
  final String text;
  final List<ChatAction> actions;
}

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key});
  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final List<_Msg> _msgs = [];
  List<String> _sugs = [];
  final _text = TextEditingController();
  final _scroll = ScrollController();
  bool _busy = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_msgs.isEmpty) _msgs.add(_Msg(false, context.read<AppState>().t('chat.greet')));
  }

  Future<void> _send(String q) async {
    q = q.trim();
    if (q.isEmpty || _busy) return;
    final st = context.read<AppState>();
    final history = [for (final m in _msgs.skip(_msgs.length > 6 ? _msgs.length - 6 : 0)) {'from': m.mine ? 'user' : 'ai', 'text': m.text}];
    setState(() { _msgs.add(_Msg(true, q)); _busy = true; _text.clear(); });
    try {
      final r = await Api.I.chat(q, st.lang, history);
      if (!mounted) return;
      setState(() { _msgs.add(_Msg(false, r.reply, r.actions)); _sugs = r.suggestions; });
    } catch (_) {
      if (!mounted) return;
      setState(() => _msgs.add(_Msg(false, st.t('chat.error'))));
    }
    if (!mounted) return;
    setState(() => _busy = false);
    await Future.delayed(const Duration(milliseconds: 80));
    if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
  }

  void _open(ChatAction a) {
    final st = context.read<AppState>();
    if (a.module == 'gov' && a.kind == 'approval') {
      Navigator.push(context, MaterialPageRoute(builder: (_) => Scaffold(appBar: AppBar(title: Text(st.t('tab.approvals'))), body: const ApprovalsScreen())));
      return;
    }
    final m = st.modules.where((x) => x.id == a.module).firstOrNull;
    final k = m?.kinds.where((x) => x.kind == a.kind).firstOrNull;
    if (m != null && k != null) Navigator.push(context, MaterialPageRoute(builder: (_) => ErpListScreen(module: m, kind: k)));
  }

  @override
  Widget build(BuildContext context) {
    final st = context.watch<AppState>();
    final cs = Theme.of(context).colorScheme;
    return Column(children: [
      Expanded(
        child: ListView.builder(
          controller: _scroll,
          padding: const EdgeInsets.all(12),
          itemCount: _msgs.length + (_busy ? 1 : 0),
          itemBuilder: (_, i) {
            if (i == _msgs.length) return Padding(padding: const EdgeInsets.all(8), child: Text(st.t('chat.thinking'), style: TextStyle(color: cs.outline)));
            final m = _msgs[i];
            return Align(
              alignment: m.mine ? AlignmentDirectional.centerEnd : AlignmentDirectional.centerStart,
              child: Container(
                margin: const EdgeInsets.only(bottom: 10),
                padding: const EdgeInsets.all(10),
                constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.86),
                decoration: BoxDecoration(color: m.mine ? cs.primary : cs.surfaceContainerHighest, borderRadius: BorderRadius.circular(14)),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  SelectableText(m.text, style: TextStyle(color: m.mine ? cs.onPrimary : cs.onSurface, height: 1.4)),
                  if (m.actions.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Wrap(spacing: 6, runSpacing: 4, children: [for (final a in m.actions) ActionChip(label: Text('${a.label} ›'), onPressed: () => _open(a))]),
                    ),
                ]),
              ),
            );
          },
        ),
      ),
      if (_sugs.isNotEmpty)
        SizedBox(
          height: 44,
          child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 8), children: [
            for (final s in _sugs) Padding(padding: const EdgeInsets.symmetric(horizontal: 3), child: ActionChip(label: Text(s), onPressed: () => _send(s))),
          ]),
        ),
      SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(10, 6, 10, 8),
          child: Row(children: [
            Expanded(child: TextField(controller: _text, textInputAction: TextInputAction.send, onSubmitted: _send, decoration: InputDecoration(hintText: st.t('chat.placeholder'), border: const OutlineInputBorder(borderRadius: BorderRadius.all(Radius.circular(22))), isDense: true))),
            const SizedBox(width: 8),
            FilledButton(onPressed: _busy ? null : () => _send(_text.text), child: Text(st.t('chat.send'))),
          ]),
        ),
      ),
    ]);
  }
}
