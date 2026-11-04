import React, { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { defaultServer, login } from '../api';
import { useApp } from '../ctx';
import { Btn, ErrorText, Field, Screen, colors } from '../ui';

export default function Login() {
  const { t, setSession } = useApp();
  const [server, setServer] = useState(defaultServer);
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const go = async () => {
    setBusy(true); setErr('');
    try { setSession(await login(server.trim(), user.trim(), pass)); }
    catch { setErr(t('login.failed')); }
    finally { setBusy(false); }
  };
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 80 }} keyboardShouldPersistTaps="handled">
        <Text style={{ fontSize: 28, fontWeight: '700', color: colors.text, marginBottom: 4 }}>{t('app.name')}</Text>
        <Text style={{ color: colors.dim, marginBottom: 28 }}>{t('login.title')}</Text>
        <Field label={t('login.server')} value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
        <Field label={t('login.user')} value={user} onChangeText={setUser} autoCapitalize="none" autoCorrect={false} />
        <Field label={t('login.pass')} value={pass} onChangeText={setPass} secureTextEntry onSubmitEditing={go} />
        <ErrorText text={err} />
        <Btn title={busy ? t('common.loading') : t('login.signin')} onPress={go} disabled={busy || !user || !pass} />
      </ScrollView>
    </Screen>
  );
}
