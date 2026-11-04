import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { can, instances, records, tasks } from '../api';
import { useApp } from '../ctx';
import { Card, Screen, colors } from '../ui';
import catalog from '../data/catalog.json';

export default function Home({ navigation }: any) {
  const { t, session, lang } = useApp();
  const [n, setN] = useState({ tasks: 0, appr: 0, docs: 0 });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    const [tk, ap, dc] = await Promise.all([
      tasks().catch(() => []),
      can('gov.view') ? records('gov', 'approval').catch(() => []) : Promise.resolve([]),
      instances().catch(() => []),
    ]);
    setN({ tasks: tk.length, appr: ap.filter(a => a.status === 'Pending' && a.data?.canAct).length, docs: dc.length });
    setBusy(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const mods = catalog.modules.filter(m => m.kinds.some(k => can(k.view)));
  const Stat = ({ v, l, go }: { v: number; l: string; go: () => void }) => (
    <Card onPress={go}><Text style={{ fontSize: 30, fontWeight: '700', color: colors.primary }}>{v}</Text><Text style={{ color: colors.dim }}>{l}</Text></Card>
  );
  return (
    <Screen>
      <ScrollView refreshControl={<RefreshControl refreshing={busy} onRefresh={load} />} contentContainerStyle={{ paddingBottom: 30 }}>
        <Text style={{ fontSize: 22, fontWeight: '700', margin: 16, color: colors.text }}>{t('home.hello', { name: session?.displayName ?? '' })}</Text>
        <Stat v={n.tasks} l={t('home.pendingTasks')} go={() => navigation.navigate('Approvals')} />
        <Stat v={n.appr} l={t('home.pendingApprovals')} go={() => navigation.navigate('Approvals')} />
        <Stat v={n.docs} l={t('home.myDocs')} go={() => navigation.navigate('Documents')} />
        <Text style={{ fontWeight: '600', margin: 16, marginBottom: 0, color: colors.text }}>{t('home.modules')}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8 }}>
          {mods.map(m => (
            <Card key={m.id} style={{ width: '45%', marginHorizontal: '2.5%' }} onPress={() => navigation.navigate('ERP', { screen: 'ErpKinds', params: { module: m.id }, initial: false })}>
              <Text style={{ fontWeight: '600', color: colors.text }}>{lang === 'ar' ? m.ar : m.en}</Text>
            </Card>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}
