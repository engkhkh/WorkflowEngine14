import React from 'react';
import { Text, View } from 'react-native';
import { useApp } from '../ctx';
import { getSession } from '../api';
import { Btn, Card, Screen, colors } from '../ui';

export default function More() {
  const { t, session, lang, setLang, signOut } = useApp();
  return (
    <Screen>
      <Card>
        <Text style={{ color: colors.dim }}>{t('more.signedInAs')}</Text>
        <Text style={{ fontWeight: '700', fontSize: 17, color: colors.text }}>{session?.displayName}</Text>
        <Text style={{ color: colors.dim }}>{session?.username} · {session?.role}</Text>
        {session?.tenantName ? <Text style={{ color: colors.dim }}>{t('more.workspace')}: {session.tenantName}</Text> : null}
      </Card>
      <Card>
        <Text style={{ color: colors.dim, marginBottom: 6 }}>{t('more.language')}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><Btn title="English" kind={lang === 'en' ? 'primary' : 'ghost'} onPress={() => setLang('en')} /></View>
          <View style={{ flex: 1 }}><Btn title="العربية" kind={lang === 'ar' ? 'primary' : 'ghost'} onPress={() => setLang('ar')} /></View>
        </View>
      </Card>
      <Card><Text style={{ color: colors.dim }}>{t('more.server')}</Text><Text>{getSession()?.server}</Text></Card>
      <View style={{ padding: 14 }}><Btn title={t('more.signout')} kind="danger" onPress={signOut} /></View>
    </Screen>
  );
}
