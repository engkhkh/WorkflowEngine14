import React, { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ErpRec, bizAction, can, createRecord, deleteRecord, records, updateRecord } from '../api';
import { useApp } from '../ctx';
import { Btn, Card, Chip, Empty, ErrorText, Field, Screen, colors, statusColor } from '../ui';
import catalog from '../data/catalog.json';

type Kind = (typeof catalog.modules)[number]['kinds'][number];
const nameOf = (o: { en: string; ar: string }, lang: string) => (lang === 'ar' ? o.ar : o.en);

export function ErpModules({ navigation }: any) {
  const { t, lang } = useApp();
  const mods = catalog.modules.filter(m => m.kinds.some(k => can(k.view)));
  return (
    <Screen>
      <FlatList data={mods} keyExtractor={m => m.id} ListEmptyComponent={<Empty text={t('erp.noModules')} />}
        renderItem={({ item }) => <Card onPress={() => navigation.navigate('ErpKinds', { module: item.id })}><Text style={{ fontWeight: '600', color: colors.text }}>{nameOf(item, lang)}</Text></Card>} />
    </Screen>
  );
}

export function ErpKinds({ route, navigation }: any) {
  const { lang } = useApp();
  const m = catalog.modules.find(x => x.id === route.params.module)!;
  navigation.setOptions({ title: nameOf(m, lang) });
  return (
    <Screen>
      <FlatList data={m.kinds.filter(k => can(k.view))} keyExtractor={k => k.kind}
        renderItem={({ item }) => <Card onPress={() => navigation.navigate('ErpList', { module: m.id, kind: item.kind })}><Text style={{ fontWeight: '600', color: colors.text }}>{nameOf(item, lang)}</Text></Card>} />
    </Screen>
  );
}

export function ErpList({ route, navigation }: any) {
  const { t, lang } = useApp();
  const { module, kind } = route.params as { module: string; kind: string };
  const k = catalog.modules.find(x => x.id === module)!.kinds.find(x => x.kind === kind)! as Kind;
  const canManage = can(k.manage) && !k.readOnly;
  const [rows, setRows] = useState<ErpRec[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  navigation.setOptions({ title: nameOf(k, lang) });

  const load = useCallback(async () => {
    setBusy(true); setErr('');
    try { setRows(await records(module, kind)); } catch (e: any) { setErr(String(e?.message ?? t('common.error'))); }
    setBusy(false);
  }, [module, kind, t]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? rows.filter(r => JSON.stringify([r.code, r.status, r.ref, r.data]).toLowerCase().includes(s)) : rows;
  }, [rows, q]);
  const label = (r: ErpRec) => r.code || String(r.data?.name ?? r.data?.title ?? r.data?.nameEn ?? r.id.slice(0, 8));
  const sub = (r: ErpRec) => String(r.data?.name ?? r.data?.title ?? r.data?.description ?? r.ref ?? '');

  return (
    <Screen>
      <View style={{ paddingHorizontal: 14, paddingTop: 10 }}>
        <Field placeholder={t('erp.search')} value={q} onChangeText={setQ} />
        {canManage ? <Btn title={'+ ' + t('erp.new')} onPress={() => navigation.navigate('ErpForm', { module, kind })} /> : null}
        <ErrorText text={err} />
      </View>
      <FlatList data={shown} keyExtractor={r => r.id} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} />}
        ListEmptyComponent={busy ? null : <Empty text={t('erp.none')} />}
        renderItem={({ item }) => (
          <Card onPress={() => navigation.navigate('ErpForm', { module, kind, rec: item })}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '600', color: colors.text, flexShrink: 1 }}>{label(item)}</Text>
              {item.status ? <Chip text={item.status} color={statusColor(item.status)} /> : null}
            </View>
            {sub(item) ? <Text style={{ color: colors.dim, marginTop: 4 }} numberOfLines={2}>{sub(item)}</Text> : null}
          </Card>
        )} />
    </Screen>
  );
}

/** A free-form record editor: header fields plus one row per key of `data`. Values keep their type (number / yes-no / text). */
export function ErpForm({ route, navigation }: any) {
  const { t, lang } = useApp();
  const { module, kind, rec } = route.params as { module: string; kind: string; rec?: ErpRec };
  const k = catalog.modules.find(x => x.id === module)!.kinds.find(x => x.kind === kind)! as Kind;
  const editable = can(k.manage) && !k.readOnly;
  const simple = (v: any) => v === null || ['string', 'number', 'boolean'].includes(typeof v);
  const [code, setCode] = useState(rec?.code ?? '');
  const [status, setStatus] = useState(rec?.status ?? '');
  const [company, setCompany] = useState(rec?.company ?? '');
  const [ref, setRef] = useState(rec?.ref ?? '');
  const [data, setData] = useState<Record<string, any>>(rec?.data ?? {});
  const [newKey, setNewKey] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  navigation.setOptions({ title: rec ? (rec.code ?? nameOf(k, lang)) : t('erp.new') });

  const keys = Object.keys(data).filter(x => simple(data[x]));
  const complex = Object.keys(data).filter(x => !simple(data[x]));
  const setVal = (key: string, raw: string) => {
    const old = data[key];
    setData({ ...data, [key]: typeof old === 'number' ? (raw === '' || isNaN(Number(raw)) ? raw : Number(raw)) : raw });
  };

  const save = async () => {
    setBusy(true); setErr('');
    const body = { code: code || null, status: status || null, company: company || null, ref: ref || null, data };
    try {
      if (rec) await updateRecord(module, kind, rec.id, body); else await createRecord(module, kind, body);
      navigation.goBack();
    } catch (e: any) { setErr(String(e?.message ?? t('common.error'))); setBusy(false); }
  };
  // workflow actions of the newer modules (sales orders, helpdesk, subscriptions, expenses, quality, fleet)
  const [extra, setExtra] = useState<Record<string, string>>({});
  const acts = ((k as any).actions ?? []).filter((a: any) => rec && (a.when as string[]).includes(rec.status ?? '') && can(a.priv)) as any[];
  const askKeys = Array.from(new Set(acts.flatMap(a => (a.ask ?? []) as string[])));
  const askLabel = (key: string) => key === 'note' ? t('erp.note') : key === 'user' ? t('erp.actUser') : key === 'method' ? t('erp.actMethod') : key === 'amount' ? t('erp.actHours') : t('erp.actCost');
  const runAct = (a: any) => {
    const go = async () => {
      setBusy(true); setErr('');
      const body: Record<string, any> = {};
      for (const key of (a.ask ?? []) as string[]) {
        const v = (extra[key] ?? (key === 'method' ? 'Transfer' : '')).trim();
        if (key === 'amount' || key === 'cost') body[key] = Number(v) || 0; else if (v) body[key] = v;
      }
      try { await bizAction(module, kind, rec!.id, a.op, body); navigation.goBack(); }
      catch (e: any) { setErr(String(e?.message ?? t('common.error'))); setBusy(false); }
    };
    if (a.danger) Alert.alert(nameOf(a, lang) + '?', '', [{ text: t('common.cancel'), style: 'cancel' }, { text: nameOf(a, lang), style: 'destructive', onPress: go }]); else go();
  };
  const del = () => Alert.alert(t('erp.confirmDelete'), '', [
    { text: t('common.cancel'), style: 'cancel' },
    { text: t('erp.delete'), style: 'destructive', onPress: async () => { try { await deleteRecord(module, kind, rec!.id); navigation.goBack(); } catch (e: any) { setErr(String(e?.message ?? t('common.error'))); } } }]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
        {!editable ? <Chip text={t('erp.readOnly')} color={colors.dim} /> : null}
        <View style={{ height: 8 }} />
        <Field label={t('erp.code')} value={code} onChangeText={setCode} editable={editable && !rec} />
        <Field label={t('erp.status')} value={status} onChangeText={setStatus} editable={editable} />
        <Field label={t('erp.company')} value={company} onChangeText={setCompany} editable={editable} />
        <Field label={t('erp.ref')} value={ref} onChangeText={setRef} editable={editable} />
        <Text style={{ fontWeight: '600', marginVertical: 8, color: colors.text }}>{t('erp.data')}</Text>
        {keys.map(key => typeof data[key] === 'boolean'
          ? <View key={key} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text>{key}</Text><Switch value={data[key]} disabled={!editable} onValueChange={v => setData({ ...data, [key]: v })} /></View>
          : <Field key={key} label={key} value={data[key] === null ? '' : String(data[key])} editable={editable} onChangeText={v => setVal(key, v)}
              keyboardType={typeof data[key] === 'number' ? 'numeric' : 'default'} />)}
        {complex.map(key => <Text key={key} style={{ color: colors.dim, marginBottom: 8 }}>{key}: {JSON.stringify(data[key]).slice(0, 160)}</Text>)}
        {editable ? (
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}><Field placeholder={t('erp.fieldName')} value={newKey} onChangeText={setNewKey} autoCapitalize="none" /></View>
            <Btn title={t('erp.addField')} kind="ghost" disabled={!/^[A-Za-z]\w*$/.test(newKey) || newKey in data} onPress={() => { setData({ ...data, [newKey]: '' }); setNewKey(''); }} />
          </View>
        ) : null}
        {askKeys.length ? <Text style={{ fontWeight: '600', marginVertical: 8, color: colors.text }}>{t('erp.actions')}</Text> : null}
        {askKeys.map(key => <Field key={key} label={askLabel(key)} value={extra[key] ?? (key === 'method' ? 'Transfer' : '')} onChangeText={v => setExtra({ ...extra, [key]: v })}
          keyboardType={key === 'amount' || key === 'cost' ? 'numeric' : 'default'} />)}
        {acts.map(a => <Btn key={a.op} title={nameOf(a, lang)} kind={a.danger ? 'danger' : 'ghost'} disabled={busy} onPress={() => runAct(a)} />)}
        <ErrorText text={err} />
        {editable ? <Btn title={t('erp.save')} onPress={save} disabled={busy} /> : null}
        {editable && rec ? <Btn title={t('erp.delete')} kind="danger" onPress={del} /> : null}
      </ScrollView>
    </Screen>
  );
}
