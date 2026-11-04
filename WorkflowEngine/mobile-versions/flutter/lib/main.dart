import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'app_state.dart';
import 'screens/login.dart';
import 'screens/shell.dart';
import 'ui.dart';

void main() {
  runApp(ChangeNotifierProvider(create: (_) => AppState()..init(), child: const WorkflowErpApp()));
}

class WorkflowErpApp extends StatelessWidget {
  const WorkflowErpApp({super.key});
  @override
  Widget build(BuildContext context) {
    final st = context.watch<AppState>();
    return MaterialApp(
      title: 'Workflow ERP',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: kPrimary), scaffoldBackgroundColor: kBg, useMaterial3: true,
          inputDecorationTheme: const InputDecorationTheme(border: OutlineInputBorder(), filled: true, fillColor: Colors.white)),
      builder: (context, child) => Directionality(textDirection: st.rtl ? TextDirection.rtl : TextDirection.ltr, child: child!),
      home: !st.ready ? const Scaffold(body: Center(child: CircularProgressIndicator())) : (st.signedIn ? const Shell() : const LoginScreen()),
    );
  }
}
