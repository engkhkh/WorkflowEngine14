import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../api.dart';
import '../app_state.dart';
import '../ui.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});
  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _server = TextEditingController(text: Api.defaultServer);
  final _user = TextEditingController();
  final _pass = TextEditingController();
  bool _busy = false;
  String _err = '';

  Future<void> _go() async {
    final st = context.read<AppState>();
    setState(() { _busy = true; _err = ''; });
    try {
      await st.login(_server.text, _user.text.trim(), _pass.text);
    } catch (_) {
      if (mounted) setState(() { _err = st.t('login.failed'); _busy = false; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final st = context.watch<AppState>();
    return Scaffold(
      body: SafeArea(
        child: ListView(padding: const EdgeInsets.all(24), children: [
          const SizedBox(height: 56),
          Text(st.t('app.name'), style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w700)),
          const SizedBox(height: 4),
          Text(st.t('login.title'), style: const TextStyle(color: kDim)),
          const SizedBox(height: 28),
          TextField(controller: _server, keyboardType: TextInputType.url, autocorrect: false, decoration: InputDecoration(labelText: st.t('login.server'))),
          const SizedBox(height: 12),
          TextField(controller: _user, autocorrect: false, decoration: InputDecoration(labelText: st.t('login.user'))),
          const SizedBox(height: 12),
          TextField(controller: _pass, obscureText: true, onSubmitted: (_) => _go(), decoration: InputDecoration(labelText: st.t('login.pass'))),
          if (_err.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_err, style: const TextStyle(color: kDanger))),
          const SizedBox(height: 16),
          FilledButton(onPressed: _busy ? null : _go, child: Text(_busy ? st.t('common.loading') : st.t('login.signin'))),
        ]),
      ),
    );
  }
}
