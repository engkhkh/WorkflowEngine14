import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:shared_preferences/shared_preferences.dart';
import 'api.dart';

class CatalogKind {
  CatalogKind(this.kind, this.en, this.ar, this.view, this.manage, this.readOnly);
  final String kind, en, ar, view, manage;
  final bool readOnly;
  String name(bool ar_) => ar_ ? ar : en;
}

class CatalogModule {
  CatalogModule(this.id, this.en, this.ar, this.kinds);
  final String id, en, ar;
  final List<CatalogKind> kinds;
  String name(bool ar_) => ar_ ? ar : en;
}

class AppState extends ChangeNotifier {
  bool ready = false;
  String lang = 'en';
  Map<String, Map<String, String>> _dict = {};
  List<CatalogModule> modules = [];

  bool get rtl => lang == 'ar';
  Session? get session => Api.I.session;
  bool get signedIn => Api.I.session != null;

  Future<void> init() async {
    final dict = jsonDecode(await rootBundle.loadString('assets/i18n.json')) as Map<String, dynamic>;
    _dict = dict.map((k, v) => MapEntry(k, Map<String, String>.from(v as Map)));
    final cat = jsonDecode(await rootBundle.loadString('assets/catalog.json')) as Map<String, dynamic>;
    modules = (cat['modules'] as List).map((m) {
      final mm = m as Map<String, dynamic>;
      return CatalogModule(mm['id'] as String, mm['en'] as String, mm['ar'] as String, (mm['kinds'] as List).map((k) {
        final kk = k as Map<String, dynamic>;
        return CatalogKind(kk['kind'] as String, kk['en'] as String, kk['ar'] as String, kk['view'] as String, kk['manage'] as String, (kk['readOnly'] ?? false) as bool);
      }).toList());
    }).toList();
    try {
      final p = await SharedPreferences.getInstance();
      lang = p.getString('wfe_flutter_lang') == 'ar' ? 'ar' : 'en';
    } catch (_) {}
    Api.I.onUnauthorized = notifyListeners;
    if (await Api.I.load() != null) await Api.I.refreshMe();
    ready = true;
    notifyListeners();
  }

  String t(String key, [Map<String, String>? vars]) {
    var s = _dict[lang]?[key] ?? _dict['en']?[key] ?? key;
    vars?.forEach((k, v) => s = s.replaceAll('{$k}', v));
    return s;
  }

  Future<void> setLang(String l) async {
    lang = l;
    notifyListeners();
    try {
      (await SharedPreferences.getInstance()).setString('wfe_flutter_lang', l);
    } catch (_) {}
  }

  Future<void> login(String server, String user, String pass) async {
    await Api.I.login(server, user, pass);
    notifyListeners();
  }

  Future<void> signOut() async {
    await Api.I.signOut();
    notifyListeners();
  }

  List<CatalogModule> visibleModules() => modules.where((m) => m.kinds.any((k) => Api.I.can(k.view))).toList();
}
