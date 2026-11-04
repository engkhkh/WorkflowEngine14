import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api.dart';
import '../app_state.dart';
import '../ui.dart';

class MoreScreen extends StatelessWidget {
  const MoreScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final st = context.watch<AppState>();
    final s = st.session;
    return ListView(padding: const EdgeInsets.all(14), children: [
      Card(child: ListTile(
        subtitle: Text(st.t('more.signedInAs')),
        title: Text(s?.displayName ?? '', style: const TextStyle(fontWeight: FontWeight.w700)),
        trailing: Text('${s?.username ?? ''} · ${s?.role ?? ''}', style: const TextStyle(color: kDim)),
      )),
      if ((s?.tenantName ?? '').isNotEmpty) Card(child: ListTile(title: Text(st.t('more.workspace')), trailing: Text(s!.tenantName!))),
      Card(child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(st.t('more.language'), style: const TextStyle(color: kDim)),
        const SizedBox(height: 8),
        SegmentedButton<String>(
          segments: const [ButtonSegment(value: 'en', label: Text('English')), ButtonSegment(value: 'ar', label: Text('العربية'))],
          selected: {st.lang},
          onSelectionChanged: (v) => st.setLang(v.first),
        ),
      ]))),
      Card(child: ListTile(title: Text(st.t('more.server')), subtitle: Text(Api.I.session?.server ?? ''))),
      const SizedBox(height: 8),
      FilledButton(style: FilledButton.styleFrom(backgroundColor: kDanger), onPressed: () => st.signOut(), child: Text(st.t('more.signout'))),
    ]);
  }
}
