import React, { useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ChatAction, chat } from '../api';
import { useApp } from '../ctx';
import { colors } from '../ui';

interface Msg { id: number; from: 'user' | 'ai'; text: string; actions?: ChatAction[]; }

export default function Chat() {
  const { t, lang, rtl } = useApp();
  const nav = useNavigation<any>();
  const [msgs, setMsgs] = useState<Msg[]>([{ id: 0, from: 'ai', text: t('chat.greet') }]);
  const [sugs, setSugs] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const list = useRef<FlatList<Msg>>(null);
  const next = useRef(1);

  const add = (m: Omit<Msg, 'id'>) => setMsgs(prev => [...prev, { ...m, id: next.current++ }]);
  const send = async (q: string) => {
    q = q.trim();
    if (!q || busy) return;
    const history = msgs.slice(-6).map(m => ({ from: m.from, text: m.text }));
    add({ from: 'user', text: q }); setText(''); setBusy(true);
    try {
      const r = await chat(q, lang, history);
      add({ from: 'ai', text: r.reply, actions: r.actions }); setSugs(r.suggestions ?? []);
    } catch { add({ from: 'ai', text: t('chat.error') }); }
    setBusy(false);
    setTimeout(() => list.current?.scrollToEnd({ animated: true }), 50);
  };
  const open = (a: ChatAction) => {
    if (a.module === 'gov' && a.kind === 'approval') nav.navigate('Approvals');
    else nav.navigate('ERP', { screen: 'ErpList', params: { module: a.module, kind: a.kind } });
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <FlatList ref={list} data={msgs} keyExtractor={m => String(m.id)} contentContainerStyle={{ padding: 12 }}
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => (
          <View style={{ alignItems: item.from === 'user' ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
            <View style={{ maxWidth: '88%', borderRadius: 14, padding: 10, backgroundColor: item.from === 'user' ? colors.primary : colors.card, borderWidth: 1, borderColor: item.from === 'user' ? colors.primary : colors.border }}>
              <Text style={{ color: item.from === 'user' ? '#fff' : colors.text, textAlign: rtl ? 'right' : 'left', lineHeight: 20 }}>{item.text}</Text>
              {item.actions?.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, gap: 6 }}>
                  {item.actions.map((a, i) => (
                    <Pressable key={i} onPress={() => open(a)} style={{ borderWidth: 1, borderColor: colors.primary, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4 }}>
                      <Text style={{ color: colors.primary, fontSize: 12 }}>{a.label} ›</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          </View>
        )}
        ListFooterComponent={busy ? <Text style={{ color: colors.dim, margin: 6 }}>{t('chat.thinking')}</Text> : null} />
      {sugs.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 44, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 10, gap: 6 }}>
          {sugs.map(s => (
            <Pressable key={s} onPress={() => send(s)} style={{ backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 16, paddingHorizontal: 12, justifyContent: 'center', height: 34 }}>
              <Text style={{ color: colors.text, fontSize: 12 }}>{s}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', padding: 10, gap: 8, alignItems: 'center' }}>
        <TextInput value={text} onChangeText={setText} placeholder={t('chat.placeholder')} onSubmitEditing={() => send(text)} returnKeyType="send"
          style={{ flex: 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, textAlign: rtl ? 'right' : 'left' }} />
        <Pressable onPress={() => send(text)} disabled={busy} style={{ backgroundColor: busy ? colors.dim : colors.primary, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10 }}>
          <Text style={{ color: '#fff', fontWeight: '600' }}>{t('chat.send')}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
