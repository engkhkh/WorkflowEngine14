import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Modal, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { WfDefinition, WfInstance, cancelInstance, definitions, instance, instances, startInstance } from '../api';
import { useApp } from '../ctx';
import { Btn, Card, Chip, Empty, ErrorText, Field, Screen, colors, statusColor } from '../ui';

export default function Documents() {
  const { t } = useApp();
  const [list, setList] = useState<WfInstance[]>([]);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<WfInstance | null>(null);
  const [defs, setDefs] = useState<WfDefinition[] | null>(null);
  const [pick, setPick] = useState<WfDefinition | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => { setBusy(true); setList(await instances().catch(() => [])); setBusy(false); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const openNew = async () => { setErr(''); setDefs(await definitions().catch(() => [])); };
  const start = async () => {
    if (!pick) return;
    setBusy(true); setErr('');
    try { await startInstance(pick.id, note ? { note } : {}); setPick(null); setDefs(null); setNote(''); await load(); Alert.alert(t('docs.started')); }
    catch (e: any) { setErr(String(e?.message ?? t('common.error'))); setBusy(false); }
  };
  const cancel = () => detail && Alert.alert(t('docs.cancel'), '', [
    { text: t('common.no'), style: 'cancel' },
    { text: t('common.yes'), style: 'destructive', onPress: async () => { try { await cancelInstance(detail.id); setDetail(null); await load(); } catch (e: any) { Alert.alert(String(e?.message ?? t('common.error'))); } } }]);

  return (
    <Screen>
      <View style={{ paddingHorizontal: 14, paddingTop: 10 }}><Btn title={'+ ' + t('docs.new')} onPress={openNew} /></View>
      <FlatList
        data={list} keyExtractor={i => i.id}
        refreshControl={<RefreshControl refreshing={busy} onRefresh={load} />}
        ListEmptyComponent={busy ? null : <Empty text={t('docs.none')} />}
        renderItem={({ item }) => (
          <Card onPress={async () => setDetail(await instance(item.id).catch(() => item))}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '600', color: colors.text, flexShrink: 1 }}>{item.definitionName}</Text>
              <Chip text={item.status} color={statusColor(item.status)} />
            </View>
            <Text style={{ color: colors.dim, marginTop: 4 }}>{new Date(item.startedAt).toLocaleString()}</Text>
          </Card>
        )}
      />

      <Modal visible={!!detail} animationType="slide" onRequestClose={() => setDetail(null)}>
        <Screen>
          <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 56 }}>
            <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>{detail?.definitionName}</Text>
            {detail ? <View style={{ marginVertical: 8 }}><Chip text={detail.status} color={statusColor(detail.status)} /></View> : null}
            <Text style={{ fontWeight: '600', marginTop: 12 }}>{t('docs.history')}</Text>
            {(detail?.history ?? []).map((h, i) => (
              <Card key={i} style={{ marginHorizontal: 0 }}>
                <Text style={{ fontWeight: '600' }}>{h.nodeName} · {h.action}</Text>
                <Text style={{ color: colors.dim }}>{h.actor ?? ''} {new Date(h.timestamp).toLocaleString()}</Text>
                {h.comment ? <Text style={{ marginTop: 4 }}>{h.comment}</Text> : null}
              </Card>
            ))}
            {detail?.status === 'Running' ? <Btn title={t('docs.cancel')} kind="danger" onPress={cancel} /> : null}
            <Btn title={t('common.back')} kind="ghost" onPress={() => setDetail(null)} />
          </ScrollView>
        </Screen>
      </Modal>

      <Modal visible={!!defs} animationType="slide" onRequestClose={() => { setDefs(null); setPick(null); }}>
        <Screen>
          <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 56 }} keyboardShouldPersistTaps="handled">
            <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: 8 }}>{t('docs.choose')}</Text>
            {(defs ?? []).map(d => (
              <Card key={d.id} style={{ marginHorizontal: 0, borderColor: pick?.id === d.id ? colors.primary : colors.border }} onPress={() => setPick(d)}>
                <Text style={{ fontWeight: '600' }}>{d.name}</Text>
                {d.description ? <Text style={{ color: colors.dim }}>{d.description}</Text> : null}
              </Card>
            ))}
            {pick ? <View style={{ marginTop: 14 }}><Field label={t('appr.comment')} value={note} onChangeText={setNote} multiline /></View> : null}
            <ErrorText text={err} />
            <Btn title={t('docs.start')} onPress={start} disabled={!pick || busy} />
            <Btn title={t('common.cancel')} kind="ghost" onPress={() => { setDefs(null); setPick(null); }} />
          </ScrollView>
        </Screen>
      </Modal>
    </Screen>
  );
}
