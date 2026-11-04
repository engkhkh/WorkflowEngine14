import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../app_state.dart';
import 'approvals.dart';
import 'chat.dart';
import 'documents.dart';
import 'erp.dart';
import 'home.dart';
import 'more.dart';

class Shell extends StatefulWidget {
  const Shell({super.key});
  @override
  State<Shell> createState() => _ShellState();
}

class _ShellState extends State<Shell> {
  int _i = 0;
  void go(int i) => setState(() => _i = i);

  @override
  Widget build(BuildContext context) {
    final st = context.watch<AppState>();
    final pages = <Widget>[HomeScreen(goTo: go), const ApprovalsScreen(), const DocumentsScreen(), const ErpModulesScreen(), const ChatScreen(), const MoreScreen()];
    final titles = [st.t('tab.home'), st.t('tab.approvals'), st.t('tab.documents'), st.t('tab.erp'), st.t('tab.chat'), st.t('tab.more')];
    return Scaffold(
      appBar: AppBar(title: Text(titles[_i])),
      body: IndexedStack(index: _i, children: pages.asMap().entries.map((e) => KeyedSubtree(key: ValueKey('${e.key}-${st.lang}'), child: e.value)).toList()),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _i,
        onDestinationSelected: go,
        destinations: [
          NavigationDestination(icon: const Icon(Icons.home_outlined), label: titles[0]),
          NavigationDestination(icon: const Icon(Icons.task_alt), label: titles[1]),
          NavigationDestination(icon: const Icon(Icons.description_outlined), label: titles[2]),
          NavigationDestination(icon: const Icon(Icons.apps), label: titles[3]),
          NavigationDestination(icon: const Icon(Icons.chat_bubble_outline), label: titles[4]),
          NavigationDestination(icon: const Icon(Icons.more_horiz), label: titles[5]),
        ],
      ),
    );
  }
}
