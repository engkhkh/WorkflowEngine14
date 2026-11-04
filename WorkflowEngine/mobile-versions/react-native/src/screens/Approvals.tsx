import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Modal, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ErpRec, WfTask, approvalAct, can, completeTask, records, tasks } from '../api';
import { useApp } from '../ctx';
import { Btn, Card, Chip, Empty, ErrorText, Field, Screen, colors, statusColor } from '../ui';

type Row = { kind: 'wf'; t: WfTask } | { kind: 'erp'; a: ErpRec };

export default function Approvals() {
  const { t } = useApp();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState<Row | null>(null);
  const [comment, setComment] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    const [tk, ap] = await Promise.all([
      tasks().catch(() => [] as WfTask[]),
      can('gov.view') ? records('gov', 'approval').catch(() => [] as ErpRec[]) : Promise.resolve([] as ErpRec[]),
    ]);
    setRows([
      ...tk.map(x => ({ kind: 'wf', t: x }) as Row),
      ...ap.filter(a => a.status === 'Pending').map(a => ({ kind: 'erp', a }) as Row),
    ]);
    setBusy(false);
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const close = () => { setSel(null); setComment(''); setErr(''); };
  const act = async (decision: string) => {
    if (!sel) return;
    setBusy(true); setErr('');
    try {
      if (sel.kind === 'wf') await completeTask(sel.t.id, decision, comment);
      else await approvalAct(sel.a.id, decision === 'reject' ? 'reject' : 'approve', comment);
      close(); await load();
    } catch (e: any) { setErr(String(e?.message ?? t('common.error'))); setBusy(false); }
  };
  const confirmReject = () => Alert.alert(t('appr.reject'), '', [
    { text: t('common.cancel'), style: 'cancel' }, { text: t('appr.reject'), style: 'destructive', onPress: () => act('reject') }]);

  const title = (r: Row) => r.kind === 'wf' ? r.t.nodeName : `${r.a.data?.target ?? ''} ${r.a.data?.code ?? r.a.code ?? ''}`;
  return (
    <Screen>
      <FlatList
        data={rows} keyExtractor={r => (r.kind === 'wf' ? r.t.id : r.a.id)}
        refreshControl={<RefreshControl refreshing={busy} onRefresh={load} />}
        ListEmptyComponent={busy ? null : <Empty text={t('appr.none')} />}
        renderItem={({ item }) => (
          <Card onPress={() => setSel(item)}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontWeight: '600', color: colors.text, flexShrink: 1 }}>{title(item)}</Text>
              <Chip text={item.kind === 'wf' ? t('appr.workflow') : t('appr.erp')} color={item.kind === 'wf' ? colors.primary : '#7c3aed'} />
            </View>
            {item.kind === 'erp' ? <Text style={{ color: colors.dim, marginTop: 4 }}>{t('appr.requestedBy')}: {item.a.data?.requestedBy ?? item.a.createdBy}{item.a.data?.amount ? `  ·  ${item.a.data.amount}` : ''}</Text>
              : <Text style={{ color: colors.dim, marginTop: 4 }}>{item.t.priority ?? 'Normal'}</Text>}
          </Card>
        )}
      />
      <Modal visible={!!sel} animationType="slide" onRequestClose={close}>
        <Screen>
          <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 56 }} keyboardShouldPersistTaps="handled">
            {sel ? <Text style={{ fontSize: 20, fontWeight: '700', color: colors.text }}>{title(sel)}</Text> : null}
            {sel?.kind === 'erp' ? (
              <View style={{ marginVertical: 12 }}>
                <Chip text={sel.a.status ?? ''} color={statusColor(sel.a.status)} />
                <Text style={{ marginTop: 8 }}>{t('appr.step')}: {String(sel.a.data?.stepLabel ?? (Number(sel.a.data?.current ?? 0) + 1))}</Text>
                <Text>{t('appr.amount')}: {String(sel.a.data?.amount ?? '-')}</Text>
                <Text>{t('appr.requestedBy')}: {String(sel.a.data?.requestedBy ?? sel.a.createdBy ?? '')}</Text>
                {sel.a.data?.canAct === false ? <Text style={{ color: colors.danger, marginTop: 8 }}>{t('appr.cantAct')}</Text> : null}
              </View>
            ) : null}
            <Field label={t('appr.comment')} value={comment} onChangeText={setComment} multiline />
            <ErrorText text={err} />
            {sel?.kind === 'wf'
              ? sel.t.availableDecisions.map(d => <Btn key={d} title={d} kind={/reject|deny|decline/i.test(d) ? 'danger' : 'primary'} onPress={() => act(d)} disabled={busy} />)
              : (<>
                  <Btn title={t('appr.approve')} onPress={() => act('approve')} disabled={busy || sel?.a.data?.canAct === false} />
                  <Btn title={t('appr.reject')} kind="danger" onPress={confirmReject} disabled={busy || sel?.a.data?.canAct === false} />
                </>)}
            <Btn title={t('common.cancel')} kind="ghost" onPress={close} />
          </ScrollView>
        </Screen>
      </Modal>
    </Screen>
  );
}
